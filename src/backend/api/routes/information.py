"""Public Information CMS read endpoints (no auth).

GET /api/information/announcements — published announcements, newest first
GET /api/information/emergencies  — published emergencies, newest first

Both endpoints read with a bare ``get_db()`` session (no RLS / no auth) because
the Information page is public. The published-only filter is enforced in SQL so
unpublished rows are never returned to anonymous clients.
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from schemas.information import AnnouncementResponse, EmergencyResponse

router = APIRouter(prefix="/api/information", tags=["information"])


_ANNOUNCEMENT_COLUMNS = "id, title, body, urgency, image_path, published, published_at, created_at"
_EMERGENCY_COLUMNS = """
    ie.id, ie.title, ie.location, ie.description, ie.severity, ie.status,
    ie.promoted_from_incident_id, ie.published, ie.published_at, ie.created_at,
    ST_Y(fi.location::geometry) AS latitude,
    ST_X(fi.location::geometry) AS longitude,
    ST_AsGeoJSON(p.perimeter) AS perimeter_geometry
"""


@router.get("/announcements", response_model=list[AnnouncementResponse])
def list_announcements(
    db: Annotated[Session, Depends(get_db)],
) -> list[dict]:
    """Public list of published announcements, newest published first."""
    rows = (
        db.execute(
            text(
                f"SELECT {_ANNOUNCEMENT_COLUMNS} "
                "FROM wims.information_announcements "
                "WHERE published = TRUE "
                "ORDER BY published_at DESC NULLS LAST, created_at DESC"
            )
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


def _public_emergency(row: dict) -> dict:
    emergency = dict(row)
    geometry = emergency.pop("perimeter_geometry", None)
    emergency["perimeter"] = (
        {
            "type": "Feature",
            "geometry": json.loads(geometry),
            "properties": {"incident_id": emergency["promoted_from_incident_id"]},
        }
        if geometry
        else None
    )
    return emergency


@router.get("/emergencies", response_model=list[EmergencyResponse])
def list_emergencies(
    db: Annotated[Session, Depends(get_db)],
) -> list[dict]:
    """Public list of published emergencies with verified-incident geometry."""
    rows = (
        db.execute(
            text(
                f"SELECT {_EMERGENCY_COLUMNS} "
                "FROM wims.information_emergencies ie "
                "LEFT JOIN wims.fire_incidents fi "
                "ON fi.incident_id = ie.promoted_from_incident_id "
                "AND fi.verification_status = 'VERIFIED' "
                "LEFT JOIN wims.fire_incident_perimeters p ON p.incident_id = fi.incident_id "
                "WHERE ie.published = TRUE "
                "ORDER BY ie.published_at DESC NULLS LAST, ie.created_at DESC"
            )
        )
        .mappings()
        .all()
    )
    return [_public_emergency(row) for row in rows]
