"""Celery task: worker heartbeat — registers this worker in DB and marks stale workers."""

import logging
import socket

from celery import shared_task
from sqlalchemy import text

from database import get_session

logger = logging.getLogger("wims.monitoring")


@shared_task(name="tasks.monitoring.worker_heartbeat")
def worker_heartbeat() -> int:
    """
    Register this Celery worker in wims.worker_heartbeat.
    Mark workers not seen in >300s as OFFLINE.
    Runs every 30 seconds via Celery beat.
    """
    hostname = socket.gethostname()
    db = get_session()
    try:
        db.execute(
            text("""
                INSERT INTO wims.worker_heartbeat
                    (worker_id, hostname, last_seen, status)
                VALUES
                    (:wid, :host, now(), 'ACTIVE')
                ON CONFLICT (worker_id) DO UPDATE SET
                    last_seen = now(),
                    hostname = EXCLUDED.hostname,
                    status = 'ACTIVE'
            """),
            {"wid": f"celery@{hostname}", "host": hostname},
        )

        db.execute(
            text("""
                UPDATE wims.worker_heartbeat
                SET status = 'STALE'
                WHERE last_seen < now() - INTERVAL '60 seconds'
                  AND last_seen >= now() - INTERVAL '300 seconds'
                  AND status = 'ACTIVE'
            """)
        )

        db.execute(
            text("""
                UPDATE wims.worker_heartbeat
                SET status = 'OFFLINE'
                WHERE last_seen < now() - INTERVAL '300 seconds'
                  AND status != 'OFFLINE'
            """)
        )

        db.commit()
        logger.info("Worker heartbeat recorded for celery@%s", hostname)
        return 1

    except Exception as e:
        logger.error("Worker heartbeat failed: %s", e)
        db.rollback()
        return 0
    finally:
        db.close()
