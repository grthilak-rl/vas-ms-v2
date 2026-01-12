"""Stream management endpoints for V2 API."""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Dict, Optional, List
from uuid import UUID
from datetime import datetime, timezone
from database import get_db
import os
from app.schemas.v2.stream import (
    StreamCreate, StreamResponse, StreamListResponse, StreamHealthResponse,
    StreamListItem, ProducerInfo, ConsumerInfo
)
from app.models.stream import Stream, StreamState
from app.models.producer import Producer, ProducerState
from app.models.consumer import Consumer, ConsumerState
from app.models.device import Device
from app.services.stream_state_machine import transition
from app.services.mediasoup_client import MediaSoupClient
from app.middleware.jwt_auth import get_current_user, require_scope
from loguru import logger

router = APIRouter(prefix="/streams", tags=["Streams"])

# Initialize MediaSoup client
mediasoup_url = os.getenv("MEDIASOUP_URL", "ws://localhost:3001")
mediasoup_client = MediaSoupClient(mediasoup_url)


@router.get("", response_model=StreamListResponse, dependencies=[Depends(require_scope("streams:read"))])
async def list_streams(
    state: Optional[str] = Query(None, description="Filter by state (LIVE, READY, ERROR, etc.)"),
    camera_id: Optional[UUID] = Query(None, description="Filter by camera ID"),
    limit: int = Query(50, ge=1, le=100, description="Max results"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> StreamListResponse:
    """
    List all streams with optional filtering.

    Query parameters:
    - state: Filter by stream state (LIVE, READY, ERROR, STOPPED, INITIALIZING, CLOSED)
    - camera_id: Filter by specific camera UUID
    - limit: Maximum number of results (1-100, default 50)
    - offset: Pagination offset (default 0)

    Returns paginated list of streams with producer/consumer info.
    """
    try:
        # Build query
        query = select(Stream)

        if state:
            try:
                state_enum = StreamState[state.upper()]
                query = query.where(Stream.state == state_enum)
            except KeyError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid state: {state}. Valid states: {[s.name for s in StreamState]}"
                )

        if camera_id:
            query = query.where(Stream.camera_id == camera_id)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar()

        # Apply pagination and execute
        query = query.order_by(Stream.created_at.desc()).limit(limit).offset(offset)
        result = await db.execute(query)
        streams = result.scalars().all()

        # Build response objects
        stream_responses = []
        for stream in streams:
            # Get active producer info (filter by ACTIVE state to avoid multiple rows)
            producer_query = select(Producer).where(
                Producer.stream_id == stream.id,
                Producer.state == ProducerState.ACTIVE
            )
            producer_result = await db.execute(producer_query)
            producer = producer_result.scalars().first()

            producer_info = None
            if producer:
                producer_info = ProducerInfo(
                    id=producer.id,
                    mediasoup_id=producer.mediasoup_producer_id,
                    state=producer.state.value,
                    ssrc=producer.ssrc,
                    created_at=producer.created_at
                )

            # Count consumers
            consumer_count_query = select(func.count()).where(Consumer.stream_id == stream.id)
            consumer_count_result = await db.execute(consumer_count_query)
            consumer_count = consumer_count_result.scalar()

            # Calculate uptime for LIVE streams (started_at stored in metadata)
            uptime_seconds = None
            if stream.state == StreamState.LIVE and stream.stream_metadata.get('started_at'):
                try:
                    started_at = datetime.fromisoformat(stream.stream_metadata['started_at'].replace('Z', '+00:00'))
                    uptime_seconds = int((datetime.now(timezone.utc) - started_at).total_seconds())
                except (ValueError, TypeError):
                    pass

            stream_responses.append(StreamListItem(
                id=stream.id,
                name=stream.name,
                camera_id=stream.camera_id,
                state=stream.state.value,
                endpoints={
                    "webrtc": f"/v2/streams/{stream.id}/consume",
                    "hls": f"/v2/streams/{stream.id}/hls",
                    "health": f"/v2/streams/{stream.id}/health"
                },
                created_at=stream.created_at
            ))

        logger.info(f"Listed {len(stream_responses)} streams (total: {total}) for client: {current_user['client_id']}")

        return StreamListResponse(
            streams=stream_responses,
            pagination={"total": total, "limit": limit, "offset": offset}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing streams: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.post("", response_model=StreamResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_scope("streams:write"))])
