"""
Device management API routes.
"""
import asyncio
import os
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
from uuid import UUID

from database import get_db
from app.models import Device
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
        
        # 0. CLEANUP: Stop any existing stream for this device first
        # This prevents multiple producers from accumulating
        if room_id in rtsp_pipeline.active_streams:
            logger.info(f"Stopping existing stream for device {device_id} before starting new one")
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

        logger.info(f"Creating producer with SSRC: {detected_ssrc}")
        video_producer = await mediasoup_client.create_producer(
            transport_id, "video", video_rtp_parameters
        )
        logger.info(f"✅ Producer created: {video_producer.get('id')}")

        # 4. NOW start FFmpeg to send RTP to MediaSoup (producer already exists and ready)
        logger.info(f"Starting FFmpeg to send RTP to MediaSoup...")
        # Use host IP since FFmpeg runs in container and MediaSoup runs on host
        mediasoup_host_ip = os.getenv("MEDIASOUP_HOST_IP", "10.30.250.245")
        stream_info = await rtsp_pipeline.start_stream(
            stream_id=room_id,
            rtsp_url=device.rtsp_url,
            mediasoup_ip=mediasoup_host_ip,
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
        await db.commit()
        
        return {
            "status": "success",
            "device_id": str(device_id),
            "room_id": room_id,
            "transport_id": transport_id,
            "producers": {
                "video": video_producer["id"]
            },
            "stream": stream_info
        }
        
    except Exception as e:
        logger.error(f"Failed to start device stream: {e}")
        logger.exception(e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start stream: {str(e)}"
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
            await db.commit()
        
        return {
            "status": "success",
            "device_id": str(device_id),
            "stopped": stopped
        }
    except Exception as e:
        logger.error(f"Failed to stop device stream: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stop stream: {str(e)}"
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


