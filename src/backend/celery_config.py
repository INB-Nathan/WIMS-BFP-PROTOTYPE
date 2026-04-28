"""Celery app configuration — shared by main and tasks to avoid circular imports."""

import os

from celery import Celery

MV_REFRESH_INTERVAL = int(os.environ.get("CELERY_MV_REFRESH_INTERVAL", 3600 * 6))

celery_app = Celery(
    "wims_worker", broker=os.environ.get("REDIS_URL", "redis://redis:6379/0")
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # Refresh interval in seconds. Default: 6 hours.
    # Override via CELERY_MV_REFRESH_INTERVAL env var.
    CELERY_MV_REFRESH_INTERVAL=MV_REFRESH_INTERVAL,
    beat_schedule={
        # Refresh analytics materialized views every N seconds (default 6 hours).
        # CONCURRENTLY keeps reads unblocked during refresh.
        "refresh-analytics-mvs": {
            "task": "analytics.refresh_materialized_views",
            "schedule": MV_REFRESH_INTERVAL,
        },
        "ingest-suricata-eve": {
            "task": "tasks.suricata.ingest_suricata_eve",
            "schedule": 10.0,  # every 10 seconds
        },
    },
)
