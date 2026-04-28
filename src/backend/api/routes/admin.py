"""System Admin API — Identity, Security Telemetry, Audit Oversight.
All endpoints protected by get_system_admin. No DELETE endpoints (Immutability Law)."""

import logging
import re
from typing import Annotated, Literal, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, field_validator
from keycloak.exceptions import KeycloakError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import get_system_admin
from database import get_db_with_rls
from services.ai_service import analyze_threat_log
from services.analytics_read_model import backfill_analytics_facts
from services.keycloak_admin import (
    create_keycloak_user,
    generate_temp_password,
    set_user_enabled,
)

logger = logging.getLogger("wims.admin")
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


class UserCreate(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    role: str
    contact_number: Optional[str] = None
    assigned_region_id: Optional[int] = None

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}")
        return v

    @field_validator("first_name", "last_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name must not be blank")
        return v.strip()


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


@router.post("/users", status_code=201)
def create_user(
    body: UserCreate,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    Onboard a new user.

    1. Creates the user in Keycloak with a temporary password (must change on first login).
    2. Assigns the requested realm role in Keycloak.
    3. Inserts a linked row into wims.users.
    4. Returns the generated temporary password in plaintext for the admin to distribute.
    """
    # Use email as username (FRS: email serves as username)
    username = str(body.email).lower()[:50]

    # Generate a secure temporary password
    temp_password = generate_temp_password()

    # --- Create in Keycloak ---
    try:
        keycloak_id = create_keycloak_user(
            email=str(body.email),
            first_name=body.first_name,
            last_name=body.last_name,
            username=username,
            role=body.role,
            temp_password=temp_password,
            contact_number=body.contact_number,
        )
    except KeycloakError as e:
        error_str = str(e)
        if "409" in error_str or "Conflict" in error_str:
            raise HTTPException(
                status_code=409,
                detail="A user with this email already exists in the identity provider.",
            )
        logger.exception("Keycloak user creation failed")
        raise HTTPException(
            status_code=502,
            detail="Failed to create user in identity provider. Try again later.",
        )

    # --- Validate region_id exists (FK guard) ---
    if body.assigned_region_id is not None:
        region_exists = db.execute(
            text("SELECT 1 FROM wims.ref_regions WHERE region_id = :rid"),
            {"rid": body.assigned_region_id},
        ).fetchone()
        if not region_exists:
            raise HTTPException(
                status_code=422,
                detail=f"Region ID {body.assigned_region_id} does not exist. Please select a valid region.",
            )

    # --- Insert into wims.users ---
    try:
        db.execute(
            text("""
                INSERT INTO wims.users (keycloak_id, username, role, assigned_region_id, contact_number, is_active)
                VALUES (CAST(:kid AS uuid), :username, :role, :region_id, :contact_number, TRUE)
                ON CONFLICT (keycloak_id) DO UPDATE SET
                    username = EXCLUDED.username,
                    role = EXCLUDED.role,
                    assigned_region_id = EXCLUDED.assigned_region_id,
                    contact_number = EXCLUDED.contact_number,
                    is_active = TRUE,
                    updated_at = now()
            """),
            {
                "kid": keycloak_id,
                "username": username,
                "role": body.role,
                "region_id": body.assigned_region_id,
                "contact_number": body.contact_number,
            },
        )
        db.commit()
    except IntegrityError as e:
        db.rollback()
        error_str = str(e.orig)
        if "assigned_region_id" in error_str or "ref_regions" in error_str:
            raise HTTPException(
                status_code=422,
                detail=f"Region ID {body.assigned_region_id} does not exist. Please select a valid region.",
            )
        logger.exception(f"DB IntegrityError for new user keycloak_id={keycloak_id}")
        raise HTTPException(
            status_code=500, detail="Database constraint violation. Check user data."
        )
    except Exception:
        db.rollback()
        logger.exception(f"DB insert failed for new user keycloak_id={keycloak_id}")
        raise HTTPException(
            status_code=500,
            detail="User created in Keycloak but database sync failed. Contact system administrator.",
        )

    logger.info(
        f"New user onboarded: keycloak_id={keycloak_id} email={body.email} role={body.role}"
    )

    return {
        "status": "created",
        "keycloak_id": keycloak_id,
        "username": username,
        "role": body.role,
        # Returned IN PLAINTEXT for admin to distribute — prototype behaviour.
        # In production, deliver via secure email instead.
        "temporary_password": temp_password,
        "note": "Distribute this temporary password to the user securely. They will be required to change it on first login.",
    }


@router.get("/users")
def get_users(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
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
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    Update role, assigned_region_id, or is_active for a given user.
    When is_active is set to False the user is also disabled in Keycloak
    and all active sessions are immediately revoked. No DELETE.
    """
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

    # Fetch keycloak_id BEFORE the update so we can synchronise Keycloak
    kc_row = db.execute(
        text("SELECT keycloak_id FROM wims.users WHERE user_id = CAST(:uid AS uuid)"),
        {"uid": user_id},
    ).fetchone()
    if kc_row is None:
        raise HTTPException(status_code=404, detail="User not found")
    keycloak_id = str(kc_row[0]) if kc_row[0] else None

    sql = f"UPDATE wims.users SET {', '.join(updates)}, updated_at = now() WHERE user_id = CAST(:uid AS uuid)"
    result = db.execute(text(sql), params)
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="User not found")

    # --- Synchronise is_active state with Keycloak ---
    if body.is_active is not None and keycloak_id:
        try:
            set_user_enabled(keycloak_id, enabled=body.is_active)
        except KeycloakError as e:
            # DB is already updated — warn but don't roll back; admin can retry
            logger.error(
                f"Keycloak sync failed for user {user_id} (keycloak_id={keycloak_id}): {e}"
            )
            return {
                "status": "partial",
                "user_id": user_id,
                "warning": "Database updated but Keycloak account state could not be synchronized. The user's login status in Keycloak may differ. Retry or contact your Keycloak administrator.",
            }

    return {"status": "ok", "user_id": user_id}


