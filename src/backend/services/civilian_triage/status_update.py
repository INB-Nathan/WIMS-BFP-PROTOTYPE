"""Validator-to-civilian status update command.

Implements the fixed forward-only stage lifecycle for
wims.report_status_updates and the stage-specific metadata validation.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from services.event_bus import publish_status_update_event_sync
from utils.audit import log_system_audit

# Stage ordinals for the fixed forward-only lifecycle.
_STAGE_ORDER: dict[str, int] = {
    "RECEIVED": 1,
    "UNDER_REVIEW": 2,
    "HELP_DISPATCHED": 3,
    "ON_SCENE": 4,
    "RESOLVED": 5,
    "CLOSED_DUPLICATE": 6,
    "CLOSED_INSUFFICIENT": 6,
}

# Terminal stages after which no further transitions are allowed.
_TERMINAL_STAGES: frozenset[str] = frozenset(
    {"RESOLVED", "CLOSED_DUPLICATE", "CLOSED_INSUFFICIENT"}
)

# Required metadata keys per stage. Values map to the expected python type.
_REQUIRED_METADATA_KEYS: dict[str, dict[str, type]] = {
    "HELP_DISPATCHED": {"station_name": str, "jurisdiction": str},
    "ON_SCENE": {"arrived_at": str},
    "RESOLVED": {"outcome_summary": str},
    "CLOSED_DUPLICATE": {"duplicate_of_report_id": int},
    "CLOSED_INSUFFICIENT": {"reason": str},
}

_STATUS_UPDATE_CHANNEL = "wims:events:status_update"

# Status updates are a validator-to-civilian contract, not an internal-note
# channel. Reject undeclared JSONB keys so an arbitrary staff-side value cannot
# later become public through a shared tracking capability.
_ALLOWED_METADATA_KEYS: dict[str, frozenset[str]] = {
    "HELP_DISPATCHED": frozenset({"station_name", "station_phone", "jurisdiction", "eta"}),
    "ON_SCENE": frozenset({"arrived_at"}),
    "RESOLVED": frozenset({"outcome_summary"}),
    "CLOSED_DUPLICATE": frozenset({"duplicate_of_report_id"}),
    "CLOSED_INSUFFICIENT": frozenset({"reason"}),
}

# Tracking links are bearer capabilities and can be shared. Only metadata that
# is explicitly citizen-facing may leave the protected status-update record.
_PUBLIC_METADATA_KEYS: dict[str, tuple[str, ...]] = {
    "HELP_DISPATCHED": ("station_name", "station_phone", "jurisdiction", "eta"),
    "ON_SCENE": ("arrived_at",),
    "RESOLVED": ("outcome_summary",),
    "CLOSED_INSUFFICIENT": ("reason",),
}


def get_public_status_updates(db: Session, report_id: int) -> list[dict]:
    """Return the ordered, public-safe status timeline for one report."""
    rows = db.execute(
        text(
            """
            SELECT stage, metadata, created_at
            FROM wims.report_status_updates
            WHERE report_id = :rid
            ORDER BY created_at ASC, update_id ASC
            """
        ),
        {"rid": report_id},
    ).fetchall()

    updates: list[dict] = []
    for row in rows:
        raw_metadata = dict(row.metadata) if row.metadata is not None else {}
        metadata = {
            key: raw_metadata[key]
            for key in _PUBLIC_METADATA_KEYS.get(row.stage, ())
            if isinstance(raw_metadata.get(key), str)
        }
        updates.append(
            {
                "stage": row.stage,
                "metadata": metadata or None,
                "created_at": row.created_at,
            }
        )
    return updates


def _validate_metadata(stage: str, metadata: dict | None) -> None:
    """Reject undeclared, missing, or wrongly typed public status metadata."""
    if metadata is not None:
        unexpected = set(metadata) - _ALLOWED_METADATA_KEYS.get(stage, frozenset())
        if unexpected:
            raise HTTPException(
                status_code=400,
                detail=f"Stage '{stage}' does not allow metadata keys: {', '.join(sorted(unexpected))}",
            )

    required = _REQUIRED_METADATA_KEYS.get(stage)
    if not required:
        return
    if metadata is None:
        missing = ", ".join(required.keys())
        raise HTTPException(
            status_code=400,
            detail=f"Stage '{stage}' requires metadata with keys: {missing}",
        )
    for key, expected_type in required.items():
        if key not in metadata:
            raise HTTPException(
                status_code=400,
                detail=f"Stage '{stage}' requires metadata key '{key}'",
            )
        value = metadata[key]
        if expected_type is int:
            # Accept numeric values; reject bool (subclass of int) and non-int.
            if isinstance(value, bool) or not isinstance(value, int):
                raise HTTPException(
                    status_code=400,
                    detail=f"Stage '{stage}' metadata key '{key}' must be an integer",
                )
        elif not isinstance(value, expected_type):
            raise HTTPException(
                status_code=400,
                detail=f"Stage '{stage}' metadata key '{key}' must be a string",
            )


def _resolve_current_stage(db: Session, report_id: int) -> str:
    """Return the latest recorded stage for the report, defaulting to RECEIVED."""
    row = db.execute(
        text(
            """
            SELECT stage
            FROM wims.report_status_updates
            WHERE report_id = :rid
            ORDER BY created_at DESC, update_id DESC
            LIMIT 1
            """
        ),
        {"rid": report_id},
    ).fetchone()
    return row[0] if row else "RECEIVED"


def apply_status_update_command(
    *,
    db: Session,
    report_id: int,
    stage: str,
    metadata: dict | None,
    actor_user: dict,
    request=None,
) -> dict:
    """Insert a validator-to-civilian status update.

    Enforces:
    - the civilian report exists (404 otherwise);
    - the stage is valid and forward-only (>= current ordinal, current not terminal) (400 otherwise);
    - required metadata keys per stage (400 otherwise);

    Commits the insert + audit, publishes an SSE event, and returns the created row.
    """
    if stage not in _STAGE_ORDER:
        allowed = ", ".join(_STAGE_ORDER.keys())
        raise HTTPException(
            status_code=400,
            detail=f"Invalid stage '{stage}'. Allowed stages: {allowed}",
        )

    # The civilian report must exist.
    report_exists = db.execute(
        text("SELECT 1 FROM wims.citizen_reports WHERE report_id = :rid"),
        {"rid": report_id},
    ).fetchone()
    if not report_exists:
        raise HTTPException(status_code=404, detail="Civilian report not found")

    current_stage = _resolve_current_stage(db, report_id)

    # No transitions out of a terminal stage.
    if current_stage in _TERMINAL_STAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Report is in terminal stage '{current_stage}'; no further updates allowed",
        )

    # Forward-only: new ordinal must be >= current ordinal.
    if _STAGE_ORDER[stage] < _STAGE_ORDER[current_stage]:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Backward transition rejected: cannot move from '{current_stage}' to '{stage}'"
            ),
        )

    _validate_metadata(stage, metadata)

    user_id = actor_user["user_id"]
    role = actor_user.get("role")

    try:
        result = db.execute(
            text(
                """
                INSERT INTO wims.report_status_updates
                    (report_id, stage, metadata, actor_user_id, created_at)
                VALUES
                    (:report_id, :stage, CAST(:metadata AS jsonb), :actor_user_id, :created_at)
                RETURNING update_id, report_id, stage, metadata, actor_user_id, created_at
                """
            ),
            {
                "report_id": report_id,
                "stage": stage,
                "metadata": metadata if metadata is not None else None,
                "actor_user_id": user_id,
                "created_at": datetime.now(timezone.utc),
            },
        ).fetchone()

        log_system_audit(
            db=db,
            user_id=user_id,
            action_type="REPORT_STATUS_UPDATE",
            table_affected="report_status_updates",
            record_id=result.update_id,
            request=request,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    created = {
        "update_id": result.update_id,
        "report_id": result.report_id,
        "stage": result.stage,
        "metadata": dict(result.metadata) if result.metadata is not None else None,
        "actor_user_id": str(result.actor_user_id) if result.actor_user_id else None,
        "created_at": result.created_at,
    }

    # Publish real-time SSE event.
    publish_status_update_event_sync(
        "report.status_update",
        report_id=report_id,
        stage=stage,
        actor_id=str(user_id),
        actor_role=role,
        extra={"update_id": created["update_id"], "metadata": created["metadata"]},
    )

    return created
