"""
Device management API routes.
"""
import asyncio
import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from uuid import UUID

from database import get_db
from app.models import Device
from app.models.stream import Stream, StreamState
from app.models.producer import Producer, ProducerState
from app.schemas.device import DeviceCreate, DeviceUpdate, DeviceResponse

router = APIRouter(prefix="/api/v1/devices", tags=["devices"])


@router.post("", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
async def create_device(
    device_data: DeviceCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new device."""
    # Check if RTSP URL already exists
    from sqlalchemy import select
    result = await db.execute(
        select(Device).where(Device.rtsp_url == device_data.rtsp_url)
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Device with this RTSP URL already exists"
        )
    
    # Create new device
    device = Device(**device_data.model_dump())
    db.add(device)
    await db.commit()
    await db.refresh(device)
    
    return device


@router.get("", response_model=List[DeviceResponse])
async def list_devices(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
):
    """List all devices with their current stream state."""
    from sqlalchemy import select
    result = await db.execute(
        select(Device).offset(skip).limit(limit)
    )
    devices = result.scalars().all()

    # Get stream states for all devices
    device_ids = [device.id for device in devices]
    stream_states = {}
    if device_ids:
        stream_query = select(Stream).where(Stream.camera_id.in_(device_ids))
        stream_result = await db.execute(stream_query)
        for stream in stream_result.scalars().all():
            stream_states[stream.camera_id] = stream.state.value if stream.state else None

    # Build response with stream state included
    response = []
    for device in devices:
        device_dict = {
            "id": device.id,
            "name": device.name,
            "description": device.description,
            "rtsp_url": device.rtsp_url,
            "is_active": device.is_active,
            "location": device.location,
            "created_at": device.created_at,
            "updated_at": device.updated_at,
            "stream_state": stream_states.get(device.id),
        }
        response.append(device_dict)

    return response


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device(
    device_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Get a specific device by ID."""
    from sqlalchemy import select
    result = await db.execute(
        select(Device).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found"
        )
    
    return device


@router.post("/{device_id}/start-stream")
async def start_device_stream(
    device_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Start streaming from a device via MediaSoup WebRTC."""
    from sqlalchemy import select
    from app.services.rtsp_pipeline import rtsp_pipeline
    from app.services.mediasoup_client import mediasoup_client
    from app.services.stream_health_monitor import stream_health_monitor
    from loguru import logger
    
    # Get device
    result = await db.execute(
        select(Device).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found"
        )
    
    # Start RTSP → MediaSoup pipeline
    try:
        room_id = str(device_id)

        # 0. CHECK: If stream is already active, return existing stream info instead of restarting
        # This prevents disrupting active streams when Ruth AI or VAS portal reconnects
        if room_id in rtsp_pipeline.active_streams:
            logger.info(f"Stream already active for device {device_id}, returning existing stream info")
            stream_info = rtsp_pipeline.active_streams[room_id]

            # Get existing producers for this room
            try:
                existing_producers = await mediasoup_client.get_producers(room_id)
                if existing_producers:
                    # Query for existing V2 Stream record
                    v2_stream_query = select(Stream).where(Stream.camera_id == device_id)
                    v2_stream_result = await db.execute(v2_stream_query)
                    v2_stream = v2_stream_result.scalar_one_or_none()

                    # Ensure Producer database record exists for reconnecting streams
                    if v2_stream:
                        producer_query = select(Producer).where(
                            Producer.stream_id == v2_stream.id,
                            Producer.state == ProducerState.ACTIVE
                        )
                        producer_result = await db.execute(producer_query)
                        active_producer = producer_result.scalar_one_or_none()

                        if not active_producer and existing_producers:
                            # Create missing Producer record
                            logger.info(f"Creating missing Producer record for reconnecting stream {v2_stream.id}")
                            new_producer = Producer(
                                stream_id=v2_stream.id,
                                mediasoup_producer_id=existing_producers[-1],
                                mediasoup_transport_id=stream_info.get("transport_id", "unknown"),
                                mediasoup_router_id=room_id,
                                ssrc=stream_info.get("ssrc", 0),
                                rtp_parameters={
                                    "codecs": [{
                                        "mimeType": "video/H264",
                                        "clockRate": 90000,
                                        "payloadType": 96,
                                        "parameters": {"packetization-mode": 1, "profile-level-id": "42e01f"}
                                    }],
                                    "encodings": [{"ssrc": stream_info.get("ssrc", 0)}]
                                },
                                state=ProducerState.ACTIVE
                            )
                            db.add(new_producer)
                            await db.commit()
                            logger.info(f"Created Producer record for reconnecting stream")

                    # Return info about existing stream
                    response = {
                        "status": "success",
                        "device_id": str(device_id),
                        "room_id": room_id,
                        "transport_id": stream_info.get("transport_id", "unknown"),
                        "producers": {
                            "video": existing_producers[-1] if existing_producers else "unknown"
                        },
                        "stream": {
                            "status": "active",
                            "message": "Stream already running",
                            "started_at": stream_info.get("started_at")
                        },
                        "reconnect": True  # Flag indicating this was a reconnect, not a new stream
                    }

                    # Include v2_stream_id if V2 Stream record exists
                    if v2_stream:
                        response["v2_stream_id"] = str(v2_stream.id)

                    return response
            except Exception as e:
                logger.warning(f"Error getting existing producers, will restart stream: {e}")
                # If we can't get producer info, fall through to restart the stream
                await rtsp_pipeline.stop_stream(room_id)
        
        # Also kill any orphaned FFmpeg processes for this RTSP URL as a safety measure
        import subprocess
        import os
        try:
            result = subprocess.run(
                ["pgrep", "-f", f"ffmpeg.*{device.rtsp_url}"],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.returncode == 0:
                pids = result.stdout.strip().split('\n')
                for pid in pids:
                    if pid:
                        try:
                            os.kill(int(pid), 15)  # SIGTERM
                            logger.info(f"Killed orphaned FFmpeg process {pid} (SIGTERM)")
                        except (ProcessLookupError, ValueError):
                            pass

                # Wait for SIGTERM to take effect
                await asyncio.sleep(1.5)

                # Check again and force kill any survivors with SIGKILL
                result2 = subprocess.run(
                    ["pgrep", "-f", f"ffmpeg.*{device.rtsp_url}"],
                    capture_output=True,
                    text=True,
                    timeout=2
                )
                if result2.returncode == 0:
                    survivor_pids = result2.stdout.strip().split('\n')
                    for pid in survivor_pids:
                        if pid:
                            try:
                                os.kill(int(pid), 9)  # SIGKILL
                                logger.warning(f"Force killed stubborn FFmpeg process {pid} (SIGKILL)")
                            except (ProcessLookupError, ValueError):
                                pass
                    await asyncio.sleep(0.5)
        except Exception as e:
            logger.warning(f"Error cleaning up orphaned FFmpeg processes: {e}")
        
        # SSRC Capture Workflow:
        # 0. Close old transports first (releases the port for SSRC capture)
        # 1. Get deterministic port for this room
        # 2. Start SSRC capture (binds UDP socket) and FFmpeg (sends to that port) concurrently
        # 3. SSRC capture extracts SSRC from first packet, closes socket
        # 4. Create MediaSoup transport on same port (now available)
        # 5. Create producer (before connecting transport)
        # 6. Connect transport to FFmpeg source

        mediasoup_host = os.getenv("MEDIASOUP_HOST", "127.0.0.1")

        # Step 0: Close old transports for this room (releases the port)
        try:
            closed_count = await mediasoup_client.close_transports_for_room(room_id)
            if closed_count > 0:
                logger.info(f"Closed {closed_count} old transport(s) for room {room_id}")
                await asyncio.sleep(0.3)  # Brief delay to ensure port is released
        except Exception as e:
            logger.warning(f"Error closing old transports: {e}")

        # Step 1: Get deterministic port for this room
        logger.info(f"Getting port for room {room_id}...")
        video_port = await mediasoup_client.get_port_for_room(room_id)
        logger.info(f"Using port {video_port} for room {room_id}")

        # Step 2: Start SSRC capture and FFmpeg concurrently
        # We need FFmpeg to start sending packets so we can capture the SSRC
        logger.info(f"Starting SSRC capture and FFmpeg concurrently...")

        async def start_ffmpeg_delayed():
            """Start FFmpeg after a brief delay to ensure capture socket is bound."""
            await asyncio.sleep(0.2)  # Give capture socket time to bind
            return await rtsp_pipeline.start_stream(
                stream_id=room_id,
                rtsp_url=device.rtsp_url,
                mediasoup_ip=mediasoup_host,
                mediasoup_video_port=video_port,
                ssrc=None  # FFmpeg will use random SSRC, we'll capture it
            )

        # Run SSRC capture and FFmpeg start concurrently
        # Timeout is 15 seconds to allow for slow RTSP camera connections
        ssrc_capture_task = mediasoup_client.capture_ssrc(video_port, timeout_ms=15000)
        ffmpeg_task = start_ffmpeg_delayed()

        ssrc_result, stream_info = await asyncio.gather(
            ssrc_capture_task,
            ffmpeg_task,
            return_exceptions=True
        )

        # Handle exceptions from gather
        if isinstance(ssrc_result, Exception):
            logger.error(f"SSRC capture failed: {ssrc_result}")
            ssrc_result = {"ssrc": None, "success": False}
        if isinstance(stream_info, Exception):
            logger.error(f"FFmpeg start failed: {stream_info}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to start FFmpeg: {stream_info}"
            )

        if stream_info.get("status") == "error":
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to start FFmpeg: {stream_info.get('error')}"
            )

        captured_ssrc = ssrc_result.get("ssrc")
        if not captured_ssrc:
            logger.warning(f"Failed to capture SSRC - stream may not work correctly")
            # Try to continue anyway - the stream might still work
            captured_ssrc = 0

        logger.info(f"✅ SSRC captured: {captured_ssrc} (0x{captured_ssrc:08x})")
        logger.info(f"✅ FFmpeg started sending to port {video_port}")

        # Step 3: Create PlainRTP transport on the same port
        # The capture socket is now closed, so we can bind MediaSoup to this port
        logger.info(f"Creating PlainRTP transport on port {video_port}...")
        transport_info = await mediasoup_client.create_plain_rtp_transport(room_id, fixed_port=video_port)

        if not transport_info:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create PlainRTP transport"
            )

        transport_id = transport_info["id"]
        logger.info(f"PlainRTP transport created: {transport_id}")

        # Step 4: Create producer FIRST (before connecting transport)
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
            "encodings": [{"ssrc": captured_ssrc}]  # Use the captured SSRC
        }

        # Close any old producers for this room
        try:
            old_producers = await mediasoup_client.get_producers(room_id)
            if old_producers:
                logger.info(f"Found {len(old_producers)} old producer(s), cleaning up...")
                for old_producer_id in old_producers:
                    try:
                        await mediasoup_client.close_producer(old_producer_id)
                    except Exception as e:
                        logger.warning(f"Failed to close old producer: {e}")
        except Exception as e:
            logger.warning(f"Error cleaning up old producers: {e}")

        logger.info(f"Creating producer with SSRC {captured_ssrc}...")
        video_producer = await mediasoup_client.create_producer(
            transport_id, "video", video_rtp_parameters
        )
        producer_id = video_producer.get('id')
        logger.info(f"✅ Producer created: {producer_id}")

        # Step 5: NOW connect transport to FFmpeg source
        # The producer is already waiting for packets with the correct SSRC
        ffmpeg_source_port = rtsp_pipeline.get_ffmpeg_source_port(room_id)
        logger.info(f"Connecting transport to FFmpeg source 127.0.0.1:{ffmpeg_source_port}...")
        await mediasoup_client.connect_plain_transport(
            transport_id=transport_id,
            ip="127.0.0.1",
            port=ffmpeg_source_port
        )

        # 7. Wait for producer to actually receive RTP packets before returning success
        # This prevents the race condition where frontend connects before FFmpeg is streaming
        logger.info(f"Waiting for producer {producer_id} to receive RTP packets...")

        producer_ready = await mediasoup_client.wait_for_producer_ready(
            producer_id,
            timeout=8.0,  # 8 seconds max (FFmpeg takes ~0.5s to start, packets should arrive within 1-2s more)
            poll_interval=0.3
        )

        if not producer_ready:
            logger.warning(f"Producer {producer_id} not receiving packets after timeout - stream may have issues")
            # Don't fail the request - the stream might still work, frontend has retry logic

        # Update device as active
        device.is_active = True

        # Create or update V2 Stream record for snapshot/bookmark support
        # Check if stream already exists for this device
        stream_query = select(Stream).where(Stream.camera_id == device_id)
        stream_result = await db.execute(stream_query)
        v2_stream = stream_result.scalar_one_or_none()

        if v2_stream:
            # Update existing stream to LIVE state
            v2_stream.state = StreamState.LIVE
            v2_stream.stream_metadata = {
                "transport_id": transport_id,
                "producer_id": video_producer["id"],
                "ssrc": captured_ssrc,
                "started_at": datetime.now(timezone.utc).isoformat()
            }
            logger.info(f"Updated V2 Stream {v2_stream.id} to LIVE state")
        else:
            # Create new V2 Stream record
            v2_stream = Stream(
                camera_id=device_id,
                name=device.name or f"Stream-{device_id}",
                state=StreamState.LIVE,
                codec_config={
                    "video": {
                        "codec": "H264",
                        "profile": "42e01f",
                        "payloadType": 96
                    }
                },
                stream_metadata={
                    "transport_id": transport_id,
                    "producer_id": video_producer["id"],
                    "ssrc": captured_ssrc,
                    "started_at": datetime.now(timezone.utc).isoformat()
                }
            )
            db.add(v2_stream)
            # Flush to get the stream ID assigned before creating Producer
            await db.flush()
            logger.info(f"Created V2 Stream {v2_stream.id} for device {device_id}")

        # Create Producer database record for consumer attachment support
        # First, close any existing producers for this stream
        existing_producers_query = select(Producer).where(
            Producer.stream_id == v2_stream.id,
            Producer.state != ProducerState.CLOSED
        )
        existing_producers_result = await db.execute(existing_producers_query)
        for old_producer in existing_producers_result.scalars().all():
            old_producer.state = ProducerState.CLOSED
            logger.info(f"Closed existing producer record {old_producer.id}")

        # Create new Producer record with ACTIVE state
        new_producer = Producer(
            stream_id=v2_stream.id,
            mediasoup_producer_id=video_producer["id"],
            mediasoup_transport_id=transport_id,
            mediasoup_router_id=room_id,  # Using room_id as router_id
            ssrc=captured_ssrc,  # SSRC captured from FFmpeg's RTP packets
            rtp_parameters={
                "codecs": [{
                    "mimeType": "video/H264",
                    "clockRate": 90000,
                    "payloadType": 96,
                    "parameters": {"packetization-mode": 1, "profile-level-id": "42e01f"}
                }],
                "encodings": [{"ssrc": captured_ssrc}]
            },
            state=ProducerState.ACTIVE
        )
        db.add(new_producer)
        logger.info(f"Created Producer record {new_producer.id} with ACTIVE state for stream {v2_stream.id}")

        await db.commit()

        # Register stream with health monitor for continuous monitoring
        stream_health_monitor.register_stream(room_id, video_producer["id"])
        logger.info(f"Registered stream with health monitor: room={room_id}, producer={video_producer['id']}")

        return {
            "status": "success",
            "device_id": str(device_id),
            "room_id": room_id,
            "transport_id": transport_id,
            "producers": {
                "video": video_producer["id"]
            },
            "stream": stream_info,
            "v2_stream_id": str(v2_stream.id)  # Include V2 stream ID in response
        }
        
    except HTTPException:
        # Re-raise HTTP exceptions (they already have proper status codes)
        raise
    except ConnectionRefusedError as e:
        logger.error(f"MediaSoup connection refused: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error_code": "MEDIASOUP_UNAVAILABLE",
                "message": "MediaSoup server is not available. Please check if the MediaSoup service is running.",
                "detail": str(e)
            }
        )
    except TimeoutError as e:
        logger.error(f"RTSP timeout: {e}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail={
                "error_code": "RTSP_TIMEOUT",
                "message": "RTSP connection timed out. Please verify the RTSP URL and network connectivity.",
                "detail": str(e)
            }
        )
    except Exception as e:
        error_str = str(e).lower()
        logger.error(f"Failed to start device stream: {e}")
        logger.exception(e)

        # Categorize common errors
        if "ssrc" in error_str or "capture" in error_str:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "error_code": "SSRC_CAPTURE_FAILED",
                    "message": "Failed to capture SSRC from RTSP source. The stream may not be producing video.",
                    "detail": str(e)
                }
            )
        elif "rtsp" in error_str or "connection" in error_str:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "error_code": "RTSP_CONNECTION_FAILED",
                    "message": "Failed to connect to RTSP stream. Please verify the RTSP URL.",
                    "detail": str(e)
                }
            )
        elif "transport" in error_str or "mediasoup" in error_str:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error_code": "MEDIASOUP_ERROR",
                    "message": "MediaSoup encountered an error. Please try again.",
                    "detail": str(e)
                }
            )
        elif "ffmpeg" in error_str:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "error_code": "FFMPEG_ERROR",
                    "message": "FFmpeg failed to process the stream.",
                    "detail": str(e)
                }
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "error_code": "STREAM_START_FAILED",
                    "message": "An unexpected error occurred while starting the stream.",
                    "detail": str(e)
                }
            )


@router.post("/{device_id}/stop-stream")
async def stop_device_stream(
    device_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Stop streaming from a device."""
    from sqlalchemy import select
    from app.services.rtsp_pipeline import rtsp_pipeline
    from app.services.stream_health_monitor import stream_health_monitor
    from loguru import logger
    
    # Get device
    result = await db.execute(
        select(Device).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found"
        )
    
    # Stop RTSP stream
    try:
        room_id = str(device_id)
        stopped = await rtsp_pipeline.stop_stream(room_id)

        # Unregister from health monitor
        stream_health_monitor.unregister_stream(room_id)
        logger.info(f"Unregistered stream from health monitor: room={room_id}")

        if stopped:
            # Update device as inactive
            device.is_active = False

            # Update V2 Stream state to STOPPED
            stream_query = select(Stream).where(Stream.camera_id == device_id)
            stream_result = await db.execute(stream_query)
            v2_stream = stream_result.scalar_one_or_none()
            if v2_stream:
                v2_stream.state = StreamState.STOPPED
                logger.info(f"Updated V2 Stream {v2_stream.id} to STOPPED state")

                # Close all active producers for this stream
                producers_query = select(Producer).where(
                    Producer.stream_id == v2_stream.id,
                    Producer.state != ProducerState.CLOSED
                )
                producers_result = await db.execute(producers_query)
                for producer in producers_result.scalars().all():
                    producer.state = ProducerState.CLOSED
                    logger.info(f"Closed Producer record {producer.id}")

            await db.commit()

        return {
            "status": "success",
            "device_id": str(device_id),
            "stopped": stopped
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to stop device stream: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "STREAM_STOP_FAILED",
                "message": "Failed to stop stream",
                "detail": str(e)
            }
        )


@router.put("/{device_id}", response_model=DeviceResponse)
async def update_device(
    device_id: UUID,
    device_data: DeviceUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update a device."""
    from sqlalchemy import select
    result = await db.execute(
        select(Device).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found"
        )
    
    # Update fields
    update_data = device_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(device, field, value)
    
    await db.commit()
    await db.refresh(device)
    
    return device


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    device_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Delete a device."""
    from sqlalchemy import select
    result = await db.execute(
        select(Device).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()

    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found"
        )

    # Check if device is currently active (streaming)
    if device.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete device while stream is active. Please stop the stream first."
        )

    await db.delete(device)
    await db.commit()

    return None


# Ruth-AI Compatibility Endpoints
@router.post("/validate")
async def validate_device(
    device_data: DeviceCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Validate device RTSP connection without saving to database.

    This endpoint is compatible with the old VAS API's device validation endpoint.
    It tests the RTSP URL to ensure it's reachable and streams valid video.
    """
    from app.services.rtsp_pipeline import rtsp_pipeline
    from loguru import logger

    rtsp_url = device_data.rtsp_url

    try:
        logger.info(f"Validating RTSP URL: {rtsp_url}")

        # Try to capture SSRC from the RTSP stream (this validates connectivity)
        detected_ssrc = await rtsp_pipeline.capture_ssrc_with_temp_ffmpeg(rtsp_url, timeout=10.0)

        if not detected_ssrc:
            return {
                "valid": False,
                "error": "Failed to connect to RTSP stream or stream has no video",
                "rtsp_url": rtsp_url
            }

        logger.info(f"RTSP URL validation successful: {rtsp_url} (SSRC: {detected_ssrc})")

        return {
            "valid": True,
            "rtsp_url": rtsp_url,
            "ssrc": detected_ssrc,
            "message": "Device validated successfully"
        }

    except Exception as e:
        logger.error(f"RTSP validation failed for {rtsp_url}: {e}")
        return {
            "valid": False,
            "error": str(e),
            "rtsp_url": rtsp_url
        }


@router.get("/{device_id}/status")
async def get_device_status(
    device_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """
    Get device status including streaming state.

    This endpoint is compatible with the old VAS API's device status endpoint.
    Returns device information along with current streaming status.
    """
    from sqlalchemy import select
    from app.services.rtsp_pipeline import rtsp_pipeline

    # Get device
    result = await db.execute(
        select(Device).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()

    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found"
        )

    # Check if stream is active
    room_id = str(device_id)
    stream_active = room_id in rtsp_pipeline.active_streams

    stream_info = None
    if stream_active:
        stream_info = rtsp_pipeline.active_streams[room_id]

    return {
        "device_id": str(device.id),
        "name": device.name,
        "description": device.description,
        "location": device.location,
        "rtsp_url": device.rtsp_url,
        "is_active": device.is_active,
        "created_at": device.created_at,
        "updated_at": device.updated_at,
        "streaming": {
            "active": stream_active,
            "room_id": room_id if stream_active else None,
            "started_at": stream_info.get("started_at") if stream_info else None
        }
    }


