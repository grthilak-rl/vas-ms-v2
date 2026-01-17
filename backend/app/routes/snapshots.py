"""
Snapshot management API routes.
"""
from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.responses import FileResponse
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.services.snapshot_service import snapshot_service
from app.models.device import Device
from database import get_db
from loguru import logger
from pydantic import BaseModel


router = APIRouter(prefix="/api/v1/snapshots", tags=["snapshots"])


class CaptureSnapshotRequest(BaseModel):
    """Request model for capturing a snapshot."""
    timestamp: Optional[str] = None  # ISO format timestamp for historical capture


@router.post("/devices/{device_id}/capture/live")
async def capture_live_snapshot(
    device_id: str,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Capture a snapshot from a live RTSP stream.

    Args:
        device_id: Device UUID
        db: Database session

    Returns:
        Snapshot information
    """
    try:
        # Get device
        result = await db.execute(select(Device).filter(Device.id == device_id))
        device = result.scalars().first()
        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device not found"
            )

        # Capture snapshot (V1 uses device_id as stream_id for compatibility)
        snapshot = await snapshot_service.capture_from_live_stream(
            stream_id=device_id,
            rtsp_url=device.rtsp_url,
            db=db
        )

        return {
            "status": "success",
            "snapshot": {
                "id": str(snapshot.id),
                "device_id": str(snapshot.stream_id),
                "timestamp": snapshot.timestamp.isoformat(),
                "source": snapshot.source,
                "file_size": snapshot.file_size,
                "url": f"/api/v1/snapshots/{snapshot.id}/image"
            }
        }

    except FileNotFoundError as e:
        logger.error(f"File not found: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to capture live snapshot: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to capture snapshot: {str(e)}"
        )


@router.post("/devices/{device_id}/capture/historical")
async def capture_historical_snapshot(
    device_id: str,
    request: CaptureSnapshotRequest,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Capture a snapshot from historical recordings.

    Args:
        device_id: Device UUID
        request: Capture request with timestamp
        db: Database session

    Returns:
        Snapshot information
    """
    try:
        # Get device
        result = await db.execute(select(Device).filter(Device.id == device_id))
        device = result.scalars().first()
        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device not found"
            )

        # Parse timestamp
        if request.timestamp:
            try:
                timestamp = datetime.fromisoformat(request.timestamp)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid timestamp format. Use ISO format (YYYY-MM-DDTHH:MM:SS)"
                )
        else:
            timestamp = datetime.now()

        # Capture snapshot (V1 uses device_id as stream_id for compatibility)
        snapshot = await snapshot_service.capture_from_historical(
            stream_id=device_id,
            timestamp=timestamp,
            db=db
        )

        return {
            "status": "success",
            "snapshot": {
                "id": str(snapshot.id),
                "device_id": str(snapshot.stream_id),
                "timestamp": snapshot.timestamp.isoformat(),
                "source": snapshot.source,
                "file_size": snapshot.file_size,
                "url": f"/api/v1/snapshots/{snapshot.id}/image"
            }
        }

    except FileNotFoundError as e:
        logger.error(f"File not found: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to capture historical snapshot: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to capture snapshot: {str(e)}"
        )


@router.get("")
async def list_snapshots(
    device_id: Optional[str] = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    List all snapshots, optionally filtered by device.

    Args:
        device_id: Optional device ID filter
        limit: Maximum number of snapshots to return
        db: Database session

    Returns:
        List of snapshots
    """
    try:
        # V1 API uses device_id, but service uses stream_id
        # For V1 compatibility, we pass device_id as stream_id since
        # the V1 API stored snapshots with device_id in the stream_id field
        snapshots = await snapshot_service.list_snapshots(
            db=db,
            stream_id=device_id,
            limit=limit
        )

        snapshot_list = []
        for snapshot in snapshots:
            device_name = None
            try:
                if snapshot.stream:
                    device_name = snapshot.stream.name
            except:
                pass  # Ignore lazy loading errors

            snapshot_list.append({
                "id": str(snapshot.id),
                "device_id": str(snapshot.stream_id),  # V1 API returns stream_id as device_id
                "device_name": device_name,
                "timestamp": snapshot.timestamp.isoformat(),
                "source": snapshot.source,
                "file_size": snapshot.file_size,
                "url": f"/api/v1/snapshots/{snapshot.id}/image",
                "created_at": snapshot.created_at.isoformat()
            })

        return {
            "status": "success",
            "count": len(snapshot_list),
            "snapshots": snapshot_list
        }

    except Exception as e:
        logger.error(f"Failed to list snapshots: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/{snapshot_id}")
async def get_snapshot(
    snapshot_id: str,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a specific snapshot by ID.

    Args:
        snapshot_id: Snapshot UUID
        db: Database session

    Returns:
        Snapshot information
    """
    snapshot = await snapshot_service.get_snapshot(db, snapshot_id)
    if not snapshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snapshot not found"
        )

    device_name = None
    try:
        if snapshot.stream:
            device_name = snapshot.stream.name
    except:
        pass  # Ignore lazy loading errors

    return {
        "status": "success",
        "snapshot": {
            "id": str(snapshot.id),
            "device_id": str(snapshot.stream_id),  # V1 API returns stream_id as device_id
            "device_name": device_name,
            "timestamp": snapshot.timestamp.isoformat(),
            "source": snapshot.source,
            "file_size": snapshot.file_size,
            "url": f"/api/v1/snapshots/{snapshot.id}/image",
            "created_at": snapshot.created_at.isoformat()
        }
    }


@router.get("/{snapshot_id}/image")
async def get_snapshot_image(
    snapshot_id: str,
    db: AsyncSession = Depends(get_db)
) -> FileResponse:
    """
    Get the snapshot image file.

    Args:
        snapshot_id: Snapshot UUID
        db: Database session

    Returns:
        Image file
    """
    snapshot = await snapshot_service.get_snapshot(db, snapshot_id)
    if not snapshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snapshot not found"
        )

    import os
    if not os.path.exists(snapshot.file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snapshot file not found on disk"
        )

    return FileResponse(
        snapshot.file_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000"}
    )


@router.delete("/{snapshot_id}")
async def delete_snapshot(
    snapshot_id: str,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Delete a snapshot.

    Args:
        snapshot_id: Snapshot UUID
        db: Database session

    Returns:
        Success message
    """
    try:
        deleted = await snapshot_service.delete_snapshot(db, snapshot_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Snapshot not found"
            )

        return {
            "status": "success",
            "message": "Snapshot deleted successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete snapshot: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
