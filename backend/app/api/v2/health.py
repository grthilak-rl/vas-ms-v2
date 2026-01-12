"""
Health Monitoring API - Phase 3 VAS-MS-V2

Provides comprehensive health monitoring endpoints for:
- Overall system health
- Individual stream health
- FFmpeg process health
- MediaSoup producer health
- Consumer session health
"""
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger

from database import get_db
from app.services.stream_ingestion_service import stream_ingestion_service
from app.services.producer_service import producer_service
from app.services.consumer_service import consumer_service
from app.services.recording_management_service import recording_management_service
from app.models.stream import Stream
from sqlalchemy import select, func

router = APIRouter(prefix="/health", tags=["Health Monitoring"])


@router.get("/system")
async def get_system_health(db: AsyncSession = Depends(get_db)):
    """
    Get overall system health status.

    Returns:
        System health metrics including:
        - Total streams by state
        - Total active producers
        - Total active consumers
        - Active FFmpeg processes
    """
    try:
        # Count streams by state
        from app.models.stream import StreamState
        stream_counts = {}
        for state in StreamState:
            count_query = select(func.count(Stream.id)).where(Stream.state == state)
            result = await db.execute(count_query)
            stream_counts[state.value] = result.scalar()

        # Get active ingestions
        active_ingestions = await stream_ingestion_service.get_all_active_ingestions()

        # Get active producers
        active_producers = await producer_service.get_all_active_producers()

        # Get active consumers
        active_consumers = await consumer_service.get_all_active_consumers(db)

        return {
            "status": "healthy",
            "timestamp": func.now(),
            "components": {
                "database": "healthy",
                "ffmpeg": {
                    "status": "healthy",
                    "active_processes": active_ingestions["total_active"]
                },
                "mediasoup": {
                    "status": "healthy",
                    "active_producers": active_producers["total_active"]
                }
            },
            "streams": {
                "total": sum(stream_counts.values()),
                "by_state": stream_counts
            },
            "consumers": {
                "active": active_consumers["total_active"]
            }
        }

    except Exception as e:
        logger.error(f"Error getting system health: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Health check failed: {str(e)}")


