"""
System Monitoring API - VAS-MS-V2

Provides comprehensive system resource monitoring endpoints for:
- Disk space usage (total, VAS-specific)
- CPU utilization
- Memory usage
- Network statistics
- Per-stream resource consumption
"""
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from loguru import logger

from database import get_db
from app.services.system_monitor_service import system_monitor_service
from app.services.stream_ingestion_service import stream_ingestion_service
from app.models.stream import Stream, StreamState
from app.models.device import Device
from app.models.bookmark import Bookmark
from app.models.snapshot import Snapshot

router = APIRouter(prefix="/system", tags=["System Monitoring"])


@router.get("/resources")
async def get_system_resources():
    """
    Get comprehensive system resource metrics.

    Returns:
        System resource metrics including:
        - Disk space (total filesystem and VAS storage)
        - CPU usage (overall and per-core)
        - Memory usage (RAM and swap)
        - Network I/O statistics
        - Overall health status
    """
    try:
        summary = system_monitor_service.get_system_summary()
        return summary

    except Exception as e:
        logger.error(f"Error getting system resources: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get system resources: {str(e)}"
        )


@router.get("/resources/disk")
async def get_disk_usage():
    """
    Get detailed disk usage statistics.

    Returns:
        Disk usage including filesystem and VAS-specific storage breakdown
    """
    try:
        return system_monitor_service.get_disk_usage()

    except Exception as e:
        logger.error(f"Error getting disk usage: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get disk usage: {str(e)}"
        )


@router.get("/resources/cpu")
async def get_cpu_usage():
    """
    Get CPU usage statistics.

    Returns:
        CPU utilization including per-core and load averages
    """
    try:
        return system_monitor_service.get_cpu_usage()

    except Exception as e:
        logger.error(f"Error getting CPU usage: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get CPU usage: {str(e)}"
        )


@router.get("/resources/memory")
async def get_memory_usage():
    """
    Get memory usage statistics.

    Returns:
        RAM and swap memory usage
    """
    try:
        return system_monitor_service.get_memory_usage()

    except Exception as e:
        logger.error(f"Error getting memory usage: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get memory usage: {str(e)}"
        )


@router.get("/resources/network")
async def get_network_stats():
    """
    Get network I/O statistics.

    Returns:
        Network bytes sent/received and packet statistics
    """
    try:
        return system_monitor_service.get_network_stats()

    except Exception as e:
        logger.error(f"Error getting network stats: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get network stats: {str(e)}"
        )


@router.get("/resources/ffmpeg")
async def get_ffmpeg_processes():
    """
    Get FFmpeg process resource usage.

    Returns:
        CPU and memory usage for all FFmpeg processes
    """
    try:
        return await system_monitor_service.get_ffmpeg_process_stats()

    except Exception as e:
        logger.error(f"Error getting FFmpeg process stats: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get FFmpeg process stats: {str(e)}"
        )


@router.get("/resources/streams")
async def get_per_stream_resources():
    """
    Get resource usage per active stream.

    Returns:
        List of streams with their FFmpeg CPU/memory and storage usage
    """
    try:
        return await system_monitor_service.get_per_stream_resources(stream_ingestion_service)

    except Exception as e:
        logger.error(f"Error getting per-stream resources: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get per-stream resources: {str(e)}"
        )


@router.get("/stats")
async def get_system_stats(db: AsyncSession = Depends(get_db)):
    """
    Get aggregate system statistics for the dashboard.

    Returns:
        Aggregate stats including:
        - Total cameras/devices
        - Active streams
        - Total bookmarks
        - Total snapshots
        - Storage usage
        - Per-stream resource breakdown
    """
    try:
        # Count devices
        device_count_query = select(func.count(Device.id))
        device_result = await db.execute(device_count_query)
        total_devices = device_result.scalar() or 0

        # Count streams by state
        stream_counts = {}
        for state in StreamState:
            count_query = select(func.count(Stream.id)).where(Stream.state == state)
            result = await db.execute(count_query)
            stream_counts[state.value] = result.scalar() or 0

        total_streams = sum(stream_counts.values())
        active_streams = stream_counts.get('live', 0)

        # Count bookmarks
        bookmark_count_query = select(func.count(Bookmark.id))
        bookmark_result = await db.execute(bookmark_count_query)
        total_bookmarks = bookmark_result.scalar() or 0

        # Count snapshots
        snapshot_count_query = select(func.count(Snapshot.id))
        snapshot_result = await db.execute(snapshot_count_query)
        total_snapshots = snapshot_result.scalar() or 0

        # Get system resources
        disk = system_monitor_service.get_disk_usage()
        cpu = system_monitor_service.get_cpu_usage()
        memory = system_monitor_service.get_memory_usage()

        # Get per-stream resources
        stream_resources = await system_monitor_service.get_per_stream_resources(stream_ingestion_service)

        # Calculate total FFmpeg resources
        total_ffmpeg_cpu = sum(s['ffmpeg']['cpu_percent'] for s in stream_resources)
        total_ffmpeg_memory = sum(s['ffmpeg']['memory_mb'] for s in stream_resources)

        return {
            "counts": {
                "devices": total_devices,
                "streams": {
                    "total": total_streams,
                    "active": active_streams,
                    "by_state": stream_counts
                },
                "bookmarks": total_bookmarks,
                "snapshots": total_snapshots
            },
            "resources": {
                "disk": {
                    "filesystem_percent": disk.get('filesystem', {}).get('percent_used', 0),
                    "filesystem_used_gb": disk.get('filesystem', {}).get('used_gb', 0),
                    "filesystem_total_gb": disk.get('filesystem', {}).get('total_gb', 0),
                    "filesystem_free_gb": disk.get('filesystem', {}).get('free_gb', 0),
                    "vas_storage_gb": disk.get('vas_storage', {}).get('total_gb', 0),
                    "recordings_gb": disk.get('vas_storage', {}).get('recordings_gb', 0),
                    "status": disk.get('status', 'unknown')
                },
                "cpu": {
                    "percent": cpu.get('percent', 0),
                    "load_1min": cpu.get('load_average', {}).get('1min', 0),
                    "status": cpu.get('status', 'unknown')
                },
                "memory": {
                    "percent": memory.get('ram', {}).get('percent', 0),
                    "used_gb": memory.get('ram', {}).get('used_gb', 0),
                    "total_gb": memory.get('ram', {}).get('total_gb', 0),
                    "status": memory.get('status', 'unknown')
                },
                "ffmpeg": {
                    "total_processes": len(stream_resources),
                    "total_cpu_percent": round(total_ffmpeg_cpu, 1),
                    "total_memory_mb": round(total_ffmpeg_memory, 1)
                }
            },
            "streams": stream_resources,
            "overall_status": system_monitor_service._calculate_overall_status()
        }

    except Exception as e:
        logger.error(f"Error getting system stats: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get system stats: {str(e)}"
        )
