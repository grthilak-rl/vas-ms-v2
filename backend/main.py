"""
Main FastAPI application entry point.
"""
from fastapi import FastAPI, Request, status, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from contextlib import asynccontextmanager
from datetime import datetime
from sqlalchemy import text
import sys
import os
import asyncio
import websockets

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config.logging_config import setup_logging
from database import engine, Base
from loguru import logger
from app.middleware.auth import api_key_middleware

# Initialize logging
logger = setup_logging()

# Default client credentials - used for frontend and API access
# These are well-known credentials for development/testing
# In production, use environment variables
DEFAULT_CLIENT_ID = os.getenv("VAS_DEFAULT_CLIENT_ID", "vas-portal")
DEFAULT_CLIENT_SECRET = os.getenv("VAS_DEFAULT_CLIENT_SECRET", "vas-portal-secret-2024")
DEFAULT_SCOPES = [
    "streams:read",
    "streams:consume",
    "bookmarks:read",
    "bookmarks:write",
    "snapshots:read",
    "snapshots:write"
]


async def seed_default_client():
    """Create or update default API client."""
    from database import AsyncSessionLocal
    from app.models.auth import JWTToken
    from sqlalchemy import select
    import hashlib

    async with AsyncSessionLocal() as db:
        try:
            # Check if default client exists
            result = await db.execute(
                select(JWTToken).filter(JWTToken.client_id == DEFAULT_CLIENT_ID)
            )
            existing = result.scalars().first()
            secret_hash = hashlib.sha256(DEFAULT_CLIENT_SECRET.encode()).hexdigest()

            if not existing:
                # Create the default client with known credentials
                jwt_token = JWTToken(
                    client_id=DEFAULT_CLIENT_ID,
                    client_secret_hash=secret_hash,
                    scopes=DEFAULT_SCOPES,
                    is_active=True
                )

                db.add(jwt_token)
                await db.commit()

                logger.info(f"✅ Created default API client: {DEFAULT_CLIENT_ID}")
                logger.info(f"   Client ID: {DEFAULT_CLIENT_ID}")
                logger.info(f"   Client Secret: {DEFAULT_CLIENT_SECRET}")
            elif existing.client_secret_hash != secret_hash:
                # Update the secret to match the expected value
                existing.client_secret_hash = secret_hash
                existing.scopes = DEFAULT_SCOPES
                existing.is_active = True
                await db.commit()
                logger.info(f"✅ Updated default API client secret: {DEFAULT_CLIENT_ID}")
                logger.info(f"   Client ID: {DEFAULT_CLIENT_ID}")
                logger.info(f"   Client Secret: {DEFAULT_CLIENT_SECRET}")
            else:
                logger.info(f"✅ Default API client already exists: {DEFAULT_CLIENT_ID}")

        except Exception as e:
            logger.error(f"Failed to seed default client: {e}")
            await db.rollback()


# Lifespan context manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan events for application startup and shutdown."""
    logger.info("Starting VAS Backend Application...")

    # Create database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    logger.info("Database tables created/verified")

    # Seed default client for frontend/API access
    await seed_default_client()

    # Start stream health monitor
    from app.services.stream_health_monitor import stream_health_monitor
    from app.services.stream_restart_handler import restart_stream_handler

    # Configure restart callback
    stream_health_monitor.set_restart_callback(restart_stream_handler)

    # Start the health monitor
    await stream_health_monitor.start()
    logger.info("Stream health monitor started")

    logger.info("VAS Backend Application started successfully")

    yield

    logger.info("Shutting down VAS Backend Application...")

    # Stop stream health monitor
    await stream_health_monitor.stop()
    logger.info("Stream health monitor stopped")

    await engine.dispose()

# Create FastAPI app
app = FastAPI(
    title="Video Aggregation Service (VAS)",
    description="MediaSoup-based video streaming service for RTSP to WebRTC conversion",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware - configured for frontend at port 3200
# Allow all origins for now to simplify debugging
# TODO: Restrict to specific origins in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # Must be False when allow_origins=["*"]
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "X-Request-Id"],
    max_age=600,  # Cache preflight response for 10 minutes
)

# API Key authentication middleware
app.middleware("http")(api_key_middleware)

# Error handlers
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handle HTTP exceptions."""
    logger.error(f"HTTP error {exc.status_code}: {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "status": exc.status_code,
                "message": exc.detail,
                "path": str(request.url)
            }
        }
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation errors."""
    # Convert errors to JSON-serializable format (handle bytes)
    errors = []
    for error in exc.errors():
        err_dict = {}
        for key, value in error.items():
            if isinstance(value, bytes):
                err_dict[key] = value.decode('utf-8', errors='replace')
            else:
                err_dict[key] = value
        errors.append(err_dict)

    logger.error(f"Validation error: {errors}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": {
                "status": status.HTTP_422_UNPROCESSABLE_ENTITY,
                "message": "Validation error",
                "details": errors,
                "path": str(request.url)
            }
        }
    )

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "VAS Backend",
        "version": "1.0.0"
    }


