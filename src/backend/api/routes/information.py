"""Public Information CMS read endpoints (no auth).

GET /api/information/announcements — published announcements, newest first
GET /api/information/emergencies  — published emergencies, newest first

Both endpoints read with a bare ``get_db()`` session (no RLS / no auth) because
the Information page is public. The published-only filter is enforced in SQL so
unpublished rows are never returned to anonymous clients. Emergency geometry is
included only when its linked incident is VERIFIED.
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from schemas.information import (
    AnnouncementResponse,
    CivilianSignalTimestampResponse,
    EmergencyResponse,
)
from services.public_emergencies import (
    get_public_civilian_signal_timestamps,
    list_public_emergencies,
)

router = APIRouter(prefix="/api/information", tags=["information"])


_ANNOUNCEMENT_COLUMNS = "id, title, body, urgency, image_path, published, published_at, created_at"


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
    """Public list of published emergencies, with geometry from verified linked incidents."""
    return [_public_emergency(row) for row in list_public_emergencies(db)]


@router.get(
    "/emergencies/{emergency_id}/civilian-signals",
    response_model=list[CivilianSignalTimestampResponse],
)
def list_civilian_signal_timestamps(
    emergency_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> list[dict]:
    """Return timestamp-only public civilian activity for one published emergency."""
    timestamps = get_public_civilian_signal_timestamps(db, emergency_id)
    if timestamps is None:
        raise HTTPException(status_code=404, detail="Emergency not found")
    return timestamps
