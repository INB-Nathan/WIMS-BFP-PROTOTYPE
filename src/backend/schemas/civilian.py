"""Civilian report API schemas — Zero-Trust Public Portal."""

from datetime import datetime

from pydantic import BaseModel, Field


class CivilianReportCreate(BaseModel):
    """Request body for POST /api/civilian/reports (no auth)."""

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    description: str = Field(..., min_length=1)


class CivilianReportResponse(BaseModel):
    """Response body for created civilian report."""

    report_id: int
    latitude: float
    longitude: float
    description: str
    trust_score: int
    status: str
    created_at: datetime
