"""Celery app configuration — shared by main and tasks to avoid circular imports."""

import os

from celery import Celery

celery_app = Celery(
    "wims_worker", broker=os.environ.get("REDIS_URL", "redis://redis:6379/0")
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "ingest-suricata-eve": {
            "task": "tasks.suricata.ingest_suricata_eve",
            "schedule": 10.0,  # every 10 seconds
        },
    },
)
