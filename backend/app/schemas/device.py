"""Device schemas for request/response validation."""
from pydantic import BaseModel, HttpUrl, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class DeviceCreate(BaseModel):
    """Schema for creating a device."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    rtsp_url: str = Field(..., min_length=1, max_length=512)
    location: Optional[str] = None


class DeviceUpdate(BaseModel):
    """Schema for updating a device."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    rtsp_url: Optional[str] = Field(None, min_length=1, max_length=512)
    location: Optional[str] = None
    is_active: Optional[bool] = None


class DeviceResponse(BaseModel):
    """Schema for device response."""
    id: UUID
    name: str
    description: Optional[str]
    rtsp_url: str
    is_active: bool
    location: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]
    stream_state: Optional[str] = None  # Stream state: live, error, stopped, etc.

    class Config:
        from_attributes = True


