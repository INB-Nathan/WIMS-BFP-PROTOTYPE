"""Celery task — periodic Redis device blocklist resync (every 5 min).

Bridge between Celery's sync worker and the async
``services.device_blocklist.resync_device_blocklist_to_redis()`` function.
Mirrors tasks/ip_blocklist.py.
"""

from __future__ import annotations

import asyncio
import logging

from celery_config import celery_app
from services.device_blocklist import resync_device_blocklist_to_redis

logger = logging.getLogger("wims.tasks.device_blocklist")


@celery_app.task(name="tasks.device_blocklist.resync_device_blocklist")
def resync_device_blocklist() -> int:
    """Restore Redis device:block:{hash} TTL keys from the Postgres device_blocklist table.

    Covers drift from any failed Redis writes after Postgres commits.
    """
    try:
        return asyncio.run(resync_device_blocklist_to_redis())
    except Exception as e:
        logger.warning("Device blocklist resync task failed: %s", e)
        return 0
