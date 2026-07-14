"""Admin civilian contributor management (issue #576).

SYSTEM_ADMIN-only endpoints for listing civilian contributors, suspending /
activating them (idempotent), and reading their audit history.

Routes are intentionally thin: SQL is inlined here (simple CMS-style queries)
and all writes are audited via utils.audit.log_system_audit. RBAC is enforced
server-side via the get_system_admin dependency.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_db_with_rls, get_system_admin
from schemas.admin_civilian import (
    CivilianActionResponse,
    CivilianAuditEntry,
    CivilianAuditPage,
    CivilianListItem,
)
from services.keycloak_admin import set_user_enabled
from utils.audit import log_system_audit

logger = logging.getLogger("wims.admin.civilians")

router = APIRouter(tags=["admin-civilians"])

_VALID_STATUS = {"active", "suspended", "all"}


def _parse_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid user_id UUID")


def _escape_like(term: str) -> str:
    """Escape LIKE wildcards so a search term cannot alter the pattern."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/admin/civilians
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/civilians", response_model=list[CivilianListItem])
def list_civilians(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    search: str | None = Query(None, description="ILIKE match on username"),
    status: str = Query("all", description="active | suspended | all"),
) -> list[CivilianListItem]:
    """List civilian contributors joined from wims.users + wims.civilian_contributors.

    ``search`` matches the persisted username (wims.users has no separate
    name/email column; email is sourced from Keycloak at login). ``status``
    filters on the suspend flag.
    """
    conditions: list[str] = []
    params: dict = {}

    if search:
        conditions.append("u.username ILIKE :search ESCAPE '\\'")
        params["search"] = f"%{_escape_like(search)}%"

    if status not in _VALID_STATUS:
        status = "all"
    if status == "active":
        conditions.append("cc.suspended = FALSE")
    elif status == "suspended":
        conditions.append("cc.suspended = TRUE")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    sql = text(
        f"""
        SELECT
            u.user_id,
            u.keycloak_id,
            u.username AS name,
            cc.trust_score,
            cc.badge,
            cc.suspended,
            (
                SELECT COUNT(*)
                FROM wims.citizen_reports cr
                WHERE cr.contributor_user_id = u.user_id
            ) AS report_count,
            COALESCE(
                (
                    SELECT MAX(cr.created_at)
                    FROM wims.citizen_reports cr
                    WHERE cr.contributor_user_id = u.user_id
                ),
                u.last_login
            ) AS last_active,
            cc.created_at AS date_added
        FROM wims.users u
        JOIN wims.civilian_contributors cc ON cc.user_id = u.user_id
        {where}
        ORDER BY u.username ASC
        """
    )

    rows = db.execute(sql, params).fetchall()

    return [
        CivilianListItem(
            user_id=row[0],
            keycloak_id=row[1],
            name=row[2],
            email=None,
            trust_score=row[3],
            badge=row[4],
            status="suspended" if row[5] else "active",
            report_count=int(row[6] or 0),
            last_active=row[7],
            date_added=row[8],
        )
        for row in rows
    ]


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/admin/civilians/{user_id}/suspend  |  /activate
# ─────────────────────────────────────────────────────────────────────────────


def _get_civilian_row(db: Session, uid: UUID):
    return db.execute(
        text(
            """
            SELECT u.keycloak_id, cc.suspended
            FROM wims.users u
            JOIN wims.civilian_contributors cc ON cc.user_id = u.user_id
            WHERE u.user_id = :uid
            """
        ),
        {"uid": str(uid)},
    ).fetchone()


def _set_suspended(
    user_id: str,
    request: Request,
    _admin: dict,
    db: Session,
    *,
    suspend: bool,
) -> CivilianActionResponse:
    uid = _parse_uuid(user_id)
    row = _get_civilian_row(db, uid)
    if row is None:
        raise HTTPException(status_code=404, detail="Civilian contributor not found")

    keycloak_id = str(row[0])
    already_suspended = bool(row[1])

    # Idempotent: if already in the requested state, return 200 without
    # re-applying the mutation or writing a duplicate audit row.
    if already_suspended == suspend:
        return CivilianActionResponse(
            status="suspended" if suspend else "active",
            user_id=uid,
            keycloak_id=UUID(keycloak_id),
            suspended=suspend,
        )

    db.execute(
        text(
            """
            UPDATE wims.civilian_contributors
            SET suspended = :suspended, updated_at = now()
            WHERE user_id = :uid
            """
        ),
        {"uid": str(uid), "suspended": suspend},
    )
    log_system_audit(
        db=db,
        user_id=_admin["user_id"],
        action_type="CIVILIAN_SUSPEND" if suspend else "CIVILIAN_ACTIVATE",
        table_affected="wims.civilian_contributors",
        record_id=None,
        request=request,
        new_values={"user_id": str(uid), "suspended": suspend},
    )
    db.commit()

    warning = None
    try:
        set_user_enabled(keycloak_id, enabled=not suspend)
    except Exception as exc:  # Keycloak sync is best-effort; DB state is authoritative
        logger.warning(
            "Keycloak enable=%s sync failed for %s: %s", not suspend, keycloak_id, exc
        )
        warning = f"Keycloak sync failed: {exc}"

    return CivilianActionResponse(
        status="suspended" if suspend else "active",
        user_id=uid,
        keycloak_id=UUID(keycloak_id),
        suspended=suspend,
        warning=warning,
    )


@router.post("/civilians/{user_id}/suspend", response_model=CivilianActionResponse)
def suspend_civilian(
    user_id: str,
    request: Request,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> CivilianActionResponse:
    """Suspend a civilian contributor. Idempotent (200 if already suspended)."""
    return _set_suspended(user_id, request, _admin, db, suspend=True)


@router.post("/civilians/{user_id}/activate", response_model=CivilianActionResponse)
def activate_civilian(
    user_id: str,
    request: Request,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> CivilianActionResponse:
    """Activate a suspended civilian contributor. Idempotent (200 if already active)."""
    return _set_suspended(user_id, request, _admin, db, suspend=False)


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/admin/civilians/{user_id}/audit
# ─────────────────────────────────────────────────────────────────────────────


def _coerce_new_values(raw) -> dict | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return None
    return None


@router.get("/civilians/{user_id}/audit", response_model=CivilianAuditPage)
def get_civilian_audit(
    user_id: str,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
) -> CivilianAuditPage:
    """Paginated audit trail for a civilian contributor.

    Returns rows where the civilian was the actor (user_id) OR the subject
    (table mentions a civilian table and new_values.user_id matches).
    """
    uid = _parse_uuid(user_id)
    uid_str = str(uid)

    # record_id is INTEGER; the civilian target is a UUID stored in new_values.
    where = (
        "(user_id = :uid) "
        "OR (table_affected ILIKE '%civilian%' AND new_values->>'user_id' = :uid)"
    )

    total = db.execute(
        text(f"SELECT COUNT(*) FROM wims.system_audit_trails WHERE {where}"),
        {"uid": uid_str},
    ).scalar()

    rows = db.execute(
        text(
            f"""
            SELECT action_type, timestamp, new_values, user_id
            FROM wims.system_audit_trails
            WHERE {where}
            ORDER BY timestamp DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        {"uid": uid_str, "limit": limit, "offset": (page - 1) * limit},
    ).fetchall()

    items = [
        CivilianAuditEntry(
            action_type=row[0],
            created_at=row[1],
            new_values=_coerce_new_values(row[2]),
            actor_user_id=row[3],
        )
        for row in rows
    ]

    return CivilianAuditPage(items=items, page=page, limit=limit, total=int(total or 0))
