"""Celery tasks: worker heartbeat + system metrics snapshots."""

import logging
import socket

import psutil
from celery import shared_task
from sqlalchemy import text

from database import get_session

logger = logging.getLogger("wims.monitoring")


def _read_worker_timeout_config(db) -> tuple[int, int]:
    """Read worker_stale_timeout_seconds and worker_offline_timeout_seconds
    from wims.system_config.  Falls back to hardcoded defaults (60/300) when
    the config table is unavailable or values are malformed."""
    try:
        rows = db.execute(
            text("""
                SELECT config_key, config_value
                FROM wims.system_config
                WHERE config_key IN (
                    'worker_stale_timeout_seconds',
                    'worker_offline_timeout_seconds'
                )
            """)
        ).fetchall()
        cfg: dict[str, int] = {}
        for r in rows:
            try:
                cfg[r[0]] = int(r[1])
            except (ValueError, TypeError):
                pass
        stale = cfg.get("worker_stale_timeout_seconds", 60)
        offline = cfg.get("worker_offline_timeout_seconds", 300)
        # Sanity: offline must be strictly greater than stale
        if offline <= stale:
            logger.warning(
                "worker_offline_timeout_seconds (%d) <= worker_stale_timeout_seconds (%d); "
                "using fallback defaults 60/300",
                offline,
                stale,
            )
            stale, offline = 60, 300
        return stale, offline
    except Exception:
        return 60, 300


@shared_task(name="tasks.monitoring.worker_heartbeat")
def worker_heartbeat() -> int:
    """
    Register this Celery worker in wims.worker_heartbeat.
    Mark workers not seen within configured intervals as STALE/OFFLINE.
    Reads worker_stale_timeout_seconds and worker_offline_timeout_seconds
    from wims.system_config each run so admin changes take effect without
    a Celery restart.
    Runs every 30 seconds via Celery beat.
    """
    hostname = socket.gethostname()
    db = get_session()
    try:
        stale_secs, offline_secs = _read_worker_timeout_config(db)

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
            text(f"""
                UPDATE wims.worker_heartbeat
                SET status = 'STALE'
                WHERE last_seen < now() - INTERVAL '{stale_secs} seconds'
                  AND last_seen >= now() - INTERVAL '{offline_secs} seconds'
                  AND status = 'ACTIVE'
            """)
        )

        db.execute(
            text(f"""
                UPDATE wims.worker_heartbeat
                SET status = 'OFFLINE'
                WHERE last_seen < now() - INTERVAL '{offline_secs} seconds'
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


@shared_task(name="tasks.monitoring.snapshot_system_metrics")
def snapshot_system_metrics() -> int:
    """
    Collect CPU, memory, disk via psutil and INSERT into wims.system_metrics.
    Prune rows older than 7 days to prevent unbounded growth.
    Runs every 60 seconds via Celery beat.
    """
    cpu = psutil.cpu_percent(interval=0.1)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    db = get_session()
    try:
        db.execute(
            text(
                """
                INSERT INTO wims.system_metrics
                    (cpu_percent, memory_total_mb, memory_used_mb, memory_percent,
                     disk_total_gb, disk_used_gb, disk_percent)
                VALUES
                    (:cpu, :mem_total, :mem_used, :mem_pct,
                     :disk_total, :disk_used, :disk_pct)
                """
            ),
            {
                "cpu": cpu,
                "mem_total": round(mem.total / 1024 / 1024),
                "mem_used": round(mem.used / 1024 / 1024),
                "mem_pct": mem.percent,
                "disk_total": round(disk.total / 1024 / 1024 / 1024, 1),
                "disk_used": round(disk.used / 1024 / 1024 / 1024, 1),
                "disk_pct": disk.percent,
            },
        )

        # Prune rows older than 7 days
        deleted = db.execute(
            text("DELETE FROM wims.system_metrics WHERE recorded_at < now() - INTERVAL '7 days'")
        )

        db.commit()
        logger.info(
            "System metrics snapshot: cpu=%.1f%%, mem=%.1f%%, disk=%.1f%%; pruned %s old rows",
            cpu,
            mem.percent,
            disk.percent,
            deleted.rowcount if deleted else 0,
        )
        return 1

    except Exception as e:
        logger.error("System metrics snapshot failed: %s", e)
        db.rollback()
        return 0
    finally:
        db.close()
