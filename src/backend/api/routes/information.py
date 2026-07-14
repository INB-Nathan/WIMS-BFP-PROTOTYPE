"""Public Information CMS read endpoints (no auth).

GET /api/information/announcements — published announcements, newest first
GET /api/information/emergencies  — published emergencies, newest first

Both endpoints read with a bare ``get_db()`` session (no RLS / no auth) because
the Information page is public. The published-only filter is enforced in SQL so
unpublished rows are never returned to anonymous clients.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from schemas.information import AnnouncementResponse, EmergencyResponse

router = APIRouter(prefix="/api/information", tags=["information"])


_ANNOUNCEMENT_COLUMNS = "id, title, body, urgency, image_path, published, published_at, created_at"
_EMERGENCY_COLUMNS = (
    "id, title, location, description, severity, status, "
    "promoted_from_incident_id, published, published_at, created_at"
)


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


@router.get("/emergencies", response_model=list[EmergencyResponse])
def list_emergencies(
    db: Annotated[Session, Depends(get_db)],
) -> list[dict]:
    """Public list of published emergencies, newest published first."""
    rows = (
        db.execute(
            text(
                f"SELECT {_EMERGENCY_COLUMNS} "
                "FROM wims.information_emergencies "
                "WHERE published = TRUE "
                "ORDER BY published_at DESC NULLS LAST, created_at DESC"
            )
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]
