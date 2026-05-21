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
