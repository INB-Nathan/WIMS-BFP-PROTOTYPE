"""Celery task for real-time Suricata alert ingestion via Redis streams (M7c #157).

Replaces 10-second file-tail polling with sub-second XREADGROUP consumption
on the 'suricata:alerts' Redis stream.  The file-tail task (tasks.suricata.
ingest_suricata_eve) is retained as a fallback for Redis connectivity loss.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid

import redis

from celery_config import celery_app
from database import get_session, set_rls_context
from services.event_bus import publish_security_event_sync
from services.suricata_ingestion import eve_to_threat_log_row

logger = logging.getLogger(__name__)

STREAM_KEY = "suricata:alerts"
GROUP_NAME = "wims-celery-workers"
CONSUMER_NAME = f"celery-worker-{uuid.uuid4().hex[:8]}"

SYSTEM_SURICATA_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

DEDUP_KEY_PREFIX = "wims:suricata:dedup"
DEDUP_TTL_SECONDS = 300


def _dedup_fingerprint(row: dict) -> str:
    parts = [
        row.get("source_ip", ""),
        str(row.get("suricata_sid", "")),
        row.get("severity_level", ""),
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:32]


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


def _insert_log(db, row: dict) -> int | None:
    from sqlalchemy import text

    row_data = {
        "source_ip": row.get("source_ip", ""),
        "destination_ip": row.get("destination_ip", ""),
        "suricata_sid": row.get("suricata_sid"),
        "severity_level": row.get("severity_level", "MEDIUM"),
        "raw_payload": row.get("raw_payload", "")[:65535] if row.get("raw_payload") else None,
    }
    result = db.execute(
        text("""
            INSERT INTO wims.security_threat_logs
                (source_ip, destination_ip, suricata_sid, severity_level, raw_payload)
            VALUES
                (:source_ip, :destination_ip, :suricata_sid, :severity_level, :raw_payload)
            RETURNING log_id
        """),
        row_data,
    )
    return result.scalar()


@celery_app.task(
    name="tasks.suricata_redis.subscribe_alerts",
    autoretry_for=(redis.ConnectionError, redis.TimeoutError),
    retry_backoff=True,
    retry_backoff_max=10,
    max_retries=3,
)
def subscribe_suricata_alerts() -> int:
    """
    XREADGROUP consumer on the 'suricata:alerts' Redis stream.

    Reads pending alerts, parses them via eve_to_threat_log_row, inserts
    into wims.security_threat_logs, and publishes HIGH/CRITICAL alerts to
    the 'ai:queue' stream for automated AI analysis.

    Returns the number of alerts processed.
    """
    try:
        r = _connect()
    except (redis.ConnectionError, redis.TimeoutError):
        logger.warning("Redis unreachable — skipping stream ingestion (fallback: file-tail)")
        return 0

    try:
        _ensure_group(r)
    except Exception:
        logger.warning("Failed to ensure Redis consumer group — stream may not be initialized")
        return 0

    try:
        entries = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {STREAM_KEY: ">"}, count=50, block=500)
    except redis.ResponseError:
        logger.warning("XREADGROUP failed — consumer group may not exist")
        return 0

    if not entries:
        return 0

    processed = 0
    acks: list[str] = []
    db = get_session()
    try:
        set_rls_context(db, SYSTEM_SURICATA_USER_ID)

        for stream_name, messages in entries:
            for message_id, fields in messages:
                try:
                    raw = fields.get("alert", "{}")
                    ev = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    logger.warning("Invalid JSON in stream message %s", message_id)
                    acks.append(message_id)
                    continue

                row = eve_to_threat_log_row(ev, raw_payload=raw)

                fp = _dedup_fingerprint(row)
                dedup_key = f"{DEDUP_KEY_PREFIX}:{fp}"
                if not r.set(dedup_key, "1", nx=True, ex=DEDUP_TTL_SECONDS):
                    acks.append(message_id)
                    continue

                log_id = _insert_log(db, row)

                if log_id is not None:
                    processed += 1
                    publish_security_event_sync(
                        "security.threat_detected",
                        log_id=log_id,
                        severity=row.get("severity_level"),
                    )

                    if row.get("severity_level") in ("HIGH", "CRITICAL"):
                        r.xadd(
                            "ai:queue",
                            {"log_id": str(log_id), "severity": row["severity_level"]},
                            maxlen=1000,
                        )

                acks.append(message_id)

        db.commit()
        for mid in acks:
            try:
                r.xack(STREAM_KEY, GROUP_NAME, mid)
            except redis.RedisError:
                logger.warning("Failed to ack stream message %s", mid)

        if processed > 0:
            logger.info("Redis stream: processed %d alert(s)", processed)
        return processed
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
