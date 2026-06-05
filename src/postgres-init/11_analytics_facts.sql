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

-- Policies use wims.current_user_role() (GUC-based) instead of TO <role> (PG database roles).
-- wims_app_user is not a member of NATIONAL_ANALYST / REGIONAL_ENCODER / etc., so TO <role>
-- would never match and FORCE ROW LEVEL SECURITY would deny all operations.

-- NATIONAL_ANALYST + SYSTEM_ADMIN: global read
DROP POLICY IF EXISTS aif_national_analyst_read ON wims.analytics_incident_facts;
CREATE POLICY aif_national_analyst_read ON wims.analytics_incident_facts
    FOR SELECT USING (wims.current_user_role() IN ('NATIONAL_ANALYST', 'SYSTEM_ADMIN'));

-- REGIONAL_ENCODER: own-region read
DROP POLICY IF EXISTS aif_regional_read ON wims.analytics_incident_facts;
CREATE POLICY aif_regional_read ON wims.analytics_incident_facts
    FOR SELECT USING (
        wims.current_user_role() = 'REGIONAL_ENCODER'
        AND region_id = wims.current_user_region_id()
    );

-- NATIONAL_VALIDATOR: own-region read
DROP POLICY IF EXISTS aif_validator_read ON wims.analytics_incident_facts;
CREATE POLICY aif_validator_read ON wims.analytics_incident_facts
    FOR SELECT USING (
        wims.current_user_role() = 'NATIONAL_VALIDATOR'
        AND region_id = wims.current_user_region_id()
    );

-- Write access for sync_incident_to_analytics called from route handlers and Celery tasks.
-- Separate INSERT/UPDATE/DELETE policies (not FOR ALL) so these don't broaden SELECT
-- beyond the region-scoped read policies above (multiple policies are OR'd in PostgreSQL).
-- NATIONAL_ANALYST included because correct_verified_incident allows analysts to trigger syncs.
DROP POLICY IF EXISTS aif_staff_write ON wims.analytics_incident_facts;
DROP POLICY IF EXISTS aif_staff_insert ON wims.analytics_incident_facts;
CREATE POLICY aif_staff_insert ON wims.analytics_incident_facts
    FOR INSERT WITH CHECK (
        wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN')
    );

DROP POLICY IF EXISTS aif_staff_update ON wims.analytics_incident_facts;
CREATE POLICY aif_staff_update ON wims.analytics_incident_facts
    FOR UPDATE USING (
        wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN')
    ) WITH CHECK (
        wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN')
    );

DROP POLICY IF EXISTS aif_staff_delete ON wims.analytics_incident_facts;
CREATE POLICY aif_staff_delete ON wims.analytics_incident_facts
    FOR DELETE USING (
        wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN')
    );

-- Remove old TO SYSTEM_ADMIN policy (SELECT covered by aif_national_analyst_read; writes by aif_staff_*)
DROP POLICY IF EXISTS aif_system_admin_all ON wims.analytics_incident_facts;

-- App role needs INSERT/UPDATE/DELETE to sync facts from incidents
GRANT INSERT, UPDATE, DELETE ON wims.analytics_incident_facts TO wims_app;

COMMIT;
