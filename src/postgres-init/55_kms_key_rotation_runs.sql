-- Migration 55: KMS key rotation run-state table
-- Tracks automated 90-day OpenBao Transit key rotation + rewrap orchestrations.
-- Enforces single-run guard via active RUNNING row check.
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.kms_key_rotation_runs (
    run_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_name        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'RUNNING'
                        CONSTRAINT kms_rotation_status_check
                        CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    from_version    INTEGER,
    to_version      INTEGER,
    rows_scanned    INTEGER NOT NULL DEFAULT 0,
    rows_rewrapped  INTEGER NOT NULL DEFAULT 0,
    rows_skipped    INTEGER NOT NULL DEFAULT 0,
    rows_failed     INTEGER NOT NULL DEFAULT 0,
    error_message   TEXT
);

-- Index: fast lookup for single-run guard (active RUNNING row per key)
CREATE INDEX IF NOT EXISTS idx_kms_rotation_runs_active
    ON wims.kms_key_rotation_runs (key_name, status)
    WHERE status = 'RUNNING';

-- Index: find last successful run for rotation-due check
CREATE INDEX IF NOT EXISTS idx_kms_rotation_runs_last_success
    ON wims.kms_key_rotation_runs (key_name, completed_at DESC)
    WHERE status = 'SUCCEEDED';

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE wims.kms_key_rotation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.kms_key_rotation_runs FORCE ROW LEVEL SECURITY;

-- Only SYSTEM_ADMIN (and the task service account) may read/write rotation runs.
DROP POLICY IF EXISTS kms_rotation_admin_select ON wims.kms_key_rotation_runs;
CREATE POLICY kms_rotation_admin_select
    ON wims.kms_key_rotation_runs FOR SELECT
    USING (wims.current_user_role() = 'SYSTEM_ADMIN');

DROP POLICY IF EXISTS kms_rotation_admin_all ON wims.kms_key_rotation_runs;
CREATE POLICY kms_rotation_admin_all
    ON wims.kms_key_rotation_runs FOR ALL
    USING (wims.current_user_role() = 'SYSTEM_ADMIN')
    WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

COMMIT;
