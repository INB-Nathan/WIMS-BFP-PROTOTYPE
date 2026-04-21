-- ---------------------------------------------------------------------------
-- 07_analytics_export_log.sql
-- Audit trail for analytics report exports.
-- ---------------------------------------------------------------------------

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

-- SYSTEM_ADMIN: read-only for audit
ALTER TABLE wims.analytics_export_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.analytics_export_log FORCE ROW LEVEL SECURITY;

CREATE POLICY export_log_admin_read ON wims.analytics_export_log
    FOR SELECT
    TO SYSTEM_ADMIN
    USING (true);

-- App role needs INSERT for logging
GRANT INSERT ON wims.analytics_export_log TO wims_app;
GRANT USAGE, SELECT ON SEQUENCE wims.analytics_export_log_export_id_seq TO wims_app;
