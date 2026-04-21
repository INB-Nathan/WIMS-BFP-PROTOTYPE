-- ---------------------------------------------------------------------------
-- 08_scheduled_reports.sql
-- Table for scheduled analytics reports (AQ-15).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wims.scheduled_reports (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    cron_expr   TEXT NOT NULL,
    format      TEXT NOT NULL CHECK (format IN ('pdf', 'excel', 'csv')),
    filters     JSONB DEFAULT '{}',
    recipients  JSONB DEFAULT '[]',
    enabled     BOOLEAN DEFAULT TRUE,
    last_run_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE wims.scheduled_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.scheduled_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY scheduled_reports_admin_all ON wims.scheduled_reports
    FOR ALL
    TO SYSTEM_ADMIN
    USING (true);

GRANT INSERT, SELECT, UPDATE, DELETE ON wims.scheduled_reports TO wims_app;
GRANT USAGE, SELECT ON SEQUENCE wims.scheduled_reports_id_seq TO wims_app;
