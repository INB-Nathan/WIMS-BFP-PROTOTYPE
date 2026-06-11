-- 51_operations.sql
-- M4 Operations Board: validator-maintained operations table + junction to citizen_reports.
-- SELECT: open to all DB sessions (USING TRUE).
-- INSERT/UPDATE/DELETE: NATIONAL_VALIDATOR only.
-- Idempotent: YES (all IF NOT EXISTS + DROP POLICY IF EXISTS)

BEGIN;

-- ── wims.operations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wims.operations (
    operation_id    SERIAL PRIMARY KEY,
    fire_status     VARCHAR NOT NULL CHECK (fire_status IN ('ACTIVE', 'CONTAINED', 'FIRE_OUT')),
    start_time      TIMESTAMPTZ NOT NULL,
    location        TEXT NOT NULL,
    size_hectares   DOUBLE PRECISION,
    notes           TEXT,
    created_by      UUID REFERENCES wims.users(user_id),
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ── wims.operation_citizen_reports (junction) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS wims.operation_citizen_reports (
    operation_id    INTEGER NOT NULL REFERENCES wims.operations(operation_id) ON DELETE CASCADE,
    report_id       INTEGER NOT NULL REFERENCES wims.citizen_reports(report_id),
    PRIMARY KEY (operation_id, report_id)
);

-- ── RLS: wims.operations ──────────────────────────────────────────────────────
ALTER TABLE wims.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.operations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operations_select ON wims.operations;
CREATE POLICY operations_select ON wims.operations FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS operations_insert ON wims.operations;
CREATE POLICY operations_insert ON wims.operations FOR INSERT
    WITH CHECK (wims.current_user_role() = 'NATIONAL_VALIDATOR');

DROP POLICY IF EXISTS operations_update ON wims.operations;
CREATE POLICY operations_update ON wims.operations FOR UPDATE
    USING (wims.current_user_role() = 'NATIONAL_VALIDATOR')
    WITH CHECK (wims.current_user_role() = 'NATIONAL_VALIDATOR');

DROP POLICY IF EXISTS operations_delete ON wims.operations;
CREATE POLICY operations_delete ON wims.operations FOR DELETE
    USING (wims.current_user_role() = 'NATIONAL_VALIDATOR');

-- ── RLS: wims.operation_citizen_reports ───────────────────────────────────────
ALTER TABLE wims.operation_citizen_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.operation_citizen_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS op_citizen_reports_select ON wims.operation_citizen_reports;
CREATE POLICY op_citizen_reports_select ON wims.operation_citizen_reports FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS op_citizen_reports_insert ON wims.operation_citizen_reports;
CREATE POLICY op_citizen_reports_insert ON wims.operation_citizen_reports FOR INSERT
    WITH CHECK (wims.current_user_role() = 'NATIONAL_VALIDATOR');

DROP POLICY IF EXISTS op_citizen_reports_delete ON wims.operation_citizen_reports;
CREATE POLICY op_citizen_reports_delete ON wims.operation_citizen_reports FOR DELETE
    USING (wims.current_user_role() = 'NATIONAL_VALIDATOR');

COMMIT;
