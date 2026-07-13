"""Celery task: archive expired published Community Safety Hub content (Slice F).

Runs on a periodic beat schedule. Idempotent: it only transitions rows that are
still PUBLISHED with an ``expires_at`` in the past, so re-running is safe. A
single ``CMS_EXPIRY_SYSTEM`` audit records the batch size in the same
transaction as the UPDATE.

The task uses the internal SYSTEM_ADMIN service account
(``SYSTEM_TASK_USER_ID``) so the RLS admin-write policy is satisfied.
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from celery_config import celery_app
from database import SYSTEM_TASK_USER_ID, get_session
from utils.audit import log_system_audit

logger = logging.getLogger("wims.tasks.expire_content")


@celery_app.task(name="tasks.expire_content.expire_published_content")
def expire_published_content() -> int:
    """Archive published community content whose ``expires_at`` has passed.

    Returns the number of archived content items.
    """
    db = get_session(SYSTEM_TASK_USER_ID)
    try:
        result = db.execute(
            text(
                """
                UPDATE wims.community_content
                SET lifecycle_status = 'ARCHIVED',
                    archived_at = now(),
                    row_version = row_version + 1,
                    updated_at = now()
                WHERE lifecycle_status = 'PUBLISHED'
                  AND expires_at IS NOT NULL
                  AND expires_at <= now()
                RETURNING id
                """
            )
        )
        archived_ids = [row[0] for row in result.fetchall()]
        count = len(archived_ids)

        # One audit row for the whole batch (sensitive=False => fail-open so a
        # transient audit failure never blocks the expiry archive itself).
        try:
            with db.begin_nested():
                log_system_audit(
                    db=db,
                    user_id=SYSTEM_TASK_USER_ID,
                    action_type="CMS_EXPIRY_SYSTEM",
                    table_affected="wims.community_content",
                    record_id=None,
                    new_values={"archived_count": count},
                    sensitive=False,
                )
        except Exception:  # pragma: no cover - audit is best-effort here
            logger.warning("CMS_EXPIRY_SYSTEM audit emission failed (non-fatal)")

        db.commit()
        if count:
            logger.info("Archived %d expired published community content item(s)", count)
        else:
            logger.info("No expired published community content to archive")
        return count
    except Exception:
        db.rollback()
        logger.exception("Failed to expire published community content")
        raise
    finally:
        db.close()
