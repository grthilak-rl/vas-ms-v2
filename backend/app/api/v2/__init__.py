"""V2 API router initialization."""
from fastapi import APIRouter
from app.api.v2 import auth, streams, bookmarks, snapshots, consumers, health, metrics, system

# Create main V2 router
v2_router = APIRouter(prefix="/v2")

# Include all V2 sub-routers
v2_router.include_router(auth.router)
v2_router.include_router(streams.router)
v2_router.include_router(consumers.router)  # WebRTC consumer endpoints
v2_router.include_router(bookmarks.router)
v2_router.include_router(bookmarks.bookmark_router)  # Routes without stream_id prefix
v2_router.include_router(snapshots.router)
v2_router.include_router(snapshots.snapshot_router)  # Routes without stream_id prefix
v2_router.include_router(health.router)  # Health monitoring endpoints
v2_router.include_router(metrics.router)  # Prometheus metrics export
v2_router.include_router(system.router)  # System monitoring endpoints
