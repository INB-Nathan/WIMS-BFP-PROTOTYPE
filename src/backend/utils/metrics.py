"""Prometheus metrics definitions for WIMS-BFP."""

from prometheus_client import Histogram, Gauge

API_REQUEST_DURATION = Histogram(
    "api_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "endpoint", "status_code"],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
)

DB_QUERY_DURATION = Histogram(
    "db_query_seconds",
    "Database query duration in seconds",
    ["operation"],
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0],
)

REDIS_LATENCY = Histogram(
    "redis_latency_seconds",
    "Redis operation latency in seconds",
    ["operation"],
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1],
)

CELERY_TASK_DURATION = Histogram(
    "celery_task_duration_seconds",
    "Celery task execution duration in seconds",
    ["task_name", "status"],
    buckets=[0.1, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0, 120.0],
)

AI_INFERENCE_DURATION = Histogram(
    "ai_inference_duration_seconds",
    "Ollama inference call duration",
    ["function"],
    buckets=[1.0, 2.5, 5.0, 10.0, 20.0, 30.0, 60.0, 120.0],
)

WORKER_ACTIVE = Gauge(
    "celery_workers_active",
    "Number of active Celery workers",
)

SYSTEM_CPU_PERCENT = Gauge(
    "system_cpu_percent",
    "System CPU usage percentage",
)

SYSTEM_MEMORY_PERCENT = Gauge(
    "system_memory_percent",
    "System memory usage percentage",
)

SYSTEM_DISK_PERCENT = Gauge(
    "system_disk_percent",
    "System disk usage percentage",
    ["mountpoint"],
)

# ---------------------------------------------------------------------------
# Community Content expiry sweep (Slice F) — mirrored from Redis.
# ---------------------------------------------------------------------------
# The celery worker and the API process have separate Prometheus registries and
# no pushgateway, so the worker persists these cumulative values in Redis and
# the GET /metrics endpoint mirrors them into Gauges at scrape time. They are
# declared as Gauges (not Counters) because the API process SETS them from the
# Redis-cached cumulative totals rather than incrementing its own registry.
COMMUNITY_CONTENT_EXPIRY_ARCHIVED_TOTAL = Gauge(
    "community_content_expiry_archived_total",
    "Cumulative community_content items archived by the expiry sweep (mirrored from Redis).",
)

COMMUNITY_CONTENT_EXPIRY_SKIPPED_TOTAL = Gauge(
    "community_content_expiry_skipped_total",
    "Cumulative no-op expiry sweep runs that archived 0 rows (mirrored from Redis).",
)

COMMUNITY_CONTENT_EXPIRY_LAST_SUCCESS_TIMESTAMP_SECONDS = Gauge(
    "community_content_expiry_last_success_timestamp_seconds",
    "Unix epoch seconds of the last successful expiry sweep (mirrored from Redis).",
)