@router.get("/streams/{stream_id}")
async def get_stream_health(
    stream_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed health status for a specific stream.

    Args:
        stream_id: Stream UUID

    Returns:
        Detailed stream health including:
        - Stream state
        - FFmpeg process health
        - Producer health
        - Consumer statistics
    """
    try:
        # Get stream
        stream_query = select(Stream).where(Stream.id == stream_id)
        stream_result = await db.execute(stream_query)
        stream = stream_result.scalar_one_or_none()

        if not stream:
            raise HTTPException(status_code=404, detail=f"Stream {stream_id} not found")

        # Get FFmpeg ingestion health
        ffmpeg_health = None
        try:
            ffmpeg_health = await stream_ingestion_service.get_ingestion_health(stream_id)
        except Exception as e:
            logger.warning(f"Could not get FFmpeg health: {str(e)}")
            ffmpeg_health = {"status": "unknown", "message": str(e)}

        # Get producer health - query by stream_id, not producer_id attribute
        producer_health = None
        from app.models.producer import Producer, ProducerState
        producer_query = select(Producer).where(
            Producer.stream_id == stream_id,
            Producer.state == ProducerState.ACTIVE
        )
        producer_result = await db.execute(producer_query)
        producer = producer_result.scalar_one_or_none()

        if producer:
            try:
                producer_health = await producer_service.get_producer_stats(
                    producer.id,
                    db
                )
            except Exception as e:
                logger.warning(f"Could not get producer stats: {str(e)}")
                producer_health = {"status": "error", "message": str(e)}

        # Get consumer statistics
        consumer_stats = None
        try:
            consumer_stats = await consumer_service.get_stream_consumer_stats(stream_id, db)
        except Exception as e:
            logger.warning(f"Could not get consumer stats: {str(e)}")
            consumer_stats = {"status": "unknown", "message": str(e)}

        # Calculate uptime from stream_metadata (started_at is stored there, not as direct attribute)
        uptime_seconds = None
        started_at_str = stream.stream_metadata.get('started_at') if stream.stream_metadata else None
        if started_at_str:
            try:
                from datetime import datetime, timezone
                started_at = datetime.fromisoformat(started_at_str.replace('Z', '+00:00'))
                uptime_seconds = int((datetime.now(timezone.utc) - started_at).total_seconds())
            except (ValueError, TypeError) as e:
                logger.warning(f"Could not calculate uptime: {str(e)}")

        return {
            "stream_id": str(stream_id),
            "name": stream.name,
            "state": stream.state.value,
            "camera_id": str(stream.camera_id),
            "ffmpeg": ffmpeg_health,
            "producer": producer_health,
            "consumers": consumer_stats,
            "uptime_seconds": uptime_seconds
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting stream health for {stream_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get stream health: {str(e)}"
        )


@router.get("/ingestion")
async def get_all_ingestion_health():
    """
    Get health status of all active FFmpeg ingestion processes.

    Returns:
        List of all active ingestion processes with their health metrics
    """
    try:
        active_ingestions = await stream_ingestion_service.get_all_active_ingestions()
        return active_ingestions

    except Exception as e:
        logger.error(f"Error getting ingestion health: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get ingestion health: {str(e)}"
        )


@router.get("/producers")
async def get_all_producer_health():
    """
    Get health status of all active MediaSoup producers.

    Returns:
        List of all active producers with their metrics
    """
    try:
        active_producers = await producer_service.get_all_active_producers()
        return active_producers

    except Exception as e:
        logger.error(f"Error getting producer health: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get producer health: {str(e)}"
        )


@router.get("/consumers")
async def get_all_consumer_health(db: AsyncSession = Depends(get_db)):
    """
    Get health status of all active consumers.

    Returns:
        List of all active consumers with session metrics
    """
    try:
        active_consumers = await consumer_service.get_all_active_consumers(db)
        return active_consumers

    except Exception as e:
        logger.error(f"Error getting consumer health: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get consumer health: {str(e)}"
        )


@router.get("/consumers/{consumer_id}")
async def get_consumer_health(
    consumer_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed health status for a specific consumer.

    Args:
        consumer_id: Consumer UUID

    Returns:
        Detailed consumer session statistics
    """
    try:
        consumer_stats = await consumer_service.get_consumer_session_stats(
            consumer_id,
            db
        )
        return consumer_stats

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting consumer health for {consumer_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get consumer health: {str(e)}"
        )


@router.post("/consumers/{consumer_id}/heartbeat")
async def consumer_heartbeat(
    consumer_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """
    Record a heartbeat for a consumer.

    Consumers should call this endpoint periodically (recommended: every 30 seconds)
    to indicate they are still actively consuming the stream.

    Args:
        consumer_id: Consumer UUID

    Returns:
        Heartbeat acknowledgment
    """
    try:
        heartbeat_result = await consumer_service.record_heartbeat(consumer_id, db)
        return heartbeat_result

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error recording heartbeat for consumer {consumer_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to record heartbeat: {str(e)}"
        )


@router.get("/recordings")
async def get_all_recordings_stats():
    """
    Get statistics for all recordings.

    Returns:
        Overall recording statistics including disk usage
    """
    try:
        stats = recording_management_service.get_all_recordings_stats()
        return stats

    except Exception as e:
        logger.error(f"Error getting recordings stats: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get recordings stats: {str(e)}"
        )


@router.get("/recordings/{stream_id}")
async def get_stream_recording_stats(stream_id: UUID):
    """
    Get recording statistics for a specific stream.

    Args:
        stream_id: Stream UUID

    Returns:
        Recording statistics for the stream
    """
    try:
        stats = recording_management_service.get_recording_stats(stream_id)
        return stats

    except Exception as e:
        logger.error(f"Error getting recording stats for stream {stream_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get recording stats: {str(e)}"
        )


@router.post("/recordings/{stream_id}/cleanup")
async def cleanup_stream_recordings(
    stream_id: UUID,
    retention_days: Optional[int] = None
):
    """
    Clean up old recordings for a specific stream.

    Args:
        stream_id: Stream UUID
        retention_days: Retention period in days (default: 7)

    Returns:
        Cleanup statistics
    """
    try:
        cleanup_result = await recording_management_service.cleanup_stream_recordings(
            stream_id,
            retention_days
        )
        return cleanup_result

    except Exception as e:
        logger.error(f"Error cleaning up recordings for stream {stream_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to cleanup recordings: {str(e)}"
        )


@router.post("/recordings/cleanup")
async def cleanup_all_recordings(
    retention_days: Optional[int] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Clean up old recordings for all streams.

    Args:
        retention_days: Retention period in days (default: 7)

    Returns:
        Overall cleanup statistics
    """
    try:
        cleanup_result = await recording_management_service.cleanup_old_recordings(
            db,
            retention_days
        )
        return cleanup_result

    except Exception as e:
        logger.error(f"Error cleaning up all recordings: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to cleanup recordings: {str(e)}"
        )
