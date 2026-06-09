"""System Admin API — configuration management (M9c)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_db_with_rls, get_system_admin
from utils.audit import log_system_audit
from utils.config import get_config  # re-exported for convenience  # noqa: F401

router = APIRouter()

# Enumerated valid keys — protects against arbitrary key injection.
VALID_CONFIG_KEYS = frozenset(
    {
        "alert_severity_threshold",
        "session_timeout_minutes",
        "offline_storage_mb",
        "ai_timeout_seconds",
    }
)


class ConfigUpdate(BaseModel):
    value: str


@router.get("/config")
def list_config(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Return all system_config rows ordered by key."""
    rows = db.execute(
        text("""
            SELECT config_key, config_value, description, updated_by, updated_at
            FROM wims.system_config
            ORDER BY config_key
        """),
    ).fetchall()
    return {
        "config": [
            {
                "key": r[0],
                "value": r[1],
                "description": r[2],
                "updated_by": str(r[3]) if r[3] else None,
                "updated_at": r[4].isoformat() if r[4] else None,
            }
            for r in rows
        ]
    }


@router.patch("/config/{key}")
def update_config(
    key: str,
    body: ConfigUpdate,
    admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    request: Request,
):
    """Update a single config value. Validates key; audit-logs the change."""
    if key not in VALID_CONFIG_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown config key: {key!r}")

    result = db.execute(
        text("""
            UPDATE wims.system_config
            SET config_value = :value,
                updated_by   = CAST(:uid AS uuid),
                updated_at   = now()
            WHERE config_key = :key
        """),
        {"value": body.value, "uid": str(admin["user_id"]), "key": key},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"Config key not found: {key!r}")

    log_system_audit(
        db=db,
        user_id=admin["user_id"],
        action_type="CONFIG_UPDATE",
        table_affected="system_config",
        record_id=None,
        request=request,
    )
    db.commit()

    return {"key": key, "value": body.value, "status": "ok"}
