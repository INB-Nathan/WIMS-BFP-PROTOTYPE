"""Incident API schemas — Geospatial Intake."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class IncidentCreate(BaseModel):
    """Request body for POST /api/incidents."""

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    description: str
    verification_status: str = "PENDING"


class IncidentResponse(BaseModel):
    """Response body for created incident."""

    incident_id: int
    latitude: float
    longitude: float
    encoder_id: UUID | None
    status: str
    created_at: datetime
