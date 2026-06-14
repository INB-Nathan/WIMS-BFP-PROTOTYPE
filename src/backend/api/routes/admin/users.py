"""System Admin API — identity management routes."""

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from keycloak.exceptions import KeycloakError
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls
from database import get_db
from services.keycloak_admin import (
    create_keycloak_user,
    generate_temp_password,
    set_user_enabled,
    logout_user_sessions,
)
from utils.audit import log_system_audit

logger = logging.getLogger("wims.admin")
router = APIRouter()

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
    username: Optional[str] = None
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

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        import re

        if not re.match(r"^[a-zA-Z0-9_\-]{3,50}$", v):
            raise ValueError(
                "Username must be 3–50 characters and contain only letters, numbers, underscores, or hyphens"
            )
        return v.lower()


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
    # Use provided username if given; fall back to email-derived
    username = body.username if body.username else str(body.email).lower()[:50]

    temp_password = generate_temp_password()

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

    db.execute(text("SELECT wims.exec_as_system_admin(:uid)"), {"uid": _admin["user_id"]})

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
        "temporary_password": temp_password,
        "note": "Credentials emailed to user. If email delivery fails, use the temporary_password below as fallback.",
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

    kc_row = db.execute(
        text(
            "SELECT keycloak_id, role, assigned_region_id, is_active FROM wims.users WHERE user_id = CAST(:uid AS uuid)"
        ),
        {"uid": user_id},
    ).fetchone()
    if kc_row is None:
        raise HTTPException(status_code=404, detail="User not found")
    keycloak_id = str(kc_row[0]) if kc_row[0] else None
    current_role = kc_row[1]
    current_region = kc_row[2]
    current_active = kc_row[3]

    sql = f"UPDATE wims.users SET {', '.join(updates)}, updated_at = now() WHERE user_id = CAST(:uid AS uuid)"
    result = db.execute(text(sql), params)

    actions = []
    if body.role is not None:
        actions.append(f"ROLE_CHANGE_TO_{body.role}")
    if body.is_active is not None:
        actions.append("DEACTIVATE" if not body.is_active else "ACTIVATE")

    old_state: dict = {"role": current_role}
    new_state: dict = {}
    if body.role is not None:
        new_state["role"] = body.role
    if body.is_active is not None:
        old_state["is_active"] = current_active
        new_state["is_active"] = body.is_active
    if body.assigned_region_id is not None:
        old_state["assigned_region_id"] = current_region
        new_state["assigned_region_id"] = body.assigned_region_id
        # Emit a dedicated action for region-only changes so the audit
        # log is always written whenever assigned_region_id is changed.
        if body.role is None and body.is_active is None:
            actions.append("REGION_ASSIGNMENT_CHANGE")

    for action_name in actions:
        log_system_audit(
            db=db,
            user_id=_admin["user_id"],
            action_type=action_name,
            table_affected="users",
            record_id=None,
            request=request,
            old_values=old_state if old_state else None,
            new_values=new_state if new_state else None,
        )

    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="User not found")

    if body.is_active is not None and keycloak_id:
        from utils.session import session_manager

        try:
            set_user_enabled(keycloak_id, enabled=body.is_active)
            if body.is_active is False:
                from services.keycloak_admin import _get_admin_client

                adm = _get_admin_client()
                adm.user_logout(keycloak_id)
                session_manager.revoke_all_sessions(keycloak_id)
        except Exception as e:
            logger.error(
                f"Keycloak sync failed for user {user_id} (keycloak_id={keycloak_id}): {e}"
            )
            return {
                "status": "partial",
                "user_id": user_id,
                "warning": f"Database updated but Keycloak sync failed: {e}",
            }

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
        text("SELECT user_id, keycloak_id, username, role FROM wims.users WHERE is_active = TRUE")
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
        session_manager.revoke_all_sessions(kid)
    except Exception as e:
        logger.warning(f"Failed to logout user {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to revoke sessions")

    return {"status": "ok"}
