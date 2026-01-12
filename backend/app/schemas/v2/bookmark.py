"""Bookmark schemas for V2 API."""
from pydantic import BaseModel, Field, UUID4
from typing import List, Optional, Dict, Any
from datetime import datetime


class BookmarkCreate(BaseModel):
    """Request to create a bookmark."""
    source: str = Field(..., description="Source: 'live' or 'historical'", pattern="^(live|historical)$")
    center_timestamp: Optional[datetime] = Field(
        default=None,
        description="Center timestamp (required for historical, auto for live)"
    )
    before_seconds: Optional[int] = Field(default=5, description="Seconds before center timestamp", ge=1, le=30)
    after_seconds: Optional[int] = Field(default=5, description="Seconds after center timestamp", ge=1, le=30)
    label: Optional[str] = Field(default=None, description="Human-readable label", max_length=255)
    created_by: Optional[str] = Field(default=None, description="Creator identifier", max_length=100)
    event_type: Optional[str] = Field(default=None, description="Event type (person, vehicle, anomaly)", max_length=50)
    confidence: Optional[float] = Field(default=None, description="AI confidence (0.0-1.0)", ge=0.0, le=1.0)
    tags: Optional[List[str]] = Field(default_factory=list, description="Tags for filtering")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Extended metadata (bounding boxes, etc.)")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "source": "live",
                    "label": "Person detected at front door",
                    "created_by": "ruth-ai",
                    "event_type": "person",
                    "confidence": 0.95,
                    "tags": ["security", "person-detection"],
                    "metadata": {
                        "bounding_box": {"x": 100, "y": 200, "w": 50, "h": 100},
                        "ai_model": "yolov8"
                    }
                },
                {
                    "source": "historical",
                    "center_timestamp": "2026-01-08T14:23:45Z",
                    "label": "Review incident",
                    "created_by": "operator-john",
                    "event_type": "incident"
                }
            ]
        }
    }


class BookmarkResponse(BaseModel):
    """Bookmark response."""
    id: UUID4
    stream_id: UUID4
    center_timestamp: datetime
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    label: Optional[str] = None
    source: str
    created_by: Optional[str] = None
    event_type: Optional[str] = None
    confidence: Optional[float] = None
    tags: List[str] = []
    video_url: Optional[str] = None  # null when still processing
    thumbnail_url: Optional[str] = None
    status: Optional[str] = None  # processing, ready, failed
    metadata: Dict[str, Any] = {}
    created_at: datetime


class BookmarkListResponse(BaseModel):
    """List of bookmarks with pagination."""
    bookmarks: List[BookmarkResponse]
    pagination: Dict[str, int]

    model_config = {
        "json_schema_extra": {
            "example": {
                "bookmarks": [
                    {
                        "id": "dddddddd-0000-0000-0000-000000000001",
                        "stream_id": "aaaaaaaa-0000-0000-0000-000000000001",
                        "center_timestamp": "2026-01-09T12:00:00Z",
                        "start_time": "2026-01-09T11:59:57Z",
                        "end_time": "2026-01-09T12:00:03Z",
                        "duration_seconds": 6.0,
                        "label": "Person detected",
                        "source": "live",
                        "created_by": "ruth-ai",
                        "event_type": "person",
                        "confidence": 0.95,
                        "tags": ["security"],
                        "video_url": "/v2/bookmarks/dddddddd-0000-0000-0000-000000000001/video",
                        "thumbnail_url": "/v2/bookmarks/dddddddd-0000-0000-0000-000000000001/thumbnail",
                        "status": "ready",
                        "metadata": {},
                        "created_at": "2026-01-09T12:00:00Z"
                    }
                ],
                "pagination": {"total": 50, "limit": 20, "offset": 0}
            }
        }
    }


class BookmarkUpdate(BaseModel):
    """Request to update bookmark."""
    label: Optional[str] = Field(default=None, max_length=255)
    event_type: Optional[str] = Field(default=None, description="Event type", max_length=50)
    confidence: Optional[float] = Field(default=None, description="AI confidence (0.0-1.0)", ge=0.0, le=1.0)
    tags: Optional[List[str]] = Field(default=None)
    metadata: Optional[Dict[str, Any]] = Field(default=None)