# ---------------------------------------------------------------------------
# Security Telemetry
# ---------------------------------------------------------------------------


@router.get("/security-logs")
def get_security_logs(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
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
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Run AI analysis on a security threat log via Ollama. Updates xai_narrative and xai_confidence."""
    return await analyze_threat_log(log_id, db)


@router.patch("/security-logs/{log_id}")
def update_security_log(
    log_id: int,
    body: SecurityLogUpdate,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
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
    db: Annotated[Session, Depends(get_db_with_rls)],
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
    db: Annotated[Session, Depends(get_db_with_rls)],
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


# ---------------------------------------------------------------------------
# Scheduled Reports (AQ-15)
# ---------------------------------------------------------------------------

_CRON_RE = re.compile(
    r"^(\*|[0-5]?\d|\d+(-\d+)?(,\d+(-\d+)?)*)(/[1-9]\d?)? "
    r"(\*|[01]?\d|2[0-3]|\d+(-\d+)?(,\d+(-\d+)?)*)(/[1-9]\d?)? "
    r"(\*|[12]?\d|3[01]|\d+(-\d+)?(,\d+(-\d+)?)*)(/[1-9]\d?)? "
    r"(\*|[01]?\d|1[0-2]|\d+(-\d+)?(,\d+(-\d+)?)*)(/[1-9]\d?)? "
    r"(\*|[0-6]|\d+(-\d+)?(,\d+(-\d+)?)*)(/[1-9]\d?)?$"
)


class ScheduledReportCreate(BaseModel):
    name: str
    cron_expr: str
    format: Literal["pdf", "excel", "csv"]
    filters: dict[str, Any] = {}
    recipients: list[str] = []
    enabled: bool = True

    @field_validator("cron_expr")
    @classmethod
    def cron_must_be_valid(cls, v: str) -> str:
        if not _CRON_RE.match(v.strip()):
            raise ValueError("Invalid cron expression")
        return v


@router.post("/scheduled-reports", status_code=201)
def create_scheduled_report(
    body: ScheduledReportCreate,
    _user: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Create a scheduled analytics report."""
    result = db.execute(
        text("""
            INSERT INTO wims.scheduled_reports (name, cron_expr, format, filters, recipients, enabled)
            VALUES (:name, :cron_expr, :format, :filters, :recipients, :enabled)
            RETURNING id, name, cron_expr, format, enabled, created_at
        """),
        {
            "name": body.name,
            "cron_expr": body.cron_expr,
            "format": body.format,
            "filters": body.filters,
            "recipients": body.recipients,
            "enabled": body.enabled,
        },
    ).fetchone()
    db.commit()
    return {
        "id": result[0],
        "name": result[1],
        "cron_expr": result[2],
        "format": result[3],
        "enabled": result[4],
        "created_at": result[5].isoformat() if result[5] else None,
    }


@router.get("/scheduled-reports")
def list_scheduled_reports(
    _user: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """List all scheduled analytics reports."""
    rows = db.execute(
        text(
            "SELECT id, name, cron_expr, format, enabled, created_at FROM wims.scheduled_reports ORDER BY id DESC"
        )
    ).fetchall()
    return [
        {
            "id": r[0],
            "name": r[1],
            "cron_expr": r[2],
            "format": r[3],
            "enabled": r[4],
            "created_at": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]
