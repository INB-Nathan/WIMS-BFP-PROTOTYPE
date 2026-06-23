"""Admin Sessions API — List and terminate active Keycloak sessions.

All endpoints require SYSTEM_ADMIN role.
Prefix: /api/admin  (registered in main.py)

Endpoints accept the internal WIMS user_id (UUID) so the frontend never
needs access to the raw Keycloak UUID (which is masked in admin user list).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls
from services.keycloak_admin import get_user_sessions, logout_user_sessions
from utils.audit import log_system_audit

router = APIRouter(tags=["sessions"])


def _resolve_keycloak_id(user_id: str, db: Session) -> str:
    """Look up the Keycloak UUID for an internal WIMS user_id."""
    row = db.execute(
        text("SELECT keycloak_id FROM wims.users WHERE user_id = CAST(:uid AS uuid)"),
        {"uid": user_id},
    ).fetchone()
    if row is None or row[0] is None:
        raise HTTPException(status_code=404, detail="User not found")
    return str(row[0])


@router.get("/sessions/{user_id}")
def list_user_sessions(
    user_id: str,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """List all active Keycloak sessions for a user (by internal WIMS user_id). Admin only."""
    keycloak_id = _resolve_keycloak_id(user_id, db)
    sessions = get_user_sessions(keycloak_id)
    return {"sessions": sessions}


@router.delete("/sessions/{user_id}")
def terminate_user_sessions(
    user_id: str,
    request: Request,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    Terminate all sessions for a user (by internal WIMS user_id). Admin only.
    Note: python-keycloak does not expose a single-session revoke endpoint,
    so this terminates ALL sessions for the user.
    For single-session revocation, use
    DELETE /api/admin/sessions/{user_id}/{session_id}.
    """
    keycloak_id = _resolve_keycloak_id(user_id, db)
    logout_user_sessions(keycloak_id)
    # RP-19: forced session termination is a logout event — record it.
    log_system_audit(
        db,
        _admin.get("user_id"),
        "LOGOUT",
        "wims.users",
        None,
        request,
        new_values={"target_user_id": user_id, "initiated_by": "admin_terminate_sessions"},
    )
    db.commit()
    return {"status": "ok", "user_id": user_id}


@router.delete("/sessions/{user_id}/{session_id}")
def revoke_user_session(
    user_id: str,
    session_id: str,
    request: Request,
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db_with_rls),
):
    """Revoke a specific session for a user."""
    keycloak_id = _resolve_keycloak_id(user_id, db)

    from services.keycloak_admin import _get_admin_client

    adm = _get_admin_client()
    try:
        sessions = adm.get_sessions(keycloak_id)
        session_ids = [s.get("id") for s in sessions]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Keycloak error: {str(e)}")

    if session_id not in session_ids:
        raise HTTPException(status_code=404, detail="Session not found for this user")

    try:
        adm.delete_user_session(session_id=session_id)
    except AttributeError:
        try:
            adm.connection.raw_delete(f"sessions/{session_id}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to revoke session: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to revoke session: {str(e)}")

    # RP-19: single-session revocation is a logout event — record it.
    log_system_audit(
        db,
        current_user.get("user_id"),
        "LOGOUT",
        "wims.users",
        None,
        request,
        new_values={
            "target_user_id": user_id,
            "session_id": session_id,
            "initiated_by": "admin_revoke_session",
        },
    )
    db.commit()
    return {"status": "ok", "session_id": session_id}
