"""
Pydantic schemas for Bookmark API.
"""
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from uuid import UUID


class BookmarkCreate(BaseModel):
    """Schema for creating a bookmark from live feed."""
    label: Optional[str] = None


class BookmarkHistoricalCreate(BaseModel):
    """Schema for creating a bookmark from historical footage."""
    center_timestamp: str  # ISO format timestamp (center point)
    label: Optional[str] = None


class BookmarkUpdate(BaseModel):
    """Schema for updating a bookmark's metadata."""
    label: Optional[str] = None


class BookmarkResponse(BaseModel):
    """Schema for bookmark response."""
    id: UUID
    device_id: UUID
    device_name: Optional[str] = None  # Populated by join
    center_timestamp: datetime
    start_timestamp: datetime
    end_timestamp: datetime
    video_file_path: str
    thumbnail_path: Optional[str]
    label: Optional[str]
    source: str  # 'live' or 'historical'
    duration: int  # Always 6 seconds
    video_format: str  # 'mp4'
    file_size: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]

    # URLs for frontend
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None

    class Config:
        from_attributes = True  # Pydantic v2 (was orm_mode in v1)


class BookmarkListResponse(BaseModel):
    """Schema for list of bookmarks with pagination."""
    bookmarks: list[BookmarkResponse]
    total: int
    page: int
    page_size: int
