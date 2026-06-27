"""Celery task — execute scheduled backups per cron expression."""

import logging
from datetime import datetime, timezone

from croniter import croniter
from sqlalchemy import text

from celery_config import celery_app
from database import SYSTEM_TASK_USER_ID, get_session, set_rls_context
from services.backup import trigger_backup as svc_trigger_backup
from utils.audit import log_system_audit

logger = logging.getLogger("wims.tasks.scheduled_backup")


@celery_app.task(name="tasks.scheduled_backup.execute_due_backup", bind=True, max_retries=0)
def execute_due_backup(self) -> dict:
    """Check if a scheduled backup is due and execute it."""
    session = get_session()
    try:
        set_rls_context(session, SYSTEM_TASK_USER_ID)

        row = (
            session.execute(
                text(
                    "SELECT enabled, cron_expr, last_run_at FROM wims.backup_schedule WHERE id = 1"
                )
            )
            .mappings()
            .one_or_none()
        )

        if row is None or not row["enabled"]:
            return {"status": "skipped", "reason": "schedule disabled or not configured"}

        now = datetime.now(timezone.utc)

        # Check if cron has fired since last_run_at
        last_run = row["last_run_at"] or datetime.min.replace(tzinfo=timezone.utc)
        cron = croniter(row["cron_expr"], last_run)
        next_run = cron.get_next(datetime)

        if next_run > now:
            return {"status": "skipped", "reason": f"next run at {next_run.isoformat()}"}

        # Optimistic lock: update last_run_at to prevent double-fire.
        # Use IS NOT DISTINCT FROM so NULL = NULL matches (first-run fix).
        result = session.execute(
            text("""
                UPDATE wims.backup_schedule
                SET last_run_at = now(), updated_at = now()
                WHERE id = 1 AND last_run_at IS NOT DISTINCT FROM :last_run_at
                RETURNING last_run_at
            """),
            {"last_run_at": row["last_run_at"]},
        )
        session.commit()

        if result.rowcount == 0:
            return {"status": "skipped", "reason": "concurrent trigger won the lock"}

        # Execute backup logic (reuse shared service function)
        backup_result = svc_trigger_backup(db=session)

        # Update filename on success
        session.execute(
            text("UPDATE wims.backup_schedule SET last_backup_filename = :fn WHERE id = 1"),
            {"fn": backup_result["filename"]},
        )

        # Log audit event
        log_system_audit(
            db=session,
            user_id=SYSTEM_TASK_USER_ID,
            action_type="BACKUP_TRIGGERED",
            table_affected="wims",
            record_id=None,
            request=None,
            new_values={
                "filename": backup_result["filename"],
                "source": "scheduled",
            },
        )
        session.commit()

        return {"status": "ok", "filename": backup_result["filename"]}

    except Exception as e:
        logger.exception("Scheduled backup failed")
        return {"status": "error", "reason": str(e)[:200]}
    finally:
        session.close()
