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
    """List all devices."""
    from sqlalchemy import select
    result = await db.execute(
        select(Device).offset(skip).limit(limit)
    )
    devices = result.scalars().all()
    return devices


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
        
        # 1. Create PlainRTP transport in MediaSoup for FFmpeg input
        logger.info(f"Creating PlainRTP transport for device {device_id}")
        transport_info = await mediasoup_client.create_plain_rtp_transport(room_id)

        if not transport_info:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create PlainRTP transport: MediaSoup returned no transport info"
            )

        transport_id = transport_info["id"]
        video_port = transport_info["port"]

        logger.info(f"PlainRTP transport created: {transport_id}, port: {video_port}")

        # 2. Capture SSRC from RTSP source (using temporary FFmpeg)
        logger.info(f"Capturing SSRC from RTSP source: {device.rtsp_url}")
        detected_ssrc = await rtsp_pipeline.capture_ssrc_with_temp_ffmpeg(device.rtsp_url, timeout=15.0)

        if not detected_ssrc:
            logger.error("Failed to capture SSRC - stream may not work properly")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to capture SSRC from RTSP source. Please check the RTSP URL and network connectivity."
            )

        logger.info(f"✅ SSRC captured: {detected_ssrc} (0x{detected_ssrc:08x})")

        # 3. Create producer with the captured SSRC BEFORE starting FFmpeg
        # This ensures MediaSoup is ready to match packets when they arrive
        # MediaSoup PlainRtpTransport REQUIRES explicit SSRC - comedia only auto-detects IP/port
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
            "encodings": [{"ssrc": detected_ssrc}]  # Use captured SSRC - REQUIRED for PlainRtpTransport
        }

        # Close any old producers for this room to prevent accumulation
        try:
            old_producers = await mediasoup_client.get_producers(room_id)
            if old_producers:
                logger.info(f"Found {len(old_producers)} old producer(s) for room {room_id}, cleaning up...")
                for old_producer_id in old_producers:
                    try:
                        await mediasoup_client.close_producer(old_producer_id)
                        logger.info(f"Closed old producer: {old_producer_id}")
                    except Exception as e:
                        logger.warning(f"Failed to close old producer {old_producer_id}: {e}")
        except Exception as e:
            logger.warning(f"Error cleaning up old producers: {e}")

        logger.info(f"Creating producer with SSRC: {detected_ssrc}")
        video_producer = await mediasoup_client.create_producer(
            transport_id, "video", video_rtp_parameters
        )
        logger.info(f"✅ Producer created: {video_producer.get('id')}")

        # 4. NOW start FFmpeg to send RTP to MediaSoup (producer already exists and ready)
        logger.info(f"Starting FFmpeg to send RTP to MediaSoup...")
        # Both backend and MediaSoup run in host network mode
        mediasoup_host = os.getenv("MEDIASOUP_HOST", "127.0.0.1")
        stream_info = await rtsp_pipeline.start_stream(
            stream_id=room_id,
            rtsp_url=device.rtsp_url,
            mediasoup_ip=mediasoup_host,
            mediasoup_video_port=video_port,
            ssrc=detected_ssrc  # Pass SSRC for logging
        )

        if stream_info.get("status") == "error":
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to start FFmpeg: {stream_info.get('error')}"
            )
        
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
                "ssrc": detected_ssrc,
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
                    "ssrc": detected_ssrc,
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
            ssrc=detected_ssrc,
            rtp_parameters={
                "codecs": [{
                    "mimeType": "video/H264",
                    "clockRate": 90000,
                    "payloadType": 96,
                    "parameters": {"packetization-mode": 1, "profile-level-id": "42e01f"}
                }],
                "encodings": [{"ssrc": detected_ssrc}]
            },
            state=ProducerState.ACTIVE
        )
        db.add(new_producer)
        logger.info(f"Created Producer record {new_producer.id} with ACTIVE state for stream {v2_stream.id}")

        await db.commit()

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
        stopped = await rtsp_pipeline.stop_stream(str(device_id))

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


