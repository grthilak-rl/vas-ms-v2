"""Bookmark model for saved video clips (6-second captures)."""
from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from database import Base
import uuid


class Bookmark(Base):
    """
    Represents a bookmark - a 6-second video clip (±3 seconds from center point).

    Similar to Snapshot but captures video instead of a single frame.
    """

    __tablename__ = "bookmarks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"), nullable=False)

    # Timestamps
    center_timestamp = Column(DateTime(timezone=True), nullable=False)  # The bookmarked moment
    start_timestamp = Column(DateTime(timezone=True), nullable=False)   # center - 3 seconds
    end_timestamp = Column(DateTime(timezone=True), nullable=False)     # center + 3 seconds

    # File paths
    video_file_path = Column(String(512), nullable=False)  # Path to 6-second video clip
    thumbnail_path = Column(String(512), nullable=True)    # Thumbnail from center frame

    # Metadata
    label = Column(String(255), nullable=True)  # User description/note
    source = Column(String(20), nullable=False)  # 'live' or 'historical'
    duration = Column(Integer, default=6)  # Duration in seconds (always 6)
    video_format = Column(String(10), default="mp4")  # Video format
    file_size = Column(Integer, nullable=True)  # File size in bytes

    # Optional: user_id for future auth (nullable for now)
    user_id = Column(UUID(as_uuid=True), nullable=True)

    # Timestamps (audit)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    # FIXME: Temporarily disabled due to SQLAlchemy lazy loading issues with async
    # device = relationship("Device", backref="bookmarks")

    def __repr__(self):
        return f"<Bookmark {self.label or 'Unlabeled'} at {self.center_timestamp}>"
