"""System Admin API — configuration management (M9c)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_db_with_rls, get_system_admin
from utils.audit import log_system_audit

router = APIRouter()

# Enumerated valid keys — protects against arbitrary key injection.
# NOTE: session_timeout_minutes is exposed for future frontend idle-warning UI only.
#       Actual JWT expiry is enforced at the Keycloak realm level and is not
#       changed by this setting.
VALID_CONFIG_KEYS = frozenset(
    {
        "alert_severity_threshold",
        "session_timeout_minutes",
        "offline_storage_mb",
        "ai_timeout_seconds",
        "npc_contact_name",
        "npc_contact_phone",
        "npc_office_phone",
    }
)

# Per-key type/range validation for numeric config values.
# Each entry: (converter, min_value).  converter is int or float.
_NUMERIC_CONFIG_KEYS: dict[str, tuple[type, int | float]] = {
    "alert_severity_threshold": (int, 1),
    "session_timeout_minutes": (int, 1),
    "offline_storage_mb": (int, 1),
    "ai_timeout_seconds": (float, 0.1),
}


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

    # Per-key numeric validation — reject malformed or out-of-range values.
    if key in _NUMERIC_CONFIG_KEYS:
        conv, min_val = _NUMERIC_CONFIG_KEYS[key]
        try:
            val = conv(body.value)
        except (ValueError, TypeError):
            type_name = "integer" if conv is int else "number"
            raise HTTPException(
                status_code=400,
                detail=f"Config key {key!r} requires a valid {type_name} value, got {body.value!r}",
            )
        if val < min_val:
            raise HTTPException(
                status_code=400,
                detail=f"Config key {key!r} must be >= {min_val}, got {val}",
            )

    old_row = db.execute(
        text("SELECT config_value FROM wims.system_config WHERE config_key = :key"),
        {"key": key},
    ).fetchone()
    if old_row is None:
        raise HTTPException(status_code=404, detail=f"Config key not found: {key!r}")
    old_value = old_row[0]

    db.execute(
        text("""
            UPDATE wims.system_config
            SET config_value = :value,
                updated_by   = CAST(:uid AS uuid),
                updated_at   = now()
            WHERE config_key = :key
        """),
        {"value": body.value, "uid": str(admin["user_id"]), "key": key},
    )

    log_system_audit(
        db=db,
        user_id=admin["user_id"],
        action_type="CONFIG_UPDATE",
        table_affected="system_config",
        record_id=None,
        request=request,
        old_values={"config_value": str(old_value)},
        new_values={"config_value": str(body.value)},
    )
    db.commit()

    return {"key": key, "value": body.value, "status": "ok"}
