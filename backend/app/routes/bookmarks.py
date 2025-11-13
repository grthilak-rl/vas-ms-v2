"""
Bookmark management API routes.
"""
from fastapi import APIRouter, HTTPException, status, Depends, Query
from fastapi.responses import FileResponse
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.services.bookmark_service import bookmark_service
from app.models.bookmark import Bookmark
from app.models.device import Device
from app.schemas.bookmark import (
    BookmarkCreate,
    BookmarkHistoricalCreate,
    BookmarkUpdate,
    BookmarkResponse,
    BookmarkListResponse
)
from database import get_db
from loguru import logger


router = APIRouter(prefix="/api/v1/bookmarks", tags=["bookmarks"])


@router.post("/devices/{device_id}/capture/live")
async def capture_live_bookmark(
    device_id: str,
    request: BookmarkCreate,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Capture a 6-second bookmark from live RTSP stream (last 6 seconds).

    Args:
        device_id: Device UUID
        request: Bookmark creation request with optional label
        db: Database session

    Returns:
        Bookmark information
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

        # Capture bookmark
        bookmark = await bookmark_service.capture_from_live_stream(
            device_id=device_id,
            rtsp_url=device.rtsp_url,
            label=request.label,
            db=db
        )

        return {
            "status": "success",
            "bookmark": {
                "id": str(bookmark.id),
                "device_id": str(bookmark.device_id),
                "device_name": device.name,
                "center_timestamp": bookmark.center_timestamp.isoformat(),
                "start_timestamp": bookmark.start_timestamp.isoformat(),
                "end_timestamp": bookmark.end_timestamp.isoformat(),
                "label": bookmark.label,
                "source": bookmark.source,
                "duration": bookmark.duration,
                "file_size": bookmark.file_size,
                "video_url": f"/api/v1/bookmarks/{bookmark.id}/video",
                "thumbnail_url": f"/api/v1/bookmarks/{bookmark.id}/thumbnail" if bookmark.thumbnail_path else None
            }
        }

    except FileNotFoundError as e:
        logger.error(f"File not found: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to capture live bookmark: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to capture bookmark: {str(e)}"
        )


@router.post("/devices/{device_id}/capture/historical")
async def capture_historical_bookmark(
    device_id: str,
    request: BookmarkHistoricalCreate,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Capture a 6-second bookmark from historical footage (±3 seconds from center).

    Args:
        device_id: Device UUID
        request: Bookmark creation request with timestamp and optional label
        db: Database session

    Returns:
        Bookmark information
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
        try:
            center_timestamp = datetime.fromisoformat(request.center_timestamp.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid timestamp format. Use ISO 8601 format."
            )

        # Capture bookmark
        bookmark = await bookmark_service.capture_from_historical(
            device_id=device_id,
            center_timestamp=center_timestamp,
            label=request.label,
            db=db
        )

        return {
            "status": "success",
            "bookmark": {
                "id": str(bookmark.id),
                "device_id": str(bookmark.device_id),
                "device_name": device.name,
                "center_timestamp": bookmark.center_timestamp.isoformat(),
                "start_timestamp": bookmark.start_timestamp.isoformat(),
                "end_timestamp": bookmark.end_timestamp.isoformat(),
                "label": bookmark.label,
                "source": bookmark.source,
                "duration": bookmark.duration,
                "file_size": bookmark.file_size,
                "video_url": f"/api/v1/bookmarks/{bookmark.id}/video",
                "thumbnail_url": f"/api/v1/bookmarks/{bookmark.id}/thumbnail" if bookmark.thumbnail_path else None
            }
        }

    except FileNotFoundError as e:
        logger.error(f"File not found: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to capture historical bookmark: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to capture bookmark: {str(e)}"
        )


@router.get("")
async def list_bookmarks(
    device_id: Optional[str] = Query(None, description="Filter by device ID"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max records to return"),
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get list of all bookmarks with optional filtering.

    Args:
        device_id: Optional device UUID filter
        skip: Pagination offset
        limit: Max records per page
        db: Database session

    Returns:
        List of bookmarks with pagination info
    """
    try:
        # Get bookmarks
        bookmarks = await bookmark_service.get_bookmarks(
            db=db,
            device_id=device_id,
            skip=skip,
            limit=limit
        )

        # Get device names (join)
        device_ids = [str(b.device_id) for b in bookmarks]
        device_result = await db.execute(
            select(Device).filter(Device.id.in_(device_ids))
        )
        devices = {str(d.id): d.name for d in device_result.scalars().all()}

        # Get total count
        count_query = select(func.count(Bookmark.id))
        if device_id:
            count_query = count_query.filter(Bookmark.device_id == device_id)
        total_result = await db.execute(count_query)
        total = total_result.scalar()

        # Format response
        bookmark_list = [
            {
                "id": str(b.id),
                "device_id": str(b.device_id),
                "device_name": devices.get(str(b.device_id), "Unknown"),
                "center_timestamp": b.center_timestamp.isoformat(),
                "start_timestamp": b.start_timestamp.isoformat(),
                "end_timestamp": b.end_timestamp.isoformat(),
                "label": b.label,
                "source": b.source,
                "duration": b.duration,
                "file_size": b.file_size,
                "created_at": b.created_at.isoformat() if b.created_at else None,
                "video_url": f"/api/v1/bookmarks/{b.id}/video",
                "thumbnail_url": f"/api/v1/bookmarks/{b.id}/thumbnail" if b.thumbnail_path else None
            }
            for b in bookmarks
        ]

        return {
            "bookmarks": bookmark_list,
            "total": total,
            "page": skip // limit + 1,
            "page_size": limit
        }

    except Exception as e:
        logger.error(f"Failed to list bookmarks: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list bookmarks: {str(e)}"
        )


@router.get("/{bookmark_id}")
async def get_bookmark(
    bookmark_id: str,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a single bookmark by ID.

    Args:
        bookmark_id: Bookmark UUID
        db: Database session

    Returns:
        Bookmark information
    """
    try:
        bookmark = await bookmark_service.get_bookmark(bookmark_id, db)
        if not bookmark:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Bookmark not found"
            )

        # Get device name
        device_result = await db.execute(
            select(Device).filter(Device.id == bookmark.device_id)
        )
        device = device_result.scalars().first()

        return {
            "id": str(bookmark.id),
            "device_id": str(bookmark.device_id),
            "device_name": device.name if device else "Unknown",
            "center_timestamp": bookmark.center_timestamp.isoformat(),
            "start_timestamp": bookmark.start_timestamp.isoformat(),
            "end_timestamp": bookmark.end_timestamp.isoformat(),
            "label": bookmark.label,
            "source": bookmark.source,
            "duration": bookmark.duration,
            "video_format": bookmark.video_format,
            "file_size": bookmark.file_size,
            "created_at": bookmark.created_at.isoformat() if bookmark.created_at else None,
            "updated_at": bookmark.updated_at.isoformat() if bookmark.updated_at else None,
            "video_url": f"/api/v1/bookmarks/{bookmark.id}/video",
            "thumbnail_url": f"/api/v1/bookmarks/{bookmark.id}/thumbnail" if bookmark.thumbnail_path else None
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get bookmark: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get bookmark: {str(e)}"
        )


@router.put("/{bookmark_id}")
async def update_bookmark(
    bookmark_id: str,
    request: BookmarkUpdate,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Update bookmark metadata (label).

    Args:
        bookmark_id: Bookmark UUID
        request: Update request with new label
        db: Database session

    Returns:
        Updated bookmark information
    """
    try:
        bookmark = await bookmark_service.update_bookmark(
            bookmark_id=bookmark_id,
            label=request.label,
            db=db
        )

        if not bookmark:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Bookmark not found"
            )

        # Get device name
        device_result = await db.execute(
            select(Device).filter(Device.id == bookmark.device_id)
        )
        device = device_result.scalars().first()

        return {
            "status": "success",
            "bookmark": {
                "id": str(bookmark.id),
                "device_id": str(bookmark.device_id),
                "device_name": device.name if device else "Unknown",
                "label": bookmark.label,
                "updated_at": bookmark.updated_at.isoformat() if bookmark.updated_at else None
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update bookmark: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update bookmark: {str(e)}"
        )


@router.delete("/{bookmark_id}")
async def delete_bookmark(
    bookmark_id: str,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Delete a bookmark and its associated files.

    Args:
        bookmark_id: Bookmark UUID
        db: Database session

    Returns:
        Success status
    """
    try:
        deleted = await bookmark_service.delete_bookmark(bookmark_id, db)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Bookmark not found"
            )

        return {
            "status": "success",
            "message": "Bookmark deleted successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete bookmark: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete bookmark: {str(e)}"
        )


@router.get("/{bookmark_id}/video")
async def get_bookmark_video(
    bookmark_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Download/stream the bookmark video file.

    Args:
        bookmark_id: Bookmark UUID
        db: Database session

    Returns:
        Video file
    """
    try:
        bookmark = await bookmark_service.get_bookmark(bookmark_id, db)
        if not bookmark:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Bookmark not found"
            )

        import os
        if not os.path.exists(bookmark.video_file_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Video file not found"
            )

        return FileResponse(
            bookmark.video_file_path,
            media_type="video/mp4",
            filename=f"bookmark_{bookmark.id}.mp4"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get bookmark video: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get video: {str(e)}"
        )


@router.get("/{bookmark_id}/thumbnail")
async def get_bookmark_thumbnail(
    bookmark_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get the bookmark thumbnail image.

    Args:
        bookmark_id: Bookmark UUID
        db: Database session

    Returns:
        Thumbnail image
    """
    try:
        bookmark = await bookmark_service.get_bookmark(bookmark_id, db)
        if not bookmark:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Bookmark not found"
            )

        if not bookmark.thumbnail_path:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Thumbnail not available"
            )

        import os
        if not os.path.exists(bookmark.thumbnail_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Thumbnail file not found"
            )

        return FileResponse(
            bookmark.thumbnail_path,
            media_type="image/jpeg"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get bookmark thumbnail: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get thumbnail: {str(e)}"
        )
