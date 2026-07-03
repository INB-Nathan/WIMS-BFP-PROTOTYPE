-- Operations Board day reset/archive support.

ALTER TABLE wims.operations ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wims.operations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE wims.operations ADD COLUMN IF NOT EXISTS archived_by UUID;
ALTER TABLE wims.operations ADD COLUMN IF NOT EXISTS archive_reason TEXT;
ALTER TABLE wims.operations ADD COLUMN IF NOT EXISTS keep_overnight BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wims.operations ADD COLUMN IF NOT EXISTS carried_over_at TIMESTAMPTZ;
ALTER TABLE wims.operations ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS wims.operation_reset_batches (
    reset_id BIGSERIAL PRIMARY KEY,
    triggered_by UUID,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('AUTO', 'MANUAL')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    archive_count INTEGER NOT NULL DEFAULT 0,
    carried_over_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT
);

ALTER TABLE wims.operation_reset_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.operation_reset_batches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_reset_batches_select ON wims.operation_reset_batches;
CREATE POLICY operation_reset_batches_select ON wims.operation_reset_batches FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS operation_reset_batches_insert ON wims.operation_reset_batches;
CREATE POLICY operation_reset_batches_insert ON wims.operation_reset_batches FOR INSERT
    WITH CHECK (current_setting('wims.current_user_role', true) = 'NATIONAL_VALIDATOR');

CREATE INDEX IF NOT EXISTS idx_operations_is_archived ON wims.operations (is_archived);
CREATE INDEX IF NOT EXISTS idx_operations_keep_overnight ON wims.operations (keep_overnight) WHERE is_archived = FALSE;
