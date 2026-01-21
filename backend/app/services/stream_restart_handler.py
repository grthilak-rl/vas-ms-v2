"""
Stream Restart Handler

Handles stream restart requests from the health monitor.
This module provides the callback function that restarts unhealthy streams.
"""
import asyncio
from loguru import logger


async def restart_stream_handler(room_id: str) -> bool:
    """
    Restart a stream by room_id.

    This function is called by the StreamHealthMonitor when a stream
    is detected as unhealthy (not receiving packets).

    Args:
        room_id: The room/device ID (same as device_id for this system)

    Returns:
        True if restart was initiated successfully, False otherwise
    """
    from app.services.rtsp_pipeline import rtsp_pipeline
    from app.services.mediasoup_client import mediasoup_client
    from app.services.stream_health_monitor import stream_health_monitor
    from database import AsyncSessionLocal
    from app.models import Device
    from sqlalchemy import select
    import os

    logger.info(f"Stream restart requested for room: {room_id}")

    try:
        # Get device info from database
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Device).where(Device.id == room_id)
            )
            device = result.scalar_one_or_none()

            if not device:
                logger.error(f"Cannot restart stream: device not found for room_id={room_id}")
                return False

            rtsp_url = device.rtsp_url

        # Step 1: Stop existing stream (FFmpeg)
        logger.info(f"Stopping existing stream for room: {room_id}")
        await rtsp_pipeline.stop_stream(room_id)

        # Step 2: Close old transports in MediaSoup (releases the port for SSRC capture)
        # This must happen BEFORE SSRC capture so we can bind to the port
        try:
            closed_count = await mediasoup_client.close_transports_for_room(room_id)
            logger.info(f"Closed {closed_count} transport(s) for room {room_id}")
        except Exception as e:
            logger.warning(f"Error closing transports: {e}")

        # Brief delay to ensure port is released
        await asyncio.sleep(0.5)

        # SSRC Capture Workflow:
        # 1. Get deterministic port for this room
        # 2. Start SSRC capture and FFmpeg concurrently
        # 3. Create MediaSoup transport on same port
        # 4. Connect transport and create producer with SSRC

        mediasoup_host = os.getenv("MEDIASOUP_HOST", "127.0.0.1")

        # Step 3: Get deterministic port for this room
        video_port = await mediasoup_client.get_port_for_room(room_id)
        logger.info(f"Using port {video_port} for room {room_id}")

        # Step 4: Start SSRC capture and FFmpeg concurrently
        async def start_ffmpeg_delayed():
            """Start FFmpeg after a brief delay to ensure capture socket is bound."""
            await asyncio.sleep(0.2)
            return await rtsp_pipeline.start_stream(
                stream_id=room_id,
                rtsp_url=rtsp_url,
                mediasoup_ip=mediasoup_host,
                mediasoup_video_port=video_port,
                ssrc=None
            )

        ssrc_capture_task = mediasoup_client.capture_ssrc(video_port, timeout_ms=8000)
        ffmpeg_task = start_ffmpeg_delayed()

        ssrc_result, stream_info = await asyncio.gather(
            ssrc_capture_task,
            ffmpeg_task,
            return_exceptions=True
        )

        # Handle exceptions from gather
        if isinstance(ssrc_result, Exception):
            logger.error(f"SSRC capture failed during restart: {ssrc_result}")
            ssrc_result = {"ssrc": None, "success": False}
        if isinstance(stream_info, Exception):
            logger.error(f"FFmpeg start failed during restart: {stream_info}")
            return False

        if stream_info.get("status") == "error":
            logger.error(f"FFmpeg failed to start for room: {room_id}")
            return False

        captured_ssrc = ssrc_result.get("ssrc")
        if not captured_ssrc:
            logger.warning(f"Failed to capture SSRC during restart - stream may not work")
            captured_ssrc = 0

        logger.info(f"✅ SSRC captured during restart: {captured_ssrc} (0x{captured_ssrc:08x})")

        # Step 5: Create PlainRTP transport on the same port
        transport_info = await mediasoup_client.create_plain_rtp_transport(room_id, fixed_port=video_port)

        if not transport_info:
            logger.error(f"Failed to create transport for room: {room_id}")
            return False

        transport_id = transport_info["id"]
        logger.info(f"New transport created: {transport_id}")

        # Step 6: Create producer FIRST (before connecting transport)
        # This ensures the producer is ready when packets start arriving
        video_rtp_parameters = {
            "mid": "video",
            "codecs": [{
                "mimeType": "video/H264",
                "clockRate": 90000,
                "parameters": {
                    "packetization-mode": 1,
                    "profile-level-id": "42e01f"
                },
                "payloadType": 96
            }],
            "encodings": [{"ssrc": captured_ssrc}]
        }

        video_producer = await mediasoup_client.create_producer(
            transport_id, "video", video_rtp_parameters
        )
        producer_id = video_producer.get("id")
        logger.info(f"New producer created: {producer_id}")

        # Step 7: NOW connect transport to FFmpeg source
        # The producer is already waiting for packets with the correct SSRC
        ffmpeg_source_port = rtsp_pipeline.get_ffmpeg_source_port(room_id)
        logger.info(f"Connecting transport to FFmpeg source 127.0.0.1:{ffmpeg_source_port}...")
        await mediasoup_client.connect_plain_transport(
            transport_id=transport_id,
            ip="127.0.0.1",
            port=ffmpeg_source_port
        )

        # Step 8: Wait for producer to receive packets
        producer_ready = await mediasoup_client.wait_for_producer_ready(
            producer_id,
            timeout=8.0,
            poll_interval=0.3
        )

        if producer_ready:
            logger.info(f"Stream restarted successfully: room={room_id}, producer={producer_id}")

            # Register new producer with health monitor
            stream_health_monitor.register_stream(room_id, producer_id)
            stream_health_monitor.mark_stream_healthy(room_id)

            # Update database records
            await _update_stream_records(room_id, transport_id, producer_id, captured_ssrc)

            return True
        else:
            logger.warning(f"Producer not receiving packets after restart: room={room_id}")
            # Don't mark as failed immediately - health monitor will check again
            stream_health_monitor.register_stream(room_id, producer_id)
            return True  # Restart was initiated, let health monitor track it

    except Exception as e:
        logger.error(f"Error restarting stream for room {room_id}: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        return False


async def _update_stream_records(
    room_id: str,
    transport_id: str,
    producer_id: str,
    ssrc: int
):
    """Update database records after stream restart."""
    from database import AsyncSessionLocal
    from app.models.stream import Stream, StreamState
    from app.models.producer import Producer, ProducerState
    from sqlalchemy import select
    from datetime import datetime, timezone
    from uuid import UUID

    try:
        async with AsyncSessionLocal() as db:
            # Find V2 Stream record
            stream_query = select(Stream).where(Stream.camera_id == UUID(room_id))
            stream_result = await db.execute(stream_query)
            v2_stream = stream_result.scalar_one_or_none()

            if v2_stream:
                # Update stream metadata
                v2_stream.state = StreamState.LIVE
                v2_stream.stream_metadata = {
                    "transport_id": transport_id,
                    "producer_id": producer_id,
                    "ssrc": ssrc,
                    "restarted_at": datetime.now(timezone.utc).isoformat(),
                    "restart_reason": "health_monitor"
                }

                # Close old producer records
                existing_producers_query = select(Producer).where(
                    Producer.stream_id == v2_stream.id,
                    Producer.state != ProducerState.CLOSED
                )
                existing_producers_result = await db.execute(existing_producers_query)
                for old_producer in existing_producers_result.scalars().all():
                    old_producer.state = ProducerState.CLOSED

                # Create new producer record
                new_producer = Producer(
                    stream_id=v2_stream.id,
                    mediasoup_producer_id=producer_id,
                    mediasoup_transport_id=transport_id,
                    mediasoup_router_id=room_id,
                    ssrc=ssrc,
                    rtp_parameters={
                        "codecs": [{
                            "mimeType": "video/H264",
                            "clockRate": 90000,
                            "payloadType": 96,
                            "parameters": {"packetization-mode": 1, "profile-level-id": "42e01f"}
                        }],
                        "encodings": [{"ssrc": ssrc}]
                    },
                    state=ProducerState.ACTIVE
                )
                db.add(new_producer)

                await db.commit()
                logger.info(f"Updated stream records after restart: room={room_id}")

    except Exception as e:
        logger.error(f"Error updating stream records: {e}")
