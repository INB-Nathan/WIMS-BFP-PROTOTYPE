-- 13_export_reports.sql
-- Dependencies: 01_extensions_roles.sql
-- Idempotent: YES
-- Merged from old 07_analytics_export_log.sql + 08_scheduled_reports.sql

BEGIN;

-- analytics_export_log: audit trail for report exports
CREATE TABLE IF NOT EXISTS wims.analytics_export_log (
    export_id   SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL,
    exported_at TIMESTAMPTZ DEFAULT NOW(),
    format      TEXT NOT NULL CHECK (format IN ('csv', 'pdf', 'excel')),
    filters_json JSONB DEFAULT '{}',
    row_count   INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_export_log_user ON wims.analytics_export_log (user_id);
CREATE INDEX IF NOT EXISTS idx_export_log_time ON wims.analytics_export_log (exported_at);

ALTER TABLE wims.analytics_export_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.analytics_export_log FORCE ROW LEVEL SECURITY;

CREATE POLICY export_log_admin_read ON wims.analytics_export_log
    FOR SELECT TO SYSTEM_ADMIN USING (true);


-- scheduled_reports: configured automated report deliveries
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
    FOR ALL TO SYSTEM_ADMIN USING (true);


COMMIT;
