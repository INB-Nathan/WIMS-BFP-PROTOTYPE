"""Admin Information CMS CRUD (SYSTEM_ADMIN) under /api/admin/information.

Routes (mounted under the admin package router, which is itself mounted with
prefix ``/api/admin`` in ``main.py``):

- POST   /api/admin/information/announcements            — create
- PUT    /api/admin/information/announcements/{id}        — update (404 if missing)
- DELETE /api/admin/information/announcements/{id}        — delete (204)
- POST   /api/admin/information/emergencies               — create
- PUT    /api/admin/information/emergencies/{id}          — update (404 if missing)
- DELETE /api/admin/information/emergencies/{id}          — delete (204)
- POST   /api/admin/information/emergencies/promote/{incident_id}
                                                     — SYSTEM_ADMIN or NATIONAL_VALIDATOR

All writes run under an RLS-scoped session (``get_db_with_rls``) and are gated
by ``get_system_admin`` (or an inline role check for the promote endpoint,
which also permits NATIONAL_VALIDATOR). The CMS tables currently have no RLS
policies, so the RLS GUC set by ``get_db_with_rls`` is a no-op; writes succeed
by virtue of the ``GRANT ... TO wims_app`` in migration 0016.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user, get_db_with_rls, get_system_admin
from schemas.information import (
    AnnouncementCreate,
    AnnouncementResponse,
    AnnouncementUpdate,
    EmergencyCreate,
    EmergencyResponse,
    EmergencyUpdate,
)

logger = logging.getLogger("wims.information_admin_routes")

router = APIRouter(prefix="/information", tags=["admin-information"])

_ANNOUNCEMENT_SELECT = (
    "SELECT id, title, body, urgency, image_path, published, "
    "published_at, created_at FROM wims.information_announcements WHERE id = :id"
)
_EMERGENCY_SELECT = (
    "SELECT id, title, location, description, severity, status, "
    "promoted_from_incident_id, published, published_at, created_at "
    "FROM wims.information_emergencies WHERE id = :id"
)


def _announcement_row(db: Session, announcement_id: int) -> AnnouncementResponse:
    row = db.execute(text(_ANNOUNCEMENT_SELECT), {"id": announcement_id}).mappings().first()
    return AnnouncementResponse(**dict(row))


def _emergency_row(db: Session, emergency_id: int) -> EmergencyResponse:
    row = db.execute(text(_EMERGENCY_SELECT), {"id": emergency_id}).mappings().first()
    return EmergencyResponse(**dict(row))


# ---------------------------------------------------------------------------
# Announcements
# ---------------------------------------------------------------------------
@router.post("/announcements", status_code=201, response_model=AnnouncementResponse)
def create_announcement(
    body: AnnouncementCreate,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> AnnouncementResponse:
    """Create an announcement as SYSTEM_ADMIN (defaults to unpublished)."""
    try:
        new_id = db.execute(
            text(
                "INSERT INTO wims.information_announcements "
                "(title, body, urgency, created_by) "
                "VALUES (:title, :body, :urgency, :created_by) "
                "RETURNING id"
            ),
            {
                "title": body.title,
                "body": body.body,
                "urgency": body.urgency,
                "created_by": str(_admin["user_id"]),
            },
        ).scalar_one()
        db.commit()
        return _announcement_row(db, new_id)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        logger.exception("Failed to create announcement")
        raise HTTPException(status_code=500, detail="Failed to create announcement") from exc


@router.put("/announcements/{announcement_id}", response_model=AnnouncementResponse)
def update_announcement(
    announcement_id: int,
    body: AnnouncementUpdate,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> AnnouncementResponse:
    """Update an announcement (partial). 404 if the id does not exist."""
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided for update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    params = {**fields, "id": announcement_id}
    try:
        found = db.execute(
            text(
                f"UPDATE wims.information_announcements "
                f"SET {set_clause}, updated_at = now() "
                f"WHERE id = :id RETURNING id"
            ),
            params,
        ).scalar_one_or_none()
        if found is None:
            raise HTTPException(status_code=404, detail="Announcement not found")
        db.commit()
        return _announcement_row(db, announcement_id)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        logger.exception("Failed to update announcement")
        raise HTTPException(status_code=500, detail="Failed to update announcement") from exc


@router.delete("/announcements/{announcement_id}", status_code=204)
def delete_announcement(
    announcement_id: int,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> Response:
    """Delete an announcement. 404 if the id does not exist."""
    result = db.execute(
        text("DELETE FROM wims.information_announcements WHERE id = :id"),
        {"id": announcement_id},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Announcement not found")
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Emergencies
# ---------------------------------------------------------------------------
@router.post("/emergencies", status_code=201, response_model=EmergencyResponse)
def create_emergency(
    body: EmergencyCreate,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> EmergencyResponse:
    """Create an emergency as SYSTEM_ADMIN (defaults to unpublished)."""
    try:
        new_id = db.execute(
            text(
                "INSERT INTO wims.information_emergencies "
                "(title, location, description, severity, status, created_by) "
                "VALUES (:title, :location, :description, :severity, :status, :created_by) "
                "RETURNING id"
            ),
            {
                "title": body.title,
                "location": body.location,
                "description": body.description,
                "severity": body.severity,
                "status": body.status,
                "created_by": str(_admin["user_id"]),
            },
        ).scalar_one()
        db.commit()
        return _emergency_row(db, new_id)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        logger.exception("Failed to create emergency")
        raise HTTPException(status_code=500, detail="Failed to create emergency") from exc


@router.put("/emergencies/{emergency_id}", response_model=EmergencyResponse)
def update_emergency(
    emergency_id: int,
    body: EmergencyUpdate,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> EmergencyResponse:
    """Update an emergency (partial). 404 if the id does not exist."""
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided for update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    params = {**fields, "id": emergency_id}
    try:
        found = db.execute(
            text(
                f"UPDATE wims.information_emergencies "
                f"SET {set_clause}, updated_at = now() "
                f"WHERE id = :id RETURNING id"
            ),
            params,
        ).scalar_one_or_none()
        if found is None:
            raise HTTPException(status_code=404, detail="Emergency not found")
        db.commit()
        return _emergency_row(db, emergency_id)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        logger.exception("Failed to update emergency")
        raise HTTPException(status_code=500, detail="Failed to update emergency") from exc


@router.delete("/emergencies/{emergency_id}", status_code=204)
def delete_emergency(
    emergency_id: int,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> Response:
    """Delete an emergency. 404 if the id does not exist."""
    result = db.execute(
        text("DELETE FROM wims.information_emergencies WHERE id = :id"),
        {"id": emergency_id},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Emergency not found")
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Promote from incident
# ---------------------------------------------------------------------------
_PROMOTE_SELECT = """
    SELECT fi.incident_id,
           r.region_name,
           c.city_name,
           b.barangay_name,
           nd.general_description_of_involved,
           ST_AsText(fi.location) AS geom
    FROM wims.fire_incidents fi
    LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
    LEFT JOIN wims.ref_regions r ON r.region_id = fi.region_id
    LEFT JOIN wims.ref_cities c ON c.city_id = nd.city_id
    LEFT JOIN wims.ref_barangays b ON b.barangay_id = nd.barangay_id
    WHERE fi.incident_id = :incident_id
