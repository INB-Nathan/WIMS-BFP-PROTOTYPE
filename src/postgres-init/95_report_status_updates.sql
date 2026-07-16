-- 95_report_status_updates.sql
-- Structured validator-to-civilian status updates with stage lifecycle and metadata
-- Dependencies: 05_citizen_reports.sql, 03_users.sql
-- Idempotent: YES
--
-- Each row represents a status transition actioned by a validator. Stages follow
-- a fixed forward-only lifecycle: RECEIVED → UNDER_REVIEW → HELP_DISPATCHED →
-- ON_SCENE → RESOLVED, with terminal states CLOSED_DUPLICATE and CLOSED_INSUFFICIENT.
-- metadata is a JSONB column carrying stage-specific structured data (station details,
-- ETA, jurisdiction, arrival time, outcome summary).

BEGIN;

CREATE TABLE IF NOT EXISTS wims.report_status_updates (
    update_id     SERIAL PRIMARY KEY,
    report_id     INTEGER NOT NULL REFERENCES wims.citizen_reports(report_id),
    stage         VARCHAR(32) NOT NULL CHECK (
        stage IN (
            'RECEIVED',
            'UNDER_REVIEW',
            'HELP_DISPATCHED',
            'ON_SCENE',
            'RESOLVED',
            'CLOSED_DUPLICATE',
            'CLOSED_INSUFFICIENT'
        )
    ),
    metadata      JSONB,
    actor_user_id UUID REFERENCES wims.users(user_id),
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_report_status_updates_report
    ON wims.report_status_updates (report_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_status_updates_stage
    ON wims.report_status_updates (stage);

CREATE INDEX IF NOT EXISTS idx_report_status_updates_actor
    ON wims.report_status_updates (actor_user_id)
    WHERE actor_user_id IS NOT NULL;

-- RLS: no UPDATE/DELETE (immutable). SELECT: report owner + validators. INSERT: service role only.
ALTER TABLE wims.report_status_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.report_status_updates FORCE ROW LEVEL SECURITY;

-- SELECT: validator+ roles; civilian access gated at API level (report token / device_id check)
DROP POLICY IF EXISTS report_status_updates_select ON wims.report_status_updates;
CREATE POLICY report_status_updates_select ON wims.report_status_updates
    FOR SELECT USING (
        wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'REGIONAL_ENCODER', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN', 'ANONYMOUS')
    );

-- INSERT: validators via service context (no self-serve civilian insert)
DROP POLICY IF EXISTS report_status_updates_insert ON wims.report_status_updates;
CREATE POLICY report_status_updates_insert ON wims.report_status_updates
    FOR INSERT WITH CHECK (
        wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'REGIONAL_ENCODER', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN')
    );

-- No UPDATE/DELETE policies — rows are immutable once written.
-- Enforced at the database level via the absence of WITH CHECK policies for UPDATE/DELETE.

COMMIT;