async def create_stream(
    request: StreamCreate,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> StreamResponse:
    """
    Create a new stream for a camera.

    Request body:
    - name: Descriptive name for the stream
    - camera_id: UUID of the camera/device
    - access_policy: Optional access control settings
    - metadata: Optional extended metadata

    Creates stream in INITIALIZING state. Stream will transition to READY once
    SSRC is captured and producer is created.
    """
    try:
        # Verify camera exists
        device_query = select(Device).where(Device.id == request.camera_id)
        device_result = await db.execute(device_query)
        device = device_result.scalar_one_or_none()

        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Camera {request.camera_id} not found"
            )

        # Create stream
        new_stream = Stream(
            name=request.name,
            camera_id=request.camera_id,
            state=StreamState.INITIALIZING,
            access_policy=request.access_policy,
            stream_metadata=request.metadata,
            codec_config={}  # Will be populated during initialization
        )

        db.add(new_stream)
        await db.flush()

        # Log initial state transition
        await transition(
            stream=new_stream,
            to_state=StreamState.INITIALIZING,
            reason="Stream created via V2 API",
            metadata={"created_by": current_user["client_id"]},
            db=db
        )

        await db.commit()
        await db.refresh(new_stream)

        logger.info(f"Created stream {new_stream.id} for camera {request.camera_id} by {current_user['client_id']}")

        # TODO: Trigger RTSP connection and producer creation in background

        return StreamResponse(
            id=new_stream.id,
            name=new_stream.name,
            camera_id=new_stream.camera_id,
            state=new_stream.state.value,
            producer=None,
            consumers={"count": 0, "active": 0},
            endpoints={
                "webrtc": f"/v2/streams/{new_stream.id}/consume",
                "hls": f"/v2/streams/{new_stream.id}/hls",
                "health": f"/v2/streams/{new_stream.id}/health"
            },
            created_at=new_stream.created_at,
            uptime_seconds=None
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating stream: {str(e)}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.get("/{stream_id}", response_model=StreamResponse, dependencies=[Depends(require_scope("streams:read"))])
async def get_stream(
    stream_id: UUID,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> StreamResponse:
    """
    Get detailed information about a specific stream.

    Returns stream state, producer info, consumer count, and available endpoints.
    """
    try:
        # Get stream
        query = select(Stream).where(Stream.id == stream_id)
        result = await db.execute(query)
        stream = result.scalar_one_or_none()

        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stream {stream_id} not found"
            )

        # Get active producer info (filter by ACTIVE state to avoid multiple rows)
        producer_query = select(Producer).where(
            Producer.stream_id == stream.id,
            Producer.state == ProducerState.ACTIVE
        )
        producer_result = await db.execute(producer_query)
        producer = producer_result.scalars().first()

        producer_info = None
        if producer:
            producer_info = ProducerInfo(
                id=producer.id,
                mediasoup_id=producer.mediasoup_producer_id,
                state=producer.state.value,
                ssrc=producer.ssrc,
                created_at=producer.created_at
            )

        # Count consumers
        consumer_count_query = select(func.count()).where(Consumer.stream_id == stream.id)
        consumer_count_result = await db.execute(consumer_count_query)
        consumer_count = consumer_count_result.scalar()

        # Calculate uptime (started_at stored in metadata)
        uptime_seconds = None
        if stream.state == StreamState.LIVE and stream.stream_metadata.get('started_at'):
            try:
                started_at = datetime.fromisoformat(stream.stream_metadata['started_at'].replace('Z', '+00:00'))
                uptime_seconds = int((datetime.now(timezone.utc) - started_at).total_seconds())
            except (ValueError, TypeError):
                pass

        logger.info(f"Retrieved stream {stream_id} for client: {current_user['client_id']}")

        return StreamResponse(
            id=stream.id,
            name=stream.name,
            camera_id=stream.camera_id,
            state=stream.state.value,
            codec_config=stream.codec_config or {},
            access_policy=stream.access_policy or {},
            metadata=stream.stream_metadata or {},
            producer=producer_info,
            consumers={"count": consumer_count, "active": consumer_count},
            endpoints={
                "webrtc": f"/v2/streams/{stream.id}/consume",
                "hls": f"/v2/streams/{stream.id}/hls",
                "health": f"/v2/streams/{stream.id}/health"
            },
            created_at=stream.created_at,
            uptime_seconds=uptime_seconds
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving stream: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.delete("/{stream_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_scope("streams:write"))])
async def delete_stream(
    stream_id: UUID,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> None:
    """
    Stop and delete a stream.

    This will:
    1. Close all consumers
    2. Close the producer
    3. Stop FFmpeg
    4. Delete the stream record (CASCADE deletes related records)
    """
    try:
        # Get stream
        query = select(Stream).where(Stream.id == stream_id)
        result = await db.execute(query)
        stream = result.scalar_one_or_none()

        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stream {stream_id} not found"
            )

        # Transition to STOPPED first
        if stream.state not in [StreamState.STOPPED, StreamState.CLOSED]:
            await transition(
                stream=stream,
                to_state=StreamState.STOPPED,
                reason=f"Stream deletion requested by {current_user['client_id']}",
                metadata={"deleted_by": current_user["client_id"]},
                db=db
            )

        # TODO: Close all consumers and producer via StreamManager

        # Delete stream (CASCADE will delete producers, consumers, bookmarks, snapshots)
        await db.delete(stream)
        await db.commit()

        logger.info(f"Deleted stream {stream_id} by {current_user['client_id']}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting stream: {str(e)}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.get("/{stream_id}/health", response_model=StreamHealthResponse, dependencies=[Depends(require_scope("streams:read"))])
async def get_stream_health(
    stream_id: UUID,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> StreamHealthResponse:
    """
    Get health metrics for a stream.

    Returns detailed health information including uptime, packet loss, bitrate, etc.
    """
    try:
        # Get stream
        query = select(Stream).where(Stream.id == stream_id)
        result = await db.execute(query)
        stream = result.scalar_one_or_none()

        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stream {stream_id} not found"
            )

        # Calculate uptime (started_at stored in metadata)
        uptime_seconds = None
        if stream.state == StreamState.LIVE and stream.stream_metadata.get('started_at'):
            try:
                started_at = datetime.fromisoformat(stream.stream_metadata['started_at'].replace('Z', '+00:00'))
                uptime_seconds = int((datetime.now(timezone.utc) - started_at).total_seconds())
            except (ValueError, TypeError):
                pass

        # Get producer metrics (filter by ACTIVE state to avoid multiple rows error)
        producer_query = select(Producer).where(
            Producer.stream_id == stream.id,
            Producer.state == ProducerState.ACTIVE
        )
        producer_result = await db.execute(producer_query)
        producer = producer_result.scalars().first()

        # Build producer health info
        producer_info = None
        if producer:
            producer_info = {
                "id": str(producer.id),
                "mediasoup_id": producer.mediasoup_producer_id,
                "state": producer.state.value,
                "bitrate_kbps": 2500,  # Placeholder - TODO: get from MediaSoup
                "fps": 30,  # Placeholder
                "packet_loss": 0.0,  # Placeholder
            }

        # Get consumer statistics
        from app.models.consumer import Consumer, ConsumerState
        consumer_query = select(Consumer).where(Consumer.stream_id == stream.id)
        consumer_result = await db.execute(consumer_query)
        consumers = consumer_result.scalars().all()

        active_consumers = sum(1 for c in consumers if c.state in [ConsumerState.CONNECTING, ConsumerState.CONNECTED])
        consumers_info = {
            "active": active_consumers,
            "total": len(consumers),
            "connecting": sum(1 for c in consumers if c.state == ConsumerState.CONNECTING),
            "connected": sum(1 for c in consumers if c.state == ConsumerState.CONNECTED),
        }

        # Determine health status
        is_healthy = (
            stream.state == StreamState.LIVE and
            producer is not None and
            producer.state == ProducerState.ACTIVE
        )

        if is_healthy:
            health_status = "healthy"
        elif stream.state == StreamState.LIVE:
            health_status = "degraded"
        else:
            health_status = "unhealthy"

        logger.info(f"Health check for stream {stream_id}: {health_status}")

        return StreamHealthResponse(
            status=health_status,
            state=stream.state.value,
            producer=producer_info,
            consumers=consumers_info,
            ffmpeg={"status": "running" if stream.state == StreamState.LIVE else "stopped"},
            recording=None  # TODO: implement recording status
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking stream health: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.get("/{stream_id}/router-capabilities", dependencies=[Depends(require_scope("streams:read"))])
async def get_router_capabilities(
    stream_id: UUID,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> Dict:
    """
    Get MediaSoup router RTP capabilities for a stream.

    This endpoint is required for WebRTC consumer setup. The client needs the
    router's RTP capabilities to:
    1. Determine which codecs are supported
    2. Create a MediaSoup Device on the client side
    3. Generate client RTP capabilities to send in the /consume request

    Standard WebRTC flow:
    1. GET /router-capabilities → Get server capabilities
    2. Client: device.load(routerRtpCapabilities)
    3. Client: Generate device.rtpCapabilities
    4. POST /consume with client's rtpCapabilities → Attach consumer

    Returns:
        rtp_capabilities: MediaSoup router RTP capabilities object
    """
    try:
        # Verify stream exists
        stream_query = select(Stream).where(Stream.id == stream_id)
        stream_result = await db.execute(stream_query)
        stream = stream_result.scalar_one_or_none()

        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stream {stream_id} not found"
            )

        # Get router capabilities from MediaSoup
        try:
            await mediasoup_client.connect()

            # Get router capabilities for the stream's room
            # The MediaSoup server should provide router capabilities per room/stream
            capabilities = await mediasoup_client.get_router_rtp_capabilities(
                room_id=str(stream_id)
            )

            logger.info(f"Retrieved router capabilities for stream {stream_id} by {current_user['client_id']}")

            return {
                "rtp_capabilities": capabilities
            }

        except Exception as e:
            logger.error(f"Failed to get router capabilities: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to get router capabilities: {str(e)}"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting router capabilities: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.get("/{stream_id}/hls/playlist.m3u8", dependencies=[Depends(require_scope("streams:read"))])
async def get_hls_playlist(
    stream_id: UUID,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get HLS playlist for a stream (authenticated).

    This endpoint provides authenticated access to HLS playlists, allowing
    third-party clients to fall back to HLS if WebRTC is not available.

    The playlist is served from the recording directory where FFmpeg outputs
    HLS segments for the stream.

    Usage:
    - Use this as a fallback when WebRTC is not supported or fails
    - Lower latency than downloading full recordings
    - Compatible with any HLS player

    Returns the m3u8 playlist file with appropriate CORS headers.
    """
    try:
        # Verify stream exists
        stream_query = select(Stream).where(Stream.id == stream_id)
        stream_result = await db.execute(stream_query)
        stream = stream_result.scalar_one_or_none()

        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stream {stream_id} not found"
            )

        # Get camera to find recording path
        from app.models.device import Device
        device_query = select(Device).where(Device.id == stream.camera_id)
        device_result = await db.execute(device_query)
        device = device_result.scalar_one_or_none()

        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Camera not found"
            )

        # Construct HLS playlist path
        # Format: /recordings/hot/{device_id}/stream.m3u8
        playlist_path = f"/recordings/hot/{device.id}/stream.m3u8"

        if not os.path.exists(playlist_path):
            # Try alternate location (from FFmpeg)
            playlist_path = f"/tmp/streams/{stream_id}/stream.m3u8"

        if not os.path.exists(playlist_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="HLS playlist not found. Stream may not be generating HLS output."
            )

        logger.info(f"Serving HLS playlist for stream {stream_id} to {current_user['client_id']}")

        return FileResponse(
            playlist_path,
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving HLS playlist: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.get("/{stream_id}/hls/{segment_name}", dependencies=[Depends(require_scope("streams:read"))])
async def get_hls_segment(
    stream_id: UUID,
    segment_name: str,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get HLS segment for a stream (authenticated).

    Serves individual .ts (transport stream) segments referenced in the HLS playlist.

    Security:
    - Requires authentication (JWT bearer token)
    - Validates segment name to prevent directory traversal
    - Only serves segments from stream's directory
    """
    try:
        # Validate segment name (prevent directory traversal)
        if "/" in segment_name or "\\" in segment_name or ".." in segment_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid segment name"
            )

        if not segment_name.endswith(".ts"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid segment file type"
            )

        # Verify stream exists
        stream_query = select(Stream).where(Stream.id == stream_id)
        stream_result = await db.execute(stream_query)
        stream = stream_result.scalar_one_or_none()

        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stream {stream_id} not found"
            )

        # Get camera for path
        from app.models.device import Device
        device_query = select(Device).where(Device.id == stream.camera_id)
        device_result = await db.execute(device_query)
        device = device_result.scalar_one_or_none()

        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Camera not found"
            )

        # Construct segment path
        segment_path = f"/recordings/hot/{device.id}/{segment_name}"

        if not os.path.exists(segment_path):
            # Try alternate location
            segment_path = f"/tmp/streams/{stream_id}/{segment_name}"

        if not os.path.exists(segment_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Segment not found"
            )

        logger.debug(f"Serving HLS segment {segment_name} for stream {stream_id}")

        return FileResponse(
            segment_path,
            media_type="video/mp2t",
            headers={
                "Cache-Control": "public, max-age=3600",  # Segments are immutable
                "Access-Control-Allow-Origin": "*"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving HLS segment: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )
