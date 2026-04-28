-- 11_analytics_facts.sql
-- Dependencies: 04_import_incidents.sql, 06_incident_details.sql
-- Idempotent: YES
-- Note: RLS for analytics_incident_facts is included here (not in 10_rls_policies.sql)

BEGIN;

CREATE TABLE IF NOT EXISTS wims.analytics_incident_facts (
    incident_id       INTEGER PRIMARY KEY,
    region_id          INTEGER,
    location           GEOGRAPHY(POINT, 4326),
    notification_dt    TIMESTAMPTZ,
    notification_date  DATE,
    alarm_level        TEXT,
    general_category   TEXT,
    synced_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aif_notification_date ON wims.analytics_incident_facts (notification_date);
CREATE INDEX IF NOT EXISTS idx_aif_region_id         ON wims.analytics_incident_facts (region_id);
CREATE INDEX IF NOT EXISTS idx_aif_alarm_level       ON wims.analytics_incident_facts (alarm_level);
CREATE INDEX IF NOT EXISTS idx_aif_general_category  ON wims.analytics_incident_facts (general_category);

ALTER TABLE wims.analytics_incident_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.analytics_incident_facts FORCE ROW LEVEL SECURITY;

-- NATIONAL_ANALYST: read-only global access
CREATE POLICY aif_national_analyst_read ON wims.analytics_incident_facts
    FOR SELECT TO NATIONAL_ANALYST USING (true);

-- REGIONAL_ENCODER / NATIONAL_VALIDATOR: filtered to their region
CREATE POLICY aif_regional_read ON wims.analytics_incident_facts
    FOR SELECT TO REGIONAL_ENCODER USING (region_id = wims.current_user_region_id());

CREATE POLICY aif_validator_read ON wims.analytics_incident_facts
    FOR SELECT TO NATIONAL_VALIDATOR USING (region_id = wims.current_user_region_id());

-- SYSTEM_ADMIN: full CRUD for maintenance
CREATE POLICY aif_system_admin_all ON wims.analytics_incident_facts
    FOR ALL TO SYSTEM_ADMIN USING (true);

-- App role needs INSERT/UPDATE to sync facts from incidents
GRANT INSERT, UPDATE ON wims.analytics_incident_facts TO wims_app;

COMMIT;
