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

        # Step 1: Stop existing stream
        logger.info(f"Stopping existing stream for room: {room_id}")
        await rtsp_pipeline.stop_stream(room_id)

        # Brief delay to ensure cleanup
        await asyncio.sleep(1.0)

        # Step 2: Close old producers in MediaSoup
        try:
            old_producers = await mediasoup_client.get_producers(room_id)
            for producer_id in old_producers:
                try:
                    await mediasoup_client.close_producer(producer_id)
                    logger.info(f"Closed old producer: {producer_id}")
                except Exception as e:
                    logger.warning(f"Failed to close producer {producer_id}: {e}")
        except Exception as e:
            logger.warning(f"Error cleaning up old producers: {e}")

        # Step 3: Create new transport
        logger.info(f"Creating new PlainRTP transport for room: {room_id}")
        transport_info = await mediasoup_client.create_plain_rtp_transport(room_id)

        if not transport_info:
            logger.error(f"Failed to create transport for room: {room_id}")
            return False

        transport_id = transport_info["id"]
        video_port = transport_info["port"]
        logger.info(f"New transport created: {transport_id}, port: {video_port}")

        # Step 4: Capture SSRC
        logger.info(f"Capturing SSRC from RTSP source: {rtsp_url}")
        detected_ssrc = await rtsp_pipeline.capture_ssrc_with_temp_ffmpeg(rtsp_url, timeout=15.0)

        if not detected_ssrc:
            logger.error(f"Failed to capture SSRC for room: {room_id}")
            return False

        logger.info(f"SSRC captured: {detected_ssrc}")

        # Step 5: Create new producer
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
            "encodings": [{"ssrc": detected_ssrc}]
        }

        video_producer = await mediasoup_client.create_producer(
            transport_id, "video", video_rtp_parameters
        )
        producer_id = video_producer.get("id")
        logger.info(f"New producer created: {producer_id}")

        # Step 6: Start FFmpeg
        mediasoup_host = os.getenv("MEDIASOUP_HOST", "127.0.0.1")

        stream_info = await rtsp_pipeline.start_stream(
            stream_id=room_id,
            rtsp_url=rtsp_url,
            mediasoup_ip=mediasoup_host,
            mediasoup_video_port=video_port,
            ssrc=detected_ssrc
        )

        if stream_info.get("status") == "error":
            logger.error(f"FFmpeg failed to start for room: {room_id}")
            return False

        # Step 7: Wait for producer to receive packets
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
            await _update_stream_records(room_id, transport_id, producer_id, detected_ssrc)

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
