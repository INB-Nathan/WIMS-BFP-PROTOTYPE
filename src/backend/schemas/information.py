"""Pydantic schemas for the Information CMS (announcements + emergencies).

These are the API contract layer for the public reads in
``api.routes.information`` and the SYSTEM_ADMIN CRUD in
``api.routes.admin.information``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Announcements
# ---------------------------------------------------------------------------
class AnnouncementCreate(BaseModel):
    title: str
    body: str
    urgency: Literal["urgent", "advisory", "general"] = "general"
    published: bool = False


class AnnouncementUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    urgency: Optional[Literal["urgent", "advisory", "general"]] = None
    image_path: Optional[str] = None
    published: Optional[bool] = None


class AnnouncementResponse(BaseModel):
    id: int
    title: str
    body: str
    urgency: str
    image_path: Optional[str] = None
    published: bool
    published_at: Optional[datetime] = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Emergencies
# ---------------------------------------------------------------------------
class EmergencyCreate(BaseModel):
    title: str
    location: str
    description: str
    severity: Literal["critical", "high", "moderate", "low"] = "moderate"
    status: Literal["ongoing", "contained", "monitoring", "resolved"] = "ongoing"
    published: bool = False


class EmergencyUpdate(BaseModel):
    title: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[Literal["critical", "high", "moderate", "low"]] = None
    status: Optional[Literal["ongoing", "contained", "monitoring", "resolved"]] = None
    published: Optional[bool] = None


class EmergencyResponse(BaseModel):
    id: int
    title: str
    location: str
    description: str
    severity: str
    status: str
    promoted_from_incident_id: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    perimeter: Optional[dict[str, Any]] = None
    published: bool
    published_at: Optional[datetime] = None
    created_at: datetime