@app.get("/health/detailed")
async def health_check_detailed():
    """Detailed health check endpoint."""
    from database import engine
    from app.services.websocket_manager import websocket_manager
    from app.services.stream_health_monitor import stream_health_monitor

    # Check database
    db_healthy = False
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
            db_healthy = True
    except Exception as e:
        logger.error(f"Database health check failed: {e}")

    # Check Redis (if configured)
    redis_healthy = False
    try:
        # Redis check would go here
        redis_healthy = True
    except Exception:
        pass

    # Check WebSocket manager
    ws_healthy = websocket_manager is not None

    # Get stream health monitor status
    health_monitor_status = stream_health_monitor.get_status()

    overall_status = "healthy" if all([db_healthy, ws_healthy]) else "degraded"

    return {
        "status": overall_status,
        "service": "VAS Backend",
        "version": "1.0.0",
        "checks": {
            "database": db_healthy,
            "redis": redis_healthy,
            "websocket": ws_healthy
        },
        "stream_health_monitor": health_monitor_status,
        "timestamp": datetime.now().isoformat()
    }


@app.get("/health/streams")
async def stream_health_status():
    """Get detailed stream health status."""
    from app.services.stream_health_monitor import stream_health_monitor
    from app.services.rtsp_pipeline import rtsp_pipeline

    health_status = stream_health_monitor.get_status()
    active_streams = await rtsp_pipeline.list_active_streams()

    return {
        "health_monitor": health_status,
        "active_streams": active_streams,
        "timestamp": datetime.now().isoformat()
    }

# Root endpoint
@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Video Aggregation Service (VAS) API",
        "version": "1.0.0",
        "v2_api": {
            "base_url": "/v2",
            "authentication": "/v2/auth/token",
            "streams": "/v2/streams",
            "bookmarks": "/v2/bookmarks",
            "snapshots": "/v2/snapshots"
        },
        "docs": "/docs",
        "health": "/health"
    }

# API routes - V1 (existing)
from app.routes import devices, streams, mediasoup, rtsp_pipeline, recordings, websocket, snapshots, bookmarks, api_keys, ruth_ai_compat

app.include_router(devices.router)
app.include_router(streams.router)
app.include_router(mediasoup.router)
app.include_router(rtsp_pipeline.router)
app.include_router(recordings.router)
app.include_router(websocket.router)
app.include_router(snapshots.router)
app.include_router(bookmarks.router)
app.include_router(api_keys.router)
app.include_router(ruth_ai_compat.router)

# API routes - V2 (new)
from app.api.v2 import v2_router
app.include_router(v2_router)

# Add routes for HLS streaming (without api/v1 prefix for convenience)
from fastapi.responses import FileResponse

@app.get("/streams/{stream_id}/playlist.m3u8")
async def serve_hls_playlist(stream_id: str, request: Request):
    """Serve HLS playlist."""
    from fastapi import HTTPException
    playlist_path = f"/tmp/streams/{stream_id}/stream.m3u8"
    
    if not os.path.exists(playlist_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Playlist not found"
        )
    
    return FileResponse(
        playlist_path,
        media_type="application/vnd.apple.mpegurl",
        headers={
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
            "X-Forwarded-Host": str(request.url.hostname)
        }
    )

@app.get("/streams/{stream_id}/{segment_name}")
async def serve_hls_segment(stream_id: str, segment_name: str, request: Request):
    """Serve HLS segment."""
    from fastapi import HTTPException
    segment_path = f"/tmp/streams/{stream_id}/{segment_name}"
    
    if not os.path.exists(segment_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Segment not found"
        )
    
    return FileResponse(
        segment_path,
        media_type="video/mp2t",
        headers={
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*"
        }
    )

# MediaSoup WebSocket Proxy
@app.websocket("/ws/mediasoup")
async def mediasoup_websocket_proxy(websocket: WebSocket):
    """
    WebSocket proxy to MediaSoup server.
    This allows the frontend to connect through the backend (port 8080)
    instead of directly to MediaSoup (port 3001), solving network/firewall issues.
    """
    await websocket.accept()
    logger.info(f"WebSocket proxy: Client connected from {websocket.client.host}")
    
    mediasoup_url = os.getenv("MEDIASOUP_URL", "ws://10.30.250.245:3001")
    mediasoup_ws = None
    
    try:
        # Connect to MediaSoup server
        logger.info(f"WebSocket proxy: Connecting to MediaSoup at {mediasoup_url}")
        mediasoup_ws = await websockets.connect(mediasoup_url)
        logger.info("WebSocket proxy: Connected to MediaSoup server")
        
        # Create bidirectional proxy
        async def client_to_mediasoup():
            """Forward messages from client to MediaSoup"""
            try:
                while True:
                    data = await websocket.receive_text()
                    logger.debug(f"WebSocket proxy: Client → MediaSoup: {data[:100]}...")
                    await mediasoup_ws.send(data)
            except WebSocketDisconnect:
                logger.info("WebSocket proxy: Client disconnected")
            except Exception as e:
                logger.error(f"WebSocket proxy: Error in client→mediasoup: {e}")
        
        async def mediasoup_to_client():
            """Forward messages from MediaSoup to client"""
            try:
                async for message in mediasoup_ws:
                    logger.debug(f"WebSocket proxy: MediaSoup → Client: {message[:100]}...")
                    await websocket.send_text(message)
            except Exception as e:
                logger.error(f"WebSocket proxy: Error in mediasoup→client: {e}")
        
        # Run both directions concurrently
        await asyncio.gather(
            client_to_mediasoup(),
            mediasoup_to_client(),
            return_exceptions=True
        )
        
    except Exception as e:
        logger.error(f"WebSocket proxy: Connection error: {e}")
        try:
            await websocket.close(code=1011, reason=f"MediaSoup connection failed: {str(e)}")
        except:
            pass
    finally:
        if mediasoup_ws:
            await mediasoup_ws.close()
        logger.info("WebSocket proxy: Connection closed")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)

