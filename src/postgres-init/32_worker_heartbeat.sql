-- 32_worker_heartbeat.sql
-- Dependencies: 01_extensions_roles.sql
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.worker_heartbeat (
    worker_id       VARCHAR(255) PRIMARY KEY,
    hostname        VARCHAR(255) NOT NULL,
    last_seen       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    active_tasks    INTEGER      NOT NULL DEFAULT 0,
    status          VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'STALE', 'OFFLINE'))
);

COMMENT ON TABLE wims.worker_heartbeat IS
    'Celery worker liveness tracking. Updated every 30s by beat task.';
COMMENT ON COLUMN wims.worker_heartbeat.worker_id IS
    'Celery worker node name (e.g. celery@hostname)';
COMMENT ON COLUMN wims.worker_heartbeat.status IS
    'ACTIVE = seen in last 60s, STALE = 60-300s, OFFLINE = >300s';

CREATE INDEX IF NOT EXISTS idx_worker_heartbeat_last_seen
    ON wims.worker_heartbeat (last_seen DESC);

COMMIT;