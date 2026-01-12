"""Consumer model for MediaSoup consumers."""
from sqlalchemy import Column, String, ForeignKey, DateTime, Enum as SQLEnum, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from database import Base
import uuid
import enum


class ConsumerState(str, enum.Enum):
    """Consumer state enum."""
    CONNECTING = "connecting"
    CONNECTED = "connected"
    PAUSED = "paused"
    CLOSED = "closed"


class Consumer(Base):
    """
    Represents a MediaSoup consumer attached to a stream.

    Consumers are ephemeral - they attach and detach as third-party
    applications connect and disconnect. Multiple consumers can attach
    to one producer concurrently.

    Lifecycle: connecting → connected → (paused) → closed
    """

    __tablename__ = "consumers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stream_id = Column(
        UUID(as_uuid=True),
        ForeignKey("streams.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Client identification
    client_id = Column(String(255), nullable=False, index=True)  # e.g., "ruth-ai-instance-1"

    # MediaSoup identifiers
    mediasoup_consumer_id = Column(String(255), unique=True, nullable=False, index=True)
    mediasoup_transport_id = Column(String(255), nullable=False)

    # State
    state = Column(
        SQLEnum(ConsumerState, name="consumer_state", create_type=True),
        nullable=False,
        default=ConsumerState.CONNECTING,
        index=True
    )

    # Timestamps
    created_at = Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )
    last_seen_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now()
    )
    closed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    stream = relationship("Stream", back_populates="consumers")

    def __repr__(self):
        return f"<Consumer {self.id} client={self.client_id} state={self.state.value}>"
