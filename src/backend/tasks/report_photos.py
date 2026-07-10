"""Celery tasks for civilian photo pipeline — cleanup and maintenance.

Task implementations are thin wrappers around
``services.report_photos.reconcile_unreferenced_photo_artifacts`` and
``services.report_photos.cleanup_stale_temp_files``.
No business logic lives here.
"""

from __future__ import annotations

import logging

from celery_config import celery_app
from database import get_session, SYSTEM_TASK_USER_ID
from services.report_photos import (
    cleanup_stale_temp_files,
    reconcile_unreferenced_photo_artifacts,
)

logger = logging.getLogger("wims.tasks.report_photos")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=300)
def cleanup_orphan_civilian_photos(self) -> int:
    """Reconcile unreferenced final artifacts and clean stale temp files.

    Runs two phases:
      1. Operator-safe reconciliation: scan storage for unreferenced
         final photo artifacts (``*_original.bin``, ``*_sanitized.bin``)
         and quarantine candidates that are at least 48 hours old.
      2. Stale temp file cleanup: remove ``*.tmp`` files older than 1 hour.

    Scheduled hourly via beat_schedule. Idempotent: safe to run
    multiple times or concurrently.

    Returns the total number of quarantined artifacts and stale temp files.
    """
    result: dict[str, int] = {"quarantined": 0, "stale_temp": 0}

    try:
        # Phase 1: Reconciliation (use admin session for DB query)
        db = get_session(SYSTEM_TASK_USER_ID)
        try:
            quarantined = reconcile_unreferenced_photo_artifacts(db)
            result["quarantined"] = quarantined
            if quarantined:
                logger.info("Reconciled %d unreferenced photo artifacts", quarantined)
        except Exception as exc:
            logger.error("Photo artifact reconciliation failed")
            raise self.retry(exc=exc) from exc  # type: ignore[misc]
        finally:
            db.close()

        # Phase 2: Stale temp file cleanup
        try:
            stale = cleanup_stale_temp_files(max_age_hours=1)
            result["stale_temp"] = stale
            if stale:
                logger.info("Cleaned up %d stale civilian photo temp files", stale)
        except Exception as exc:
            logger.error("Civilian photo temp cleanup failed")
            raise self.retry(exc=exc) from exc  # type: ignore[misc]

    except Exception:
        raise

    return result["quarantined"] + result["stale_temp"]
