"""Celery tasks for Civilian Reporting Phase 2 workflow."""

from __future__ import annotations

import logging

from sqlalchemy import text

from celery_config import celery_app
from database import get_session, SYSTEM_TASK_USER_ID

logger = logging.getLogger(__name__)

TIMEOUT_EXPLANATION = (
    "No validator action was recorded within the emergency review window. "
    "If the emergency is ongoing, call 911 or submit a new report."
)


@celery_app.task(name="tasks.civilian_reports.timeout_pending_reports")
def timeout_pending_reports() -> dict[str, int | list[int]]:
    """Move PENDING civilian reports older than 2 hours to REJECTED_TIMEOUT."""
    db = get_session(SYSTEM_TASK_USER_ID)
    try:
        result = db.execute(
            text("""
                UPDATE wims.citizen_reports
                SET status = 'REJECTED_TIMEOUT',
                    status_explanation = :explanation
                WHERE status = 'PENDING'
                  AND created_at < now() - interval '2 hours'
                RETURNING report_id
            """),
            {"explanation": TIMEOUT_EXPLANATION},
        )
        report_ids = [row.report_id for row in result.fetchall()]
        for report_id in report_ids:
            db.execute(
                text("""
                    INSERT INTO wims.system_audit_trails
                        (user_id, action_type, table_affected, record_id, timestamp)
                    VALUES
                        (NULL, 'CITIZEN_REPORT_TIMEOUT', 'citizen_reports', :rid, now())
                """),
                {"rid": report_id},
            )
        db.commit()
        if report_ids:
            logger.info("Timed out %d stale civilian reports: %s", len(report_ids), report_ids)
        return {"timed_out": len(report_ids), "report_ids": report_ids}
    except Exception:
        db.rollback()
        logger.exception("Failed to timeout stale civilian reports")
        raise
    finally:
        db.close()
