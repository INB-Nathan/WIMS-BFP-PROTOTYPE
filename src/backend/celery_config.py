"""Celery app configuration â€” shared by main and tasks to avoid circular imports."""

import os

from celery import Celery
from celery.schedules import crontab

MV_REFRESH_INTERVAL = int(os.environ.get("CELERY_MV_REFRESH_INTERVAL", 3600 * 6))
SCHEDULE_CHECK_INTERVAL = int(os.environ.get("SCHEDULE_CHECK_INTERVAL", 300))

celery_app = Celery(
    "wims_worker",
    broker=os.environ.get("REDIS_URL", "redis://redis:6379/0"),
    backend=os.environ.get(
        "CELERY_RESULT_BACKEND", os.environ.get("REDIS_URL", "redis://redis:6379/0")
    ),
    include=[
        "tasks.analytics_refresh",
        "tasks.civilian_reports",
        "tasks.drafts",
        "tasks.exports",
        "tasks.ip_blocklist",
        "tasks.monitoring",
        "tasks.narrative",
        "tasks.notifications",
        "tasks.suricata",
    ],
)

# The tasks package contains modules rather than app-style tasks.py files, so
# list them explicitly to ensure workers register every scheduled task.
celery_app.conf.imports = (
    "tasks.analytics_refresh",
    "tasks.anomaly_detection",
    "tasks.civilian_reports",
    "tasks.drafts",
    "tasks.exports",
    "tasks.ip_blocklist",
    "tasks.kms_rotation",
    "tasks.monitoring",
    "tasks.narrative",
    "tasks.notifications",
    "tasks.scheduled_reports",
    "tasks.suricata",
)
# Auto-discover task modules instead of side-effect imports in main.py
celery_app.autodiscover_tasks(["tasks", "tasks.suricata_redis", "tasks.ai_forwarding"])
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
        # M4-E: Auto-archive DRAFT incidents older than 30 days. Runs daily at 02:00 UTC.
        "expire-stale-drafts-daily": {
            "task": "tasks.drafts.expire_old_drafts",
            "schedule": crontab(hour=2, minute=0),
        },
        # M6-H: Worker heartbeat â€” every 30 seconds
        "worker-heartbeat": {
            "task": "tasks.monitoring.worker_heartbeat",
            "schedule": 30.0,
        },
        "timeout-pending-civilian-reports": {
            "task": "tasks.civilian_reports.timeout_pending_reports",
            "schedule": 300.0,
        },
        "snapshot-system-metrics": {
            "task": "tasks.monitoring.snapshot_system_metrics",
            "schedule": 60.0,
        },
        "update-suricata-rules-weekly": {
            "task": "tasks.suricata.update_rules",
            "schedule": crontab(hour=3, minute=0, day_of_week=0),
        },
        # M13b: Weekly analytics report â€” Monday 07:00 UTC
        "send-weekly-report-email": {
            "task": "tasks.notifications.send_weekly_report_email",
            "schedule": crontab(day_of_week=1, hour=7, minute=0),
        },
        "subscribe-suricata-alerts": {
            "task": "tasks.suricata_redis.subscribe_alerts",
            "schedule": 1.0,
        },
        "process-ai-queue": {
            "task": "tasks.ai_forwarding.process_queue",
            "schedule": 1.0,
        },
        # GH #152 Phase 6: Daily KMS key rotation check (03:30 UTC)
        "ensure-pii-key-rotation-daily": {
            "task": "tasks.kms_rotation.ensure_pii_key_rotation",
            "schedule": crontab(hour=3, minute=30),
        },
        # M8: Behavioral anomaly detection — every 60s
        "detect-behavioral-anomalies": {
            "task": "tasks.anomaly_detection.detect_behavioral_anomalies",
            "schedule": 60.0,
        },
        # Issue #88: Check due scheduled reports periodically (default 300s)
        "execute-scheduled-reports": {
            "task": "tasks.scheduled_reports.execute_due_reports",
            "schedule": SCHEDULE_CHECK_INTERVAL,
        },
        # Task 7: Periodic Redis blocklist resync (every 5 min)
        "resync-ip-blocklist": {
            "task": "tasks.ip_blocklist.resync_ip_blocklist",
            "schedule": 300.0,
        },
    },
)
