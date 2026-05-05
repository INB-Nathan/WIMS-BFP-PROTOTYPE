"""System Admin API — Identity, Security Telemetry, Audit Oversight.
All endpoints protected by get_system_admin. No DELETE endpoints (Immutability Law)."""

import logging
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, field_validator
from keycloak.exceptions import KeycloakError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import get_system_admin
from database import get_db, get_db_with_rls
from services.ai_service import analyze_threat_log
from services.analytics_read_model import backfill_analytics_facts
from services.keycloak_admin import (
    create_keycloak_user,
    generate_temp_password,
    set_user_enabled,
    logout_user_sessions,
)
from utils.audit import log_system_audit

logger = logging.getLogger("wims.admin")
router = APIRouter(tags=["admin"])

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/app/storage/backups"))


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
    request: Request,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db)],
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

    # --- Set RLS context so wims.current_user_role() returns SYSTEM_ADMIN during INSERT ---
    # get_db() (not get_db_with_rls) is used above because the postgres service-account
    # session has no Keycloak JWT — wims.current_user_id would be NULL and RLS would block
    # the insert with 'ANONYMOUS' role.  We explicitly set it here using a SECURITY DEFINER
    # helper so the INSERT policy (wims.current_user_role() IN ('SYSTEM_ADMIN')) passes.
    db.execute(
        text("SELECT wims.exec_as_system_admin(:uid)"), {"uid": _admin["user_id"]}
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

    log_system_audit(
        db=db,
        user_id=_admin["user_id"],
        action_type="CREATE_USER",
        table_affected="users",
        record_id=None,
        request=request,
    )

    db.commit()

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
    request: Request,
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

    # Fetch keycloak_id and current role BEFORE the update so we can synchronise Keycloak
    kc_row = db.execute(
        text(
            "SELECT keycloak_id, role FROM wims.users WHERE user_id = CAST(:uid AS uuid)"
        ),
        {"uid": user_id},
    ).fetchone()
    if kc_row is None:
        raise HTTPException(status_code=404, detail="User not found")
    keycloak_id = str(kc_row[0]) if kc_row[0] else None
    current_role = kc_row[1]

    sql = f"UPDATE wims.users SET {', '.join(updates)}, updated_at = now() WHERE user_id = CAST(:uid AS uuid)"
    result = db.execute(text(sql), params)

    # Log audit for update
    actions = []
    if body.role:
        actions.append(f"ROLE_CHANGE_TO_{body.role}")
    if body.is_active is not None:
        actions.append("DEACTIVATE" if not body.is_active else "ACTIVATE")

    for action_name in actions:
        log_system_audit(
            db=db,
            user_id=_admin["user_id"],
            action_type=action_name,
            table_affected="users",
            record_id=None,  # user_id is uuid in db, but table expects int. We skip for users table or just pass 0.
            request=request,
        )

    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="User not found")

    # --- Synchronise is_active state with Keycloak ---
    if body.is_active is not None and keycloak_id:
        from utils.session import session_manager

        try:
            set_user_enabled(keycloak_id, enabled=body.is_active)
            if body.is_active is False:
                # Also revoke all active sessions if we are disabling the user
                from services.keycloak_admin import _get_admin_client

                adm = _get_admin_client()
                adm.user_logout(keycloak_id)
                session_manager.revoke_all_sessions(keycloak_id)
        except Exception as e:
            # DB is already updated — warn but don't roll back; admin can retry
            logger.error(
                f"Keycloak sync failed for user {user_id} (keycloak_id={keycloak_id}): {e}"
            )
            return {
                "status": "partial",
                "user_id": user_id,
                "warning": f"Database updated but Keycloak sync failed: {e}",
            }

    # --- Invalidate sessions if role changed (security event) ---
    if body.role is not None and body.role != current_role and keycloak_id:
        logout_user_sessions(keycloak_id)

    return {"status": "ok", "user_id": user_id}


