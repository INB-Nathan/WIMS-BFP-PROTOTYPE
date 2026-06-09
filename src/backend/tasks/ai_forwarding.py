"""Celery task for automated AI analysis of HIGH/CRITICAL alerts (M7c #157).

Consumes from the 'ai:queue' Redis stream populated by
suricata_redis.subscribe_alerts when HIGH or CRITICAL alerts are ingested.
Each alert is sent to Ollama for structured XAI analysis via
analyze_threat_log(), and the results are persisted to
wims.security_threat_logs.xai_narrative / xai_confidence.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid

import redis

from celery_config import celery_app
from database import get_session, set_rls_context

logger = logging.getLogger(__name__)

STREAM_KEY = "ai:queue"
GROUP_NAME = "wims-ai-workers"
CONSUMER_NAME = f"celery-ai-{uuid.uuid4().hex[:8]}"

SYSTEM_SURICATA_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


def _connect() -> redis.Redis:
    url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    return redis.Redis.from_url(url, decode_responses=True)


def _ensure_group(r: redis.Redis) -> None:
    try:
        r.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
        logger.info("Created Redis stream consumer group '%s' on '%s'", GROUP_NAME, STREAM_KEY)
    except redis.ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


@celery_app.task(
    name="tasks.ai_forwarding.process_queue",
    autoretry_for=(redis.ConnectionError, redis.TimeoutError),
    retry_backoff=True,
    retry_backoff_max=10,
    max_retries=3,
)
def process_ai_queue() -> int:
    """
    XREADGROUP consumer on the 'ai:queue' Redis stream.

    Reads queued alert IDs, calls analyze_threat_log() for each,
    and acks the message on success.

    Returns the number of alerts analyzed.
    """
    try:
        r = _connect()
    except (redis.ConnectionError, redis.TimeoutError):
        logger.warning("Redis unreachable — skipping AI queue")
        return 0

    try:
        _ensure_group(r)
    except Exception:
        return 0

    try:
        entries = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {STREAM_KEY: ">"}, count=10, block=500)
    except redis.ResponseError:
        return 0

    if not entries:
        return 0

    processed = 0
    for stream_name, messages in entries:
        for message_id, fields in messages:
            log_id_str = fields.get("log_id", "")
            if not log_id_str:
                r.xack(STREAM_KEY, GROUP_NAME, message_id)
                continue

            try:
                log_id = int(log_id_str)
            except (TypeError, ValueError):
                r.xack(STREAM_KEY, GROUP_NAME, message_id)
                continue

            db = get_session()
            try:
                set_rls_context(db, SYSTEM_SURICATA_USER_ID)
                from services.ai_service import analyze_threat_log

                asyncio.run(analyze_threat_log(log_id, db))
                db.commit()
                processed += 1
                logger.info("AI analysis completed for security log %s", log_id)
            except Exception as exc:
                logger.error("AI analysis failed for log_id %s: %s", log_id, exc)
                db.rollback()
            finally:
                db.close()

            r.xack(STREAM_KEY, GROUP_NAME, message_id)

    return processed
