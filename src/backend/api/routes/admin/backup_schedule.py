"""System Admin API — backup schedule routes."""

import logging
from datetime import datetime, timezone

from croniter import croniter
from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_db_with_rls, get_system_admin
from schemas.backup import BackupScheduleCreate
from utils.audit import log_system_audit

logger = logging.getLogger("wims.admin")
router = APIRouter()


@router.get("/backup-schedule")
async def get_backup_schedule(
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db_with_rls),
):
    """Get the current backup schedule configuration."""
    row = (
        db.execute(
            text(
                "SELECT enabled, cron_expr, last_run_at, last_backup_filename"
                " FROM wims.backup_schedule WHERE id = 1"
            )
        )
        .mappings()
        .one_or_none()
    )

    if row is None:
        return None

    result = {
        "enabled": row["enabled"],
        "cron_expr": row["cron_expr"],
        "last_run_at": row["last_run_at"].isoformat() if row["last_run_at"] else None,
        "last_backup_filename": row["last_backup_filename"],
    }

    # Compute next_run server-side
    try:
        cron = croniter(row["cron_expr"], row["last_run_at"] or datetime.now(timezone.utc))
        result["next_run"] = cron.get_next(datetime).isoformat()
    except (ValueError, KeyError):
        result["next_run"] = None

    return result


@router.post("/backup-schedule")
async def save_backup_schedule(
    body: BackupScheduleCreate,
    request: Request,
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db_with_rls),
):
    """Save backup schedule configuration."""
    db.execute(
        text("""
            INSERT INTO wims.backup_schedule (id, enabled, cron_expr, updated_at)
            VALUES (1, :enabled, :cron_expr, now())
            ON CONFLICT (id) DO UPDATE
            SET enabled = :enabled, cron_expr = :cron_expr, updated_at = now()
        """),
        {"enabled": body.enabled, "cron_expr": body.cron_expr},
    )

    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="BACKUP_SCHEDULE_UPDATED",
        table_affected="wims.backup_schedule",
        record_id=1,
        request=request,
        new_values={"enabled": body.enabled, "cron_expr": body.cron_expr},
    )
    db.commit()
    return {"status": "ok", "enabled": body.enabled, "cron_expr": body.cron_expr}
