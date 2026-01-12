"""Consumer (WebRTC) endpoints for V2 API."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict
from uuid import UUID
from datetime import datetime, timezone
from database import get_db
from app.schemas.v2.consumer import (
    ConsumerAttachRequest, ConsumerAttachResponse, ConsumerConnectRequest,
    ICECandidateRequest, TransportInfo
)
from app.models.stream import Stream, StreamState
from app.models.producer import Producer, ProducerState
from app.models.consumer import Consumer, ConsumerState
from app.services.mediasoup_client import MediaSoupClient
from app.middleware.jwt_auth import get_current_user, require_scope
from loguru import logger
import os

router = APIRouter(tags=["Consumers"])

# Initialize MediaSoup client
mediasoup_url = os.getenv("MEDIASOUP_URL", "ws://localhost:3001")
mediasoup_client = MediaSoupClient(mediasoup_url)


@router.post("/streams/{stream_id}/consume", response_model=ConsumerAttachResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_scope("streams:consume"))])
async def attach_consumer(
    stream_id: UUID,
    request: ConsumerAttachRequest,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> ConsumerAttachResponse:
    """
    Attach a WebRTC consumer to a live stream.

    This is the primary endpoint for third-party clients (like Ruth-AI) to start
    receiving WebRTC video from a stream.

    Flow:
    1. Client sends RTP capabilities (from device.rtpCapabilities)
    2. Server creates WebRTC transport with ICE/DTLS parameters
    3. Server creates MediaSoup consumer attached to stream's producer
    4. Client receives transport info and RTP parameters
    5. Client completes connection via /connect endpoint

    Requirements:
    - Stream must be in LIVE state
    - Stream must have an active producer
    - Client must provide valid RTP capabilities

    Returns transport information and RTP parameters for client-side MediaSoup setup.
    """
    try:
        # 1. Verify stream exists and is in LIVE state
        stream_query = select(Stream).where(Stream.id == stream_id)
        stream_result = await db.execute(stream_query)
        stream = stream_result.scalar_one_or_none()

        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stream {stream_id} not found"
            )

        if stream.state != StreamState.LIVE:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "STREAM_NOT_LIVE",
                    "error_description": f"Cannot attach consumer: stream is not in LIVE state",
                    "stream_id": str(stream_id),
                    "current_state": stream.state.value,
                    "required_state": "live",
                    "retry_after_seconds": 2
                }
            )

        # 2. Verify stream has an active producer
        producer_query = select(Producer).where(
            Producer.stream_id == stream_id,
            Producer.state == ProducerState.ACTIVE
        )
        producer_result = await db.execute(producer_query)
        producer = producer_result.scalar_one_or_none()

        if not producer:
            # Check if there's a producer in any state (still initializing)
            any_producer_query = select(Producer).where(Producer.stream_id == stream_id)
            any_producer_result = await db.execute(any_producer_query)
            any_producer = any_producer_result.scalar_one_or_none()

            if any_producer and any_producer.state != ProducerState.ACTIVE:
                # Producer exists but not yet active - suggest retry
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "error": "PRODUCER_NOT_READY",
                        "error_description": f"Producer is initializing (state: {any_producer.state.value}). Retry after a short delay.",
                        "stream_id": str(stream_id),
                        "producer_state": any_producer.state.value,
                        "retry_after_seconds": 2
                    }
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "error": "NO_PRODUCER",
                        "error_description": "Stream has no producer. The stream may not be fully started.",
                        "stream_id": str(stream_id),
                        "retry_after_seconds": 5
                    }
                )

        # Use camera_id as room_id (MediaSoup router is created per device, not per stream)
        room_id = str(stream.camera_id)

        logger.info(
            f"Attaching consumer for client {request.client_id} to stream {stream_id} "
            f"(producer: {producer.mediasoup_producer_id}, room: {room_id})"
        )

        # 3. Create WebRTC transport for consumer
        try:
            await mediasoup_client.connect()

            transport_info = await mediasoup_client.create_webrtc_transport(
                room_id=room_id
            )

            logger.info(f"Created WebRTC transport: {transport_info['id']}")
        except Exception as e:
            logger.error(f"Failed to create WebRTC transport: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to create WebRTC transport: {str(e)}"
            )

        # 4. Create consumer on MediaSoup
        try:
            consumer_info = await mediasoup_client.consume(
                transport_id=transport_info["id"],
                producer_id=producer.mediasoup_producer_id,
                rtp_capabilities=request.rtp_capabilities
            )

            logger.info(f"Created MediaSoup consumer: {consumer_info['id']}")
        except Exception as e:
            logger.error(f"Failed to create consumer: {str(e)}")
            # Cleanup transport
            try:
                await mediasoup_client.close_transport(transport_info["id"])
            except:
                pass
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to create consumer: {str(e)}"
            )

        # 5. Create Consumer record in database
        new_consumer = Consumer(
            stream_id=stream_id,
            client_id=request.client_id,
            mediasoup_consumer_id=consumer_info["id"],
            mediasoup_transport_id=transport_info["id"],
            state=ConsumerState.CONNECTING
        )

        db.add(new_consumer)
        await db.commit()
        await db.refresh(new_consumer)

        logger.info(
            f"Consumer {new_consumer.id} created for client {request.client_id} "
            f"on stream {stream_id}"
        )

        # 6. Build response
        transport = TransportInfo(
            id=transport_info["id"],
            ice_parameters=transport_info["iceParameters"],
            ice_candidates=transport_info["iceCandidates"],
            dtls_parameters=transport_info["dtlsParameters"]
        )

        return ConsumerAttachResponse(
            consumer_id=new_consumer.id,
            transport=transport,
            rtp_parameters=consumer_info["rtpParameters"]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error attaching consumer: {str(e)}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.post("/streams/{stream_id}/consumers/{consumer_id}/connect", status_code=status.HTTP_200_OK, dependencies=[Depends(require_scope("streams:consume"))])
async def connect_consumer(
    stream_id: UUID,
    consumer_id: UUID,
    request: ConsumerConnectRequest,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> Dict:
    """
    Complete DTLS handshake for consumer transport.

    After receiving transport info from /consume endpoint, the client must:
    1. Create local transport with the provided parameters
    2. Call transport.connect() with local DTLS parameters
    3. Send those DTLS parameters to this endpoint

    This completes the WebRTC connection and allows media to flow.
    """
    try:
        # 1. Verify consumer exists and belongs to this stream
        consumer_query = select(Consumer).where(
            Consumer.id == consumer_id,
            Consumer.stream_id == stream_id
        )
        consumer_result = await db.execute(consumer_query)
        consumer = consumer_result.scalar_one_or_none()

        if not consumer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Consumer {consumer_id} not found on stream {stream_id}"
            )

        if consumer.state not in [ConsumerState.CONNECTING, ConsumerState.CONNECTED]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Consumer is in {consumer.state.value} state. Cannot connect."
            )

        logger.info(f"Connecting consumer {consumer_id} transport {consumer.mediasoup_transport_id}")

        # 2. Connect transport on MediaSoup
        try:
            await mediasoup_client.connect()

            await mediasoup_client.connect_webrtc_transport(
                transport_id=consumer.mediasoup_transport_id,
                dtls_parameters=request.dtls_parameters
            )

            logger.info(f"Transport {consumer.mediasoup_transport_id} connected successfully")
        except Exception as e:
            logger.error(f"Failed to connect transport: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to connect transport: {str(e)}"
            )

        # 3. Update consumer state to CONNECTED
        consumer.state = ConsumerState.CONNECTED
        consumer.last_seen_at = datetime.now(timezone.utc)
        await db.commit()

        logger.info(f"Consumer {consumer_id} connected successfully")

        return {
            "status": "connected",
            "consumer_id": str(consumer.id),
            "transport_id": consumer.mediasoup_transport_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error connecting consumer: {str(e)}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.post("/streams/{stream_id}/consumers/{consumer_id}/ice-candidate", status_code=status.HTTP_200_OK, dependencies=[Depends(require_scope("streams:consume"))])
async def add_ice_candidate(
    stream_id: UUID,
    consumer_id: UUID,
    request: ICECandidateRequest,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> Dict:
    """
    Add ICE candidate for consumer transport.

    During WebRTC connection establishment, the client discovers ICE candidates
    (network addresses) and sends them to the server for connectivity negotiation.

    This endpoint accepts ICE candidates from the client and forwards them to MediaSoup.

    Note: This is typically optional if the initial ICE candidates in the transport
    creation response are sufficient. Use this endpoint if connection fails initially.
    """
    try:
        # 1. Verify consumer exists
        consumer_query = select(Consumer).where(
            Consumer.id == consumer_id,
            Consumer.stream_id == stream_id
        )
        consumer_result = await db.execute(consumer_query)
        consumer = consumer_result.scalar_one_or_none()

        if not consumer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Consumer {consumer_id} not found on stream {stream_id}"
            )

        logger.info(f"Received ICE candidate for consumer {consumer_id}: {request.candidate}")

        # 2. Forward ICE candidate to MediaSoup
        # Note: The current MediaSoupClient doesn't have an add_ice_candidate method
        # This would typically be implemented as:
        # await mediasoup_client.add_ice_candidate(
        #     transport_id=consumer.mediasoup_transport_id,
        #     candidate=request.candidate
        # )

        # For now, log and acknowledge
        logger.warning("ICE candidate forwarding not yet implemented in MediaSoupClient")

        # Update last seen timestamp
        consumer.last_seen_at = datetime.now(timezone.utc)
        await db.commit()

        return {
            "status": "acknowledged",
            "consumer_id": str(consumer.id),
            "message": "ICE candidate received (forwarding not yet implemented)"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding ICE candidate: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.delete("/streams/{stream_id}/consumers/{consumer_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_scope("streams:consume"))])
async def detach_consumer(
    stream_id: UUID,
    consumer_id: UUID,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> None:
    """
    Detach and close a consumer.

    Closes the MediaSoup consumer and transport, then marks the consumer as CLOSED
    in the database.

    Use this endpoint when the client is done consuming the stream or needs to
    disconnect gracefully.
    """
    try:
        # 1. Verify consumer exists
        consumer_query = select(Consumer).where(
            Consumer.id == consumer_id,
            Consumer.stream_id == stream_id
        )
        consumer_result = await db.execute(consumer_query)
        consumer = consumer_result.scalar_one_or_none()

        if not consumer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Consumer {consumer_id} not found on stream {stream_id}"
            )

        logger.info(f"Detaching consumer {consumer_id} from stream {stream_id}")

        # 2. Close consumer on MediaSoup (if not already closed)
        if consumer.state != ConsumerState.CLOSED:
            try:
                await mediasoup_client.connect()

                # Close consumer (method may need to be added to MediaSoupClient)
                # await mediasoup_client.close_consumer(consumer.mediasoup_consumer_id)

                # Close transport
                await mediasoup_client.close_transport(consumer.mediasoup_transport_id)

                logger.info(f"Closed transport {consumer.mediasoup_transport_id}")
            except Exception as e:
                logger.warning(f"Failed to close MediaSoup resources: {str(e)}")
                # Continue anyway - update database state

        # 3. Update consumer state to CLOSED
        consumer.state = ConsumerState.CLOSED
        consumer.closed_at = datetime.now(timezone.utc)
        await db.commit()

        logger.info(f"Consumer {consumer_id} detached successfully")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error detaching consumer: {str(e)}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.get("/streams/{stream_id}/consumers", status_code=status.HTTP_200_OK, dependencies=[Depends(require_scope("streams:read"))])
async def list_consumers(
    stream_id: UUID,
    current_user: Dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> Dict:
    """
    List all consumers attached to a stream.

    Returns information about all active and historical consumers for monitoring
    and debugging purposes.
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

        # Get all consumers
        consumers_query = select(Consumer).where(Consumer.stream_id == stream_id)
        consumers_result = await db.execute(consumers_query)
        consumers = consumers_result.scalars().all()

        consumer_list = [
            {
                "id": str(c.id),
                "client_id": c.client_id,
                "state": c.state.value,
                "created_at": c.created_at.isoformat(),
                "last_seen_at": c.last_seen_at.isoformat() if c.last_seen_at else None,
                "closed_at": c.closed_at.isoformat() if c.closed_at else None,
                "mediasoup_consumer_id": c.mediasoup_consumer_id
            }
            for c in consumers
        ]

        active_count = sum(1 for c in consumers if c.state in [ConsumerState.CONNECTING, ConsumerState.CONNECTED])

        return {
            "stream_id": str(stream_id),
            "total_consumers": len(consumer_list),
            "active_consumers": active_count,
            "consumers": consumer_list
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing consumers: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )
