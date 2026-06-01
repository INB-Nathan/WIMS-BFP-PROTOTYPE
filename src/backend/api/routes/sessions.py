"""Admin Sessions API — List and terminate active Keycloak sessions.

All endpoints require SYSTEM_ADMIN role.
Prefix: /api/admin  (registered in main.py)

Endpoints accept the internal WIMS user_id (UUID) so the frontend never
needs access to the raw Keycloak UUID (which is masked in admin user list).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls
from services.keycloak_admin import get_user_sessions, logout_user_sessions

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


@router.delete("/sessions/{user_id}/{session_id}")
def terminate_user_session(
    user_id: str,
    session_id: str,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    Terminate sessions for a user (by internal WIMS user_id). Admin only.
    Note: python-keycloak does not expose a single-session revoke endpoint,
    so this terminates ALL sessions for the user.
    """
    keycloak_id = _resolve_keycloak_id(user_id, db)
    logout_user_sessions(keycloak_id)
    return {"status": "ok", "user_id": user_id}
