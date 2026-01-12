"""Authentication endpoints for V2 API."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from app.schemas.v2.auth import (
    TokenRequest, TokenResponse, ClientCreateRequest, ClientCreateResponse,
    RefreshTokenRequest
)
from app.services.auth_service import auth_service
from loguru import logger

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/token", response_model=TokenResponse, status_code=status.HTTP_200_OK)
async def create_token(
    request: TokenRequest,
    db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    """
    Generate JWT access and refresh tokens.

    Third-party clients use this endpoint to authenticate with client_id and client_secret.
    Returns JWT tokens with requested scopes (if authorized).

    Example:
        POST /v2/auth/token
        {
            "client_id": "ruth-ai-client",
            "client_secret": "secret-key-here",
            "scopes": ["streams:read", "streams:consume"]
        }
    """
    try:
        tokens = await auth_service.generate_tokens(
            client_id=request.client_id,
            client_secret=request.client_secret,
            db=db
        )

        logger.info(f"Token generated for client: {request.client_id}")

        return TokenResponse(
            access_token=tokens["access_token"],
            token_type="Bearer",
            expires_in=tokens["expires_in"],
            refresh_token=tokens["refresh_token"],
            scopes=tokens["scopes"]
        )

    except ValueError as e:
        logger.warning(f"Authentication failed for client {request.client_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid client credentials"
        )
    except Exception as e:
        logger.error(f"Token generation error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.post("/token/refresh", status_code=status.HTTP_200_OK)
async def refresh_token(
    request: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db)
) -> dict:
    """
    Refresh an access token using a refresh token.

    Use this endpoint to obtain a new access token before the current one expires.
    Best practice is to refresh when ~80% of the access token TTL has elapsed.

    Note: This endpoint does NOT require X-API-Key or Bearer authentication.
    The refresh token itself serves as the authentication credential.

    Example:
        POST /v2/auth/token/refresh
        {
            "refresh_token": "def456uvw..."
        }

    Returns:
        New access token and rotated refresh token
    """
    try:
        result = await auth_service.refresh_access_token(
            refresh_token=request.refresh_token,
            db=db
        )

        logger.info(f"Access token refreshed successfully")

        return {
            "access_token": result["access_token"],
            "token_type": result["token_type"],
            "expires_in": result["expires_in"],
            "refresh_token": result["refresh_token"]
        }

    except ValueError as e:
        logger.warning(f"Token refresh failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error": "invalid_refresh_token",
                "error_description": str(e)
            }
        )
    except Exception as e:
        logger.error(f"Token refresh error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.post("/token/revoke", status_code=status.HTTP_200_OK)
async def revoke_token(
    request: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db)
) -> dict:
    """
    Revoke a refresh token (logout).

    After revocation, the refresh token can no longer be used to obtain new access tokens.
    This is effectively a logout operation.

    Note: This endpoint does NOT require X-API-Key or Bearer authentication.

    Example:
        POST /v2/auth/token/revoke
        {
            "refresh_token": "def456uvw..."
        }
    """
    try:
        await auth_service.revoke_refresh_token(
            refresh_token=request.refresh_token,
            db=db
        )

        logger.info("Refresh token revoked successfully")

        return {
            "status": "revoked",
            "message": "Token successfully revoked"
        }

    except Exception as e:
        logger.error(f"Token revoke error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.post("/clients", response_model=ClientCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_new_client(
    request: ClientCreateRequest,
    db: AsyncSession = Depends(get_db)
) -> ClientCreateResponse:
    """
    Create a new API client with credentials.

    This endpoint is typically used by administrators to provision new third-party clients.
    Returns client_id and client_secret (SAVE THE SECRET - it won't be shown again).

    Example:
        POST /v2/auth/clients
        {
            "client_id": "ruth-ai-client",
            "scopes": ["streams:read", "streams:consume", "bookmarks:write"]
        }
    """
    try:
        result = await auth_service.create_client(
            client_id=request.client_id,
            scopes=request.scopes,
            db=db
        )

        logger.info(f"Created new client: {request.client_id} with scopes: {request.scopes}")

        return ClientCreateResponse(
            client_id=result["client_id"],
            client_secret=result["client_secret"],
            scopes=result["scopes"],
            created_at=result["created_at"]
        )

    except ValueError as e:
        logger.warning(f"Client creation failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Client creation error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )
