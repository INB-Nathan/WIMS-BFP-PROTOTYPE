"""Public DMZ Incident Queue schemas — Zero-Trust Civilian Intake.

No Keycloak JWT. Rate-limited at 3 requests per IP per hour.
Inserts into wims.fire_incidents with PENDING status and encoder_id = NULL.
"""

from datetime import datetime

from pydantic import BaseModel, Field


class PublicIncidentCreate(BaseModel):
    """Request body for POST /api/v1/public/report (no auth).

    Lat/lon are required so the incident can be geospatially assigned
    to a ref_region before insertion into fire_incidents.
    """

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    description: str = Field(..., min_length=1, max_length=2000)


class PublicIncidentResponse(BaseModel):
    """Response body for a successfully queued public incident."""

    incident_id: int
    latitude: float
    longitude: float
    verification_status: str
    created_at: datetime
