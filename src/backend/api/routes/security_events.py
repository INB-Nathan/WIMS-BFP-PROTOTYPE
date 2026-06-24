"""
Keycloak → WIMS audit event ingest (RP-08 / RP-18).

POST /api/auth/keycloak-event — server-to-server endpoint called by the
wims-audit-event-listener Keycloak SPI. Authenticated with a shared Bearer
token (WIMS_KEYCLOAK_EVENT_SECRET). Fail-closed: if the env var is blank at
import time, every request is rejected with 401.
"""

from __future__ import annotations

import logging
import os
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from utils.audit import log_system_audit

logger = logging.getLogger("wims.keycloak_event")

router = APIRouter(prefix="/api/auth", tags=["keycloak-event"])

# Read once at import time. If blank → 401 on every request (fail-closed).
# Never use os.environ["..."] here — a missing key would crash the import.
_KC_SECRET: str = os.environ.get("WIMS_KEYCLOAK_EVENT_SECRET", "")

# Map Keycloak EventType names → (WIMS action_type, audit result).
_KEYCLOAK_EVENT_MAP: dict[str, tuple[str, str]] = {
    "LOGIN_ERROR": ("FAILED_LOGIN", "failure"),
    "USER_DISABLED_BY_BRUTE_FORCE": ("FAILED_LOGIN", "failure"),
    "UPDATE_PASSWORD": ("PASSWORD_RESET", "success"),
    "RESET_PASSWORD_EMAIL": ("PASSWORD_RESET", "success"),
}


class KeycloakEventRequest(BaseModel):
    event_type: str
    username: Optional[str] = None
    error: Optional[str] = None
    keycloak_event_id: Optional[str] = None


def _verify_secret(request: Request) -> None:
    """Validate Bearer token against _KC_SECRET; raise 401 on any mismatch."""
    if not _KC_SECRET:
        # Env var not set — fail-closed, reject all requests.
        raise HTTPException(status_code=401, detail="Keycloak event secret not configured")

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    token = auth_header[len("Bearer ") :]
    if token != _KC_SECRET:
        raise HTTPException(status_code=401, detail="Invalid token")


@router.post("/keycloak-event", status_code=202)
def ingest_keycloak_event(
    body: KeycloakEventRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Ingest an authentication event pushed by the Keycloak SPI.

    Maps Keycloak EventType → WIMS action_type and writes one audit row to
    wims.system_audit_trails. user_id is always NULL — Keycloak user IDs are
    not looked up to avoid leaking account existence.
    """
    _verify_secret(request)

    event_type = (body.event_type or "").strip().upper()
    mapping = _KEYCLOAK_EVENT_MAP.get(event_type)
    if mapping is None:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported Keycloak event_type: {event_type!r}",
        )

    action_type, result = mapping
    username = (body.username or "").strip()[:255] or None
    error = (body.error or "").strip()[:255] or None
    event_id = (body.keycloak_event_id or "").strip()[:128] or None

    log_system_audit(
        db,
        None,  # user_id — always NULL; no RLS-gated lookup to avoid account-existence leakage
        action_type,
        "wims.auth",
        None,
        request,
        new_values={
            "username": username,
            "error": error,
            "source": "keycloak_spi",
            "keycloak_event_id": event_id,
        },
        result=result,
    )
    db.commit()

    logger.info(
        "Keycloak event ingested: kc_type=%s → wims_action=%s result=%s user=%s",
        event_type,
        action_type,
        result,
        username,
    )
    return {"status": "recorded", "action_type": action_type}
