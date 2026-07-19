"""Admin Information CMS CRUD (SYSTEM_ADMIN) under /api/admin/information.

Routes (mounted under the admin package router, which is itself mounted with
prefix ``/api/admin`` in ``main.py``):

- GET    /api/admin/information/announcements            — list drafts and published rows
- POST   /api/admin/information/announcements            — create
- PUT    /api/admin/information/announcements/{id}        — update (404 if missing)
- DELETE /api/admin/information/announcements/{id}        — delete (204)
- GET    /api/admin/information/emergencies               — list drafts and published rows
- POST   /api/admin/information/emergencies               — create
- PUT    /api/admin/information/emergencies/{id}          — update (404 if missing)
- DELETE /api/admin/information/emergencies/{id}          — delete (204)
- POST   /api/admin/information/emergencies/promote/{incident_id}
                                                     — SYSTEM_ADMIN

All admin reads and writes run under an RLS-scoped session and are gated by
``get_system_admin``. The CMS tables currently have no RLS policies, so the
RLS GUC is a no-op; access succeeds by virtue of the ``GRANT ... TO wims_app``
in migration 0016.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_db_with_rls, get_system_admin
from schemas.information import (
    AnnouncementCreate,
    AnnouncementResponse,
    AnnouncementUpdate,
    EmergencyCreate,
    EmergencyResponse,
    EmergencyUpdate,
)
from services.information_emergencies import ensure_incident_emergency_draft

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
_ANNOUNCEMENT_COLUMNS = "id, title, body, urgency, image_path, published, published_at, created_at"
_EMERGENCY_COLUMNS = (
    "id, title, location, description, severity, status, "
    "promoted_from_incident_id, published, published_at, created_at"
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
@router.get("/announcements", response_model=list[AnnouncementResponse])
def list_admin_announcements(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> list[dict]:
    rows = (
        db.execute(
            text(
                f"SELECT {_ANNOUNCEMENT_COLUMNS} FROM wims.information_announcements "
                "ORDER BY created_at DESC"
            )
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


@router.post("/announcements", status_code=201, response_model=AnnouncementResponse)
def create_announcement(
    body: AnnouncementCreate,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> AnnouncementResponse:
    """Create an announcement as SYSTEM_ADMIN."""
    try:
        new_id = db.execute(
            text(
                "INSERT INTO wims.information_announcements "
                "(title, body, urgency, published, published_at, created_by) "
                "VALUES (:title, :body, :urgency, :published, "
                "CASE WHEN :published THEN now() ELSE NULL END, :created_by) "
                "RETURNING id"
            ),
            {
                "title": body.title,
                "body": body.body,
                "urgency": body.urgency,
                "published": body.published,
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
    if "published" in fields:
        set_clause += (
            ", published_at = CASE WHEN :published THEN COALESCE(published_at, now()) ELSE NULL END"
        )
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
@router.get("/emergencies", response_model=list[EmergencyResponse])
def list_admin_emergencies(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> list[dict]:
    rows = (
        db.execute(
            text(
                f"SELECT {_EMERGENCY_COLUMNS} FROM wims.information_emergencies "
                "ORDER BY created_at DESC"
            )
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


@router.post("/emergencies", status_code=201, response_model=EmergencyResponse)
def create_emergency(
    body: EmergencyCreate,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> EmergencyResponse:
    """Create an emergency as SYSTEM_ADMIN."""
    try:
        new_id = db.execute(
            text(
                "INSERT INTO wims.information_emergencies "
                "(title, location, description, severity, status, published, published_at, created_by) "
                "VALUES (:title, :location, :description, :severity, :status, :published, "
                "CASE WHEN :published THEN now() ELSE NULL END, :created_by) "
                "RETURNING id"
            ),
            {
                "title": body.title,
                "location": body.location,
                "description": body.description,
                "severity": body.severity,
                "status": body.status,
                "published": body.published,
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
    if "published" in fields:
        set_clause += (
            ", published_at = CASE WHEN :published THEN COALESCE(published_at, now()) ELSE NULL END"
        )
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
@router.post(
    "/emergencies/promote/{incident_id}", status_code=201, response_model=EmergencyResponse
)
def promote_incident(
    incident_id: int,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> EmergencyResponse:
    """Create or refresh a SYSTEM_ADMIN-reviewed emergency draft from an incident."""
    try:
        emergency_id = ensure_incident_emergency_draft(
            db,
            incident_id=incident_id,
            actor_user_id=str(_admin["user_id"]),
            require_civilian_link=False,
        )
        if emergency_id is None:
            raise HTTPException(status_code=404, detail="Verified incident not found")
        db.commit()
        return _emergency_row(db, emergency_id)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        logger.exception("Failed to promote incident")
        raise HTTPException(status_code=500, detail="Failed to promote incident") from exc
