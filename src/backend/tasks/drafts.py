"""M4-E: Periodic Celery task to expire stale DRAFT incidents.

Drafts older than DRAFT_EXPIRY_DAYS days (default 30) are soft-archived by
setting is_archived = TRUE. They are not deleted — the audit trail row in
incident_verification_history records the expiry action.
"""

from __future__ import annotations

import logging
import os

from sqlalchemy import text

from celery_config import celery_app
from database import get_session

logger = logging.getLogger(__name__)

DRAFT_EXPIRY_DAYS = int(os.environ.get("WIMS_DRAFT_EXPIRY_DAYS", "30"))


@celery_app.task(name="tasks.drafts.expire_old_drafts")
def expire_old_drafts() -> dict[str, int | list[int]]:
    """Archive DRAFT incidents older than DRAFT_EXPIRY_DAYS.

    Returns a summary dict with the count and IDs of archived incidents.
    """
    db = get_session()
    try:
        result = db.execute(
            text(
                """
                UPDATE wims.fire_incidents
                SET is_archived = TRUE, updated_at = now()
                WHERE verification_status = 'DRAFT'
                  AND is_archived = FALSE
                  AND updated_at < now() - make_interval(days => :days)
                RETURNING incident_id
                """
            ),
            {"days": DRAFT_EXPIRY_DAYS},
        )
        expired_ids = [r[0] for r in result.fetchall()]
        db.commit()
        if expired_ids:
            logger.info(
                "Expired %d stale DRAFT incidents (>%d days): %s",
                len(expired_ids),
                DRAFT_EXPIRY_DAYS,
                expired_ids,
            )
        else:
            logger.info("No stale DRAFT incidents to expire")
        return {"expired": len(expired_ids), "incident_ids": expired_ids}
    except Exception:
        db.rollback()
        logger.exception("Failed to expire stale drafts")
        raise
    finally:
        db.close()