@router.get("/active-sessions")
def get_active_sessions(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Fetch all active sessions for all users."""
    users = db.execute(
        text(
            "SELECT user_id, keycloak_id, username, role FROM wims.users WHERE is_active = TRUE"
        )
    ).fetchall()

    from services.keycloak_admin import _get_admin_client

    adm = _get_admin_client()

    active_sessions = []
    for u in users:
        if not u.keycloak_id:
            continue
        try:
            sessions = adm.get_sessions(str(u.keycloak_id))
            for s in sessions:
                active_sessions.append(
                    {
                        "session_id": s.get("id"),
                        "user_id": str(u.user_id),
                        "username": u.username,
                        "role": u.role,
                        "ip_address": s.get("ipAddress"),
                        "start": s.get("start"),
                        "last_access": s.get("lastAccess"),
                        "clients": s.get("clients", {}),
                    }
                )
        except Exception as e:
            logger.warning(f"Failed to fetch sessions for {u.keycloak_id}: {e}")

    # sort by last_access desc
    active_sessions.sort(key=lambda x: x.get("last_access", 0), reverse=True)
    return active_sessions


@router.post("/users/{user_id}/logout")
def force_logout_user(
    user_id: str,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Force logout all sessions for a user."""
    row = db.execute(
        text("SELECT keycloak_id FROM wims.users WHERE user_id = CAST(:uid AS uuid)"),
        {"uid": user_id},
    ).fetchone()
    if not row or not row[0]:
        raise HTTPException(status_code=404, detail="User not found")

    from services.keycloak_admin import _get_admin_client
    from utils.session import session_manager

    adm = _get_admin_client()
    kid = str(row[0])
    try:
        adm.user_logout(kid)
        # Instant revocation in backend via Redis
        session_manager.revoke_all_sessions(kid)
    except Exception as e:
        logger.warning(f"Failed to logout user {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to revoke sessions")

    return {"status": "ok"}


@router.get("/health")
def get_system_health(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Fetch health status for all system components."""
    health = {
        "status": "HEALTHY",
        "components": {
            "database": {"status": "UNKNOWN", "latency_ms": 0},
            "redis": {"status": "UNKNOWN", "latency_ms": 0},
            "keycloak": {"status": "UNKNOWN", "latency_ms": 0},
        },
    }

    import time

    # Check DB
    try:
        t0 = time.time()
        db.execute(text("SELECT 1"))
        health["components"]["database"] = {
            "status": "HEALTHY",
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception as e:
        health["components"]["database"] = {
            "status": "UNHEALTHY",
            "error": str(e),
            "latency_ms": 0,
        }
        health["status"] = "DEGRADED"

    # Check Redis
    try:
        import redis
        import os

        r = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))
        t0 = time.time()
        r.ping()
        health["components"]["redis"] = {
            "status": "HEALTHY",
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception as e:
        health["components"]["redis"] = {
            "status": "UNHEALTHY",
            "error": str(e),
            "latency_ms": 0,
        }
        health["status"] = "DEGRADED"

    # Check Keycloak
    try:
        from services.keycloak_admin import _get_admin_client

        t0 = time.time()
        adm = _get_admin_client()
        adm.users_count()
        health["components"]["keycloak"] = {
            "status": "HEALTHY",
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception as e:
        health["components"]["keycloak"] = {
            "status": "UNHEALTHY",
            "error": str(e),
            "latency_ms": 0,
        }
        health["status"] = "DEGRADED"

    return health


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


# ---------------------------------------------------------------------------
# Backup Management
# ---------------------------------------------------------------------------


@router.post("/backup", status_code=202)
async def trigger_backup(
    request: Request,
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db_with_rls),
):
    """Trigger a pg_dump backup of the wims database."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"wims_{timestamp}.sql"
    output_path = BACKUP_DIR / filename

    db_url = os.environ.get("DATABASE_URL", "")
    match = re.match(
        r"postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)", db_url
    )
    if not match:
        raise HTTPException(status_code=500, detail="Invalid DATABASE_URL format")

    db_user, db_pass, db_host, db_port, db_name = match.groups()

    env = os.environ.copy()
    env["PGPASSWORD"] = db_pass

    try:
        result = subprocess.run(
            [
                "pg_dump",
                "-h", db_host,
                "-p", db_port,
                "-U", db_user,
                "-d", db_name,
                "-f", str(output_path),
                "--no-password",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Backup timed out after 120s")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="pg_dump not found in PATH")

    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"pg_dump failed: {result.stderr[:500]}",
        )

    size_bytes = output_path.stat().st_size
    created_at = datetime.utcnow().isoformat()

    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="BACKUP_TRIGGERED",
        table_affected="wims",
        record_id=None,
        request=request,
    )
    db.commit()

    return {
        "filename": filename,
        "size_bytes": size_bytes,
        "created_at": created_at,
    }


@router.get("/backups")
async def list_backups(
    current_user: dict = Depends(get_system_admin),
):
    """List all available backup files sorted newest first."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    files = []
    for f in BACKUP_DIR.glob("wims_*.sql"):
        stat = f.stat()
        files.append({
            "filename": f.name,
            "size_bytes": stat.st_size,
            "created_at": datetime.utcfromtimestamp(stat.st_mtime).isoformat(),
        })

    files.sort(key=lambda x: x["created_at"], reverse=True)
    return files


@router.get("/backup/{filename}")
async def download_backup(
    filename: str,
    current_user: dict = Depends(get_system_admin),
):
    """Download a specific backup file."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    if not re.match(r"^wims_\d{8}_\d{6}\.sql$", filename):
        raise HTTPException(status_code=400, detail="Invalid backup filename format")

    file_path = BACKUP_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")

    return FileResponse(
        path=str(file_path),
        filename=filename,
        media_type="application/octet-stream",
    )
