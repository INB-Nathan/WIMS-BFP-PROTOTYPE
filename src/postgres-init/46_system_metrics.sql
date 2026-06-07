-- Create wims.system_metrics table for 60s Celery snapshots.
-- Stores CPU, memory, disk from psutil sampled inside the Celery worker container.
-- Rows are pruned older than 7 days by the snapshot task itself.

CREATE TABLE IF NOT EXISTS wims.system_metrics (
    id SERIAL PRIMARY KEY,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cpu_percent DOUBLE PRECISION,
    memory_total_mb INTEGER,
    memory_used_mb INTEGER,
    memory_percent DOUBLE PRECISION,
    disk_total_gb DOUBLE PRECISION,
    disk_used_gb DOUBLE PRECISION,
    disk_percent DOUBLE PRECISION
);
