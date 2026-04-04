"""System Admin API — Identity, Security Telemetry, Audit Oversight.
All endpoints protected by get_system_admin. No DELETE endpoints (Immutability Law)."""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_system_admin
from database import get_db
from services.ai_service import analyze_threat_log
from services.analytics_read_model import backfill_analytics_facts

router = APIRouter(tags=["admin"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

VALID_ROLES = (
    "CIVILIAN_REPORTER",
    "REGIONAL_ENCODER",
    "NATIONAL_VALIDATOR",
    "NATIONAL_ANALYST",
    "SYSTEM_ADMIN",
)


class UserUpdate(BaseModel):
    role: Optional[str] = None
    assigned_region_id: Optional[int] = None
    is_active: Optional[bool] = None

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}")
        return v


class SecurityLogUpdate(BaseModel):
    admin_action_taken: Optional[str] = None
    resolved_at: Optional[str] = None  # ISO datetime string


# ---------------------------------------------------------------------------
# Identity Management
# ---------------------------------------------------------------------------


@router.get("/users")
def get_users(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Return all users. Keycloak IDs masked for privacy."""
    rows = db.execute(
        text("""
            SELECT user_id, keycloak_id, username, role, assigned_region_id, is_active, created_at
            FROM wims.users
            ORDER BY username
        """),
    ).fetchall()

    def mask_keycloak(kid):
        if kid is None:
            return None
        s = str(kid)
        if len(s) > 8:
            return s[:4] + "****" + s[-4:]
        return "****"

    return [
        {
            "user_id": str(r[0]),
            "keycloak_id_masked": mask_keycloak(r[1]),
            "username": r[2],
            "role": r[3],
            "assigned_region_id": r[4],
            "is_active": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]


@router.patch("/users/{user_id}")
def update_user(
    user_id: str,
    body: UserUpdate,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Update role, assigned_region_id, or is_active. No DELETE."""
    updates = []
    params: dict = {"uid": user_id}
    if body.role is not None:
        updates.append("role = :role")
        params["role"] = body.role
    if body.assigned_region_id is not None:
        updates.append("assigned_region_id = :assigned_region_id")
        params["assigned_region_id"] = body.assigned_region_id
    if body.is_active is not None:
        updates.append("is_active = :is_active")
        params["is_active"] = body.is_active

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    sql = f"UPDATE wims.users SET {', '.join(updates)}, updated_at = now() WHERE user_id = CAST(:uid AS uuid)"
    result = db.execute(text(sql), params)
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "ok", "user_id": user_id}


# ---------------------------------------------------------------------------
# Security Telemetry
# ---------------------------------------------------------------------------


@router.get("/security-logs")
def get_security_logs(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Fetch security threat logs ordered by timestamp descending."""
    rows = db.execute(
        text("""
            SELECT log_id, timestamp, source_ip, destination_ip, suricata_sid,
                   severity_level, raw_payload, xai_narrative, xai_confidence,
                   admin_action_taken, resolved_at, reviewed_by
            FROM wims.security_threat_logs
            ORDER BY timestamp DESC
        """),
    ).fetchall()

    return [
        {
            "log_id": r[0],
            "timestamp": r[1].isoformat() if r[1] else None,
            "source_ip": r[2],
            "destination_ip": r[3],
            "suricata_sid": r[4],
            "severity_level": r[5],
            "raw_payload": r[6],
            "xai_narrative": r[7],
            "xai_confidence": float(r[8]) if r[8] is not None else None,
            "admin_action_taken": r[9],
            "resolved_at": r[10].isoformat() if r[10] else None,
            "reviewed_by": str(r[11]) if r[11] else None,
        }
        for r in rows
    ]


@router.post("/security-logs/{log_id}/analyze")
async def analyze_security_log(
    log_id: int,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Run AI analysis on a security threat log via Ollama. Updates xai_narrative and xai_confidence."""
    return await analyze_threat_log(log_id, db)


@router.patch("/security-logs/{log_id}")
def update_security_log(
    log_id: int,
    body: SecurityLogUpdate,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Update admin_action_taken and resolved_at."""
    updates = []
    params: dict = {"log_id": log_id}
    if body.admin_action_taken is not None:
        updates.append("admin_action_taken = :admin_action_taken")
        params["admin_action_taken"] = body.admin_action_taken
    if body.resolved_at is not None:
        updates.append("resolved_at = CAST(:resolved_at AS timestamptz)")
        params["resolved_at"] = body.resolved_at

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    sql = f"UPDATE wims.security_threat_logs SET {', '.join(updates)} WHERE log_id = :log_id"
    result = db.execute(text(sql), params)
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Security log not found")
    return {"status": "ok", "log_id": log_id}


# ---------------------------------------------------------------------------
# Analytics Read Model
# ---------------------------------------------------------------------------


@router.post("/analytics/backfill")
def backfill_analytics(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Backfill wims.analytics_incident_facts from existing VERIFIED non-archived incidents."""
    count = backfill_analytics_facts(db)
    return {"status": "ok", "synced_count": count}


# ---------------------------------------------------------------------------
# Audit Oversight
# ---------------------------------------------------------------------------


@router.get("/audit-logs")
def get_audit_logs(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    """Fetch system audit trails with pagination."""
    rows = db.execute(
        text("""
            SELECT audit_id, user_id, action_type, table_affected, record_id,
                   ip_address, user_agent, timestamp
            FROM wims.system_audit_trails
            ORDER BY timestamp DESC
            LIMIT :limit OFFSET :offset
        """),
        {"limit": limit, "offset": offset},
    ).fetchall()

    total = (
        db.execute(
            text("SELECT COUNT(*) FROM wims.system_audit_trails"),
        ).scalar()
        or 0
    )

    return {
        "items": [
            {
                "audit_id": r[0],
                "user_id": str(r[1]) if r[1] else None,
                "action_type": r[2],
                "table_affected": r[3],
                "record_id": r[4],
                "ip_address": r[5],
                "user_agent": r[6],
                "timestamp": r[7].isoformat() if r[7] else None,
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
