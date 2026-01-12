"""JWT authentication service."""
import jwt
import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger

from app.models.auth import JWTToken, RefreshToken
from config.settings import settings


def _utcnow() -> datetime:
    """Return current UTC time as timezone-aware datetime."""
    return datetime.now(timezone.utc)


class AuthService:
    """
    Service for JWT token generation, validation, and refresh.

    Implements a stateless JWT authentication system with:
    - Access tokens (short-lived, 1 hour default)
    - Refresh tokens (long-lived, 7 days default)
    - Scope-based permissions
    - Token rotation on refresh
    """

    def __init__(self):
        # JWT configuration
        self.secret_key = settings.jwt_secret_key if hasattr(settings, 'jwt_secret_key') else "CHANGE_ME_IN_PRODUCTION"
        self.algorithm = "HS256"
        self.access_token_expire_minutes = 60  # 1 hour
        self.refresh_token_expire_days = 7  # 7 days

        if self.secret_key == "CHANGE_ME_IN_PRODUCTION":
            logger.warning("⚠️  Using default JWT secret key! Set JWT_SECRET_KEY in production!")

    async def create_client(
        self,
        client_id: str,
        scopes: List[str],
        db: AsyncSession,
        expires_at: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Create a new API client with credentials.

        Args:
            client_id: Unique client identifier (e.g., "ruth-ai")
            scopes: List of permission scopes
            db: Database session
            expires_at: Optional expiry datetime

        Returns:
            Dict with client_id, client_secret (plaintext, shown only once)
        """
        # Check if client already exists
        result = await db.execute(
            select(JWTToken).filter(JWTToken.client_id == client_id)
        )
        existing = result.scalars().first()
        if existing:
            raise ValueError(f"Client {client_id} already exists")

        # Generate client secret
        client_secret = secrets.token_urlsafe(32)  # 32-byte random secret
        client_secret_hash = self._hash_secret(client_secret)

        # Create JWT token record
        jwt_token = JWTToken(
            client_id=client_id,
            client_secret_hash=client_secret_hash,
            scopes=scopes,
            is_active=True,
            expires_at=expires_at
        )

        db.add(jwt_token)
        await db.commit()
        await db.refresh(jwt_token)

        logger.info(f"Created API client: {client_id} with scopes {scopes}")

        return {
            "client_id": client_id,
            "client_secret": client_secret,  # ⚠️  Only returned once!
            "scopes": scopes,
            "created_at": jwt_token.created_at.isoformat()
        }

    async def generate_tokens(
        self,
        client_id: str,
        client_secret: str,
        db: AsyncSession
    ) -> Dict[str, Any]:
        """
        Generate access and refresh tokens for a client.

        Args:
            client_id: Client identifier
            client_secret: Client secret (plaintext)
            db: Database session

        Returns:
            Dict with access_token, refresh_token, expires_in, scopes

        Raises:
            ValueError: If credentials are invalid
        """
        # Fetch client
        result = await db.execute(
            select(JWTToken).filter(JWTToken.client_id == client_id)
        )
        client = result.scalars().first()

        if not client:
            raise ValueError("Invalid client_id or client_secret")

        # Verify client secret
        if not self._verify_secret(client_secret, client.client_secret_hash):
            raise ValueError("Invalid client_id or client_secret")

        # Check if client is active
        if not client.is_active:
            raise ValueError("Client is inactive")

        # Check if client has expired
        if client.expires_at and client.expires_at < _utcnow():
            raise ValueError("Client credentials have expired")

        # Generate access token
        access_token_payload = {
            "sub": client_id,
            "scopes": client.scopes,
            "type": "access",
            "iat": _utcnow(),
            "exp": _utcnow() + timedelta(minutes=self.access_token_expire_minutes)
        }
        access_token = jwt.encode(access_token_payload, self.secret_key, algorithm=self.algorithm)

        # Generate refresh token
        refresh_token_value = secrets.token_urlsafe(32)
        refresh_token_hash = self._hash_secret(refresh_token_value)

        refresh_token_record = RefreshToken(
            token_hash=refresh_token_hash,
            client_id=client_id,
            is_revoked=False,
            expires_at=_utcnow() + timedelta(days=self.refresh_token_expire_days)
        )

        db.add(refresh_token_record)

        # Update last_used_at
        client.last_used_at = _utcnow()
        await db.commit()

        logger.info(f"Generated tokens for client: {client_id}")

        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": self.access_token_expire_minutes * 60,  # seconds
            "refresh_token": refresh_token_value,
            "scopes": client.scopes
        }

    async def refresh_access_token(
        self,
        refresh_token: str,
        db: AsyncSession
    ) -> Dict[str, Any]:
        """
        Generate a new access token using a refresh token.

        Args:
            refresh_token: Refresh token (plaintext)
            db: Database session

        Returns:
            Dict with new access_token, expires_in

        Raises:
            ValueError: If refresh token is invalid or revoked
        """
        refresh_token_hash = self._hash_secret(refresh_token)

        # Fetch refresh token
        result = await db.execute(
            select(RefreshToken).filter(RefreshToken.token_hash == refresh_token_hash)
        )
        token_record = result.scalars().first()

        if not token_record:
            raise ValueError("Invalid refresh token")

        # Check if revoked
        if token_record.is_revoked:
            raise ValueError("Refresh token has been revoked")

        # Check if expired
        if token_record.expires_at < _utcnow():
            raise ValueError("Refresh token has expired")

        # Fetch client
        result = await db.execute(
            select(JWTToken).filter(JWTToken.client_id == token_record.client_id)
        )
        client = result.scalars().first()

        if not client or not client.is_active:
            raise ValueError("Client is inactive")

        # Generate new access token
        access_token_payload = {
            "sub": client.client_id,
            "scopes": client.scopes,
            "type": "access",
            "iat": _utcnow(),
            "exp": _utcnow() + timedelta(minutes=self.access_token_expire_minutes)
        }
        access_token = jwt.encode(access_token_payload, self.secret_key, algorithm=self.algorithm)

        # Token rotation: revoke old refresh token and create new one
        token_record.is_revoked = True
        token_record.used_at = _utcnow()

        # Generate new refresh token
        new_refresh_token_value = secrets.token_urlsafe(32)
        new_refresh_token_hash = self._hash_secret(new_refresh_token_value)

        new_refresh_token_record = RefreshToken(
            token_hash=new_refresh_token_hash,
            client_id=client.client_id,
            is_revoked=False,
            expires_at=_utcnow() + timedelta(days=self.refresh_token_expire_days)
        )

        db.add(new_refresh_token_record)
        client.last_used_at = _utcnow()
        await db.commit()

        logger.info(f"Refreshed tokens for client: {client.client_id} (token rotation)")

        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": self.access_token_expire_minutes * 60,
            "refresh_token": new_refresh_token_value
        }

    def verify_token(self, token: str) -> Dict[str, Any]:
        """
        Verify and decode a JWT access token.

        Args:
            token: JWT access token

        Returns:
            Decoded token payload

        Raises:
            ValueError: If token is invalid or expired
        """
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])

            # Verify token type
            if payload.get("type") != "access":
                raise ValueError("Invalid token type")

            return payload

        except jwt.ExpiredSignatureError:
            raise ValueError("Token has expired")
        except jwt.InvalidTokenError as e:
            raise ValueError(f"Invalid token: {str(e)}")

    def has_scope(self, token_payload: Dict[str, Any], required_scope: str) -> bool:
        """
        Check if token has a required scope.

        Args:
            token_payload: Decoded JWT payload
            required_scope: Required scope (e.g., "stream.consume")

        Returns:
            True if token has the scope
        """
        scopes = token_payload.get("scopes", [])
        return required_scope in scopes

    async def revoke_refresh_token(
        self,
        refresh_token: str,
        db: AsyncSession
    ):
        """
        Revoke a refresh token.

        Args:
            refresh_token: Refresh token to revoke
            db: Database session
        """
        refresh_token_hash = self._hash_secret(refresh_token)

        result = await db.execute(
            select(RefreshToken).filter(RefreshToken.token_hash == refresh_token_hash)
        )
        token_record = result.scalars().first()

        if token_record:
            token_record.is_revoked = True
            await db.commit()
            logger.info(f"Revoked refresh token for client: {token_record.client_id}")

    async def deactivate_client(
        self,
        client_id: str,
        db: AsyncSession
    ):
        """
        Deactivate a client (revoke all access).

        Args:
            client_id: Client to deactivate
            db: Database session
        """
        result = await db.execute(
            select(JWTToken).filter(JWTToken.client_id == client_id)
        )
        client = result.scalars().first()

        if client:
            client.is_active = False
            await db.commit()
            logger.info(f"Deactivated client: {client_id}")

    def _hash_secret(self, secret: str) -> str:
        """Hash a secret using SHA-256."""
        return hashlib.sha256(secret.encode()).hexdigest()

    def _verify_secret(self, plaintext: str, hashed: str) -> bool:
        """Verify a plaintext secret against a hash."""
        return self._hash_secret(plaintext) == hashed


# Global auth service instance
auth_service = AuthService()
