"""Celery task — periodic Redis blocklist resync (every 5 min).

Bridge between Celery's sync worker and the async
``services.ip_blocklist.resync_blocklist_to_redis()`` function.
"""

from __future__ import annotations

import asyncio
import logging

from celery_config import celery_app
from services.ip_blocklist import resync_blocklist_to_redis

logger = logging.getLogger("wims.tasks.ip_blocklist")


@celery_app.task(name="tasks.ip_blocklist.resync_ip_blocklist")
def resync_ip_blocklist() -> int:
    """Restore Redis ip:block:{ip} TTL keys from the Postgres ip_blocklist table.

    Covers drift from any failed Redis writes after Postgres commits.
    """
    try:
        return asyncio.run(resync_blocklist_to_redis())
    except Exception as e:
        logger.warning("Blocklist resync task failed: %s", e)
        return 0
