"""API Key authentication middleware."""
import os
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from database import AsyncSessionLocal
from app.models.api_key import ApiKey


# Configuration
REQUIRE_API_KEY = os.getenv("VAS_REQUIRE_AUTH", "false").lower() == "true"
DEFAULT_API_KEY = os.getenv("VAS_API_KEY", None)

# CORS origins for error responses (must match main.py CORS_ORIGINS)
CORS_ORIGINS = [
    "http://10.30.250.245:3200",
    "http://localhost:3200",
    "http://127.0.0.1:3200",
    "http://10.30.250.245:3000",
    "http://localhost:3000",
]


def _get_cors_headers(request: Request) -> dict:
    """Get CORS headers for error responses based on request origin."""
    origin = request.headers.get("origin", "")
    if origin in CORS_ORIGINS:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }
    return {}

# Paths that don't require API key authentication
# (These may still require JWT Bearer token for V2 endpoints)
EXEMPT_PATHS = [
    "/health",
    "/health/detailed",
    "/health/streams",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/v2/auth/token",  # Allow JWT token requests without API key
    "/v2/auth/token/refresh",  # Refresh token serves as credential
    "/v2/auth/token/revoke",  # Revoke doesn't need API key
    "/v2/auth/clients",  # Allow client creation (for initial setup)
]

# Path prefixes that should use JWT Bearer auth instead of API key
# These endpoints bypass API key middleware and handle their own auth
JWT_AUTH_PREFIXES = [
    "/v2/streams",
    "/v2/bookmarks",
    "/v2/snapshots",
    "/v2/consumers",
    "/v2/health",
    "/v2/metrics",
    "/api/v1/devices",  # V1 device endpoints also support JWT auth
]


async def verify_api_key(api_key: str, db: AsyncSession) -> bool:
    """Verify if the provided API key is valid and active."""
    
    # Check if using default API key from environment
    if DEFAULT_API_KEY and api_key == DEFAULT_API_KEY:
        return True
    
    # Check database for API key
    stmt = select(ApiKey).where(
        ApiKey.key == api_key,
        ApiKey.is_active == True
    )
    result = await db.execute(stmt)
    api_key_obj = result.scalar_one_or_none()
    
    if not api_key_obj:
        return False
    
    # Check expiration
    if api_key_obj.expires_at and api_key_obj.expires_at < datetime.now(api_key_obj.expires_at.tzinfo):
        return False
    
    # Update last_used_at
    api_key_obj.last_used_at = datetime.now(datetime.timezone.utc)
    await db.commit()
    
    return True


async def api_key_middleware(request: Request, call_next):
    """Middleware to check API key authentication."""

    # Skip authentication for OPTIONS preflight requests (required for CORS)
    if request.method == "OPTIONS":
        return await call_next(request)

    # Skip authentication if not required
    if not REQUIRE_API_KEY:
        return await call_next(request)

    # Skip authentication for exempt paths
    if request.url.path in EXEMPT_PATHS or request.url.path.startswith("/docs") or request.url.path.startswith("/static") or request.url.path.startswith("/socket.io") or request.url.path.startswith("/ws"):
        return await call_next(request)

    # Skip API key check for V2 paths that use JWT Bearer authentication
    # These endpoints handle their own JWT auth via FastAPI dependencies
    for prefix in JWT_AUTH_PREFIXES:
        if request.url.path.startswith(prefix):
            return await call_next(request)
    
    # Check for API key in headers
    api_key = request.headers.get("X-API-Key")
    
    if not api_key:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "API key required. Please provide X-API-Key header."},
            headers=_get_cors_headers(request)
        )
    
    # Verify API key
    async with AsyncSessionLocal() as db:
        is_valid = await verify_api_key(api_key, db)
    
    if not is_valid:
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Invalid or expired API key."},
            headers=_get_cors_headers(request)
        )
    
    # Continue with request
    return await call_next(request)