"""


@router.post(
    "/emergencies/promote/{incident_id}", status_code=201, response_model=EmergencyResponse
)
def promote_incident(
    incident_id: int,
    _user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> EmergencyResponse:
    """Promote a fire incident into a published-draft emergency.

    Permitted for SYSTEM_ADMIN or NATIONAL_VALIDATOR. Copies the incident's
    location (region/city/barangay or raw geometry) and general description
    into a new ``information_emergencies`` row linked via
    ``promoted_from_incident_id``. Default severity/status are applied; the
    resulting emergency starts unpublished so an admin can review before
    going live.
    """
    if _user.get("role") not in ("SYSTEM_ADMIN", "NATIONAL_VALIDATOR"):
        raise HTTPException(
            status_code=403,
            detail="SYSTEM_ADMIN or NATIONAL_VALIDATOR privileges required",
        )
    try:
        inc = db.execute(text(_PROMOTE_SELECT), {"incident_id": incident_id}).mappings().first()
        if inc is None:
            raise HTTPException(status_code=404, detail="Incident not found")

        location_parts = [
            p for p in (inc.get("barangay_name"), inc.get("city_name"), inc.get("region_name")) if p
        ]
        location = ", ".join(location_parts) if location_parts else (inc.get("geom") or "Unknown")
        description = inc.get("general_description_of_involved") or (
            f"Promoted from incident #{incident_id}."
        )

        new_id = db.execute(
            text(
                "INSERT INTO wims.information_emergencies "
                "(title, location, description, severity, status, "
                "promoted_from_incident_id, created_by) "
                "VALUES (:title, :location, :description, :severity, :status, "
                ":promoted_from_incident_id, :created_by) "
                "RETURNING id"
            ),
            {
                "title": f"Incident #{incident_id}",
                "location": location,
                "description": description,
                "severity": "moderate",
                "status": "ongoing",
                "promoted_from_incident_id": incident_id,
                "created_by": str(_user["user_id"]),
            },
        ).scalar_one()
        db.commit()
        return _emergency_row(db, new_id)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        logger.exception("Failed to promote incident")
        raise HTTPException(status_code=500, detail="Failed to promote incident") from exc
