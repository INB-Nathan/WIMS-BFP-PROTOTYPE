"""Celery task: archive expired published Community Safety Hub content (Slice F).

Runs on a periodic beat schedule. Idempotent: it only transitions rows that are
still PUBLISHED with an ``expires_at`` in the past, so re-running is safe. A
single ``CMS_EXPIRY_SYSTEM`` audit records the batch size in the same
transaction as the UPDATE, but only when the run actually archived at least one
row. No-op runs (count == 0) are not audited, so the beat does not flood the
audit trail with empty ``CMS_EXPIRY_SYSTEM`` rows every interval.

The task uses the internal SYSTEM_ADMIN service account
(``SYSTEM_TASK_USER_ID``) so the RLS admin-write policy is satisfied.
"""

from __future__ import annotations

import logging
import time

from sqlalchemy import text

from celery_config import celery_app
from database import SYSTEM_TASK_USER_ID, get_session
from utils.audit import log_system_audit
from utils.redis_singleton import get_redis_client

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

        # Only emit an audit row when something was actually archived. A no-op
        # beat run (count == 0) is not an auditable event and would otherwise
        # write a CMS_EXPIRY_SYSTEM row every interval forever, flooding the
        # audit trail. sensitive=False keeps the audit fail-open so a transient
        # audit failure never blocks the archive itself.
        if count:
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

        # Fail-open cumulative metrics emission, AFTER a successful commit so the
        # counters and last_success_ts reflect COMMITTED state — a rolled-back run
        # emits nothing. The celery worker and the API process have separate
        # Prometheus registries and no pushgateway, so the worker persists
        # cumulative counters in Redis; the /metrics endpoint mirrors them into
        # Gauges at scrape time. A Redis outage must never block the archive.
        try:
            redis_client = get_redis_client()
            if redis_client is not None:
                redis_client.incrby("metrics:community_content_expiry:archived_total", int(count))
                if count == 0:
                    redis_client.incrby("metrics:community_content_expiry:skipped_total", 1)
                redis_client.set(
                    "metrics:community_content_expiry:last_success_ts",
                    int(time.time()),
                )
        except Exception:
            logger.debug("Community content expiry metrics emission skipped (Redis unavailable)")
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
