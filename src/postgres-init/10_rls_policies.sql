-- 10_rls_policies.sql
-- Dependencies: 01-09 (all tables + helpers must exist before this runs)
-- Idempotent: YES (IF NOT EXISTS on policies, idempotent grants)
-- Note: analytics_incident_facts RLS enablement is in 11_analytics_facts.sql

BEGIN;

-- App role grants (RLS enforces security — grants provide minimum object access)
GRANT USAGE ON SCHEMA wims TO wims_app;

-- ─── ENABLE RLS ON ALL TABLES ───────────────────────────────────────────────
ALTER TABLE wims.users                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.users                          FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.data_import_batches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.data_import_batches            FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.fire_incidents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.fire_incidents                 FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.citizen_reports                ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.citizen_reports                FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_nonsensitive_details  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_nonsensitive_details  FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_sensitive_details     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_sensitive_details     FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_verification_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_verification_history  FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_attachments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_attachments           FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.involved_parties               ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.involved_parties               FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.operational_challenges         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.operational_challenges         FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.responding_units               ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.responding_units               FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_wildland_afor         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_wildland_afor         FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.wildland_afor_alarm_statuses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.wildland_afor_alarm_statuses   FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.wildland_afor_assistance_rows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.wildland_afor_assistance_rows  FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.security_threat_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.security_threat_logs           FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.system_audit_trails            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.system_audit_trails            FORCE ROW LEVEL SECURITY;

-- ─── USERS TABLE POLICIES ───────────────────────────────────────────────────
DROP POLICY IF EXISTS users_self_or_admin_select ON wims.users;
CREATE POLICY users_self_or_admin_select
ON wims.users FOR SELECT USING (
  user_id = wims.current_user_uuid()
  OR wims.current_user_role() IN ('SYSTEM_ADMIN')
);

DROP POLICY IF EXISTS users_self_update_or_admin ON wims.users;
CREATE POLICY users_self_update_or_admin
ON wims.users FOR UPDATE USING (
  user_id = wims.current_user_uuid()
  OR wims.current_user_role() IN ('SYSTEM_ADMIN')
) WITH CHECK (
  user_id = wims.current_user_uuid()
  OR wims.current_user_role() IN ('SYSTEM_ADMIN')
);

DROP POLICY IF EXISTS users_admin_insert ON wims.users;
CREATE POLICY users_admin_insert
ON wims.users FOR INSERT WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN'));

DROP POLICY IF EXISTS users_admin_delete ON wims.users;
CREATE POLICY users_admin_delete
ON wims.users FOR DELETE USING (wims.current_user_role() IN ('SYSTEM_ADMIN'));

-- ─── DATA_IMPORT_BATCHES POLICIES ──────────────────────────────────────────
-- Drop broken legacy policy (deprecated ADMIN/ANALYST, wrongly region-locked)
DROP POLICY IF EXISTS batches_region_read ON wims.data_import_batches;

-- Split: regional read vs global read
DROP POLICY IF EXISTS batches_read_regional ON wims.data_import_batches;
CREATE POLICY batches_read_regional
ON wims.data_import_batches FOR SELECT USING (
  wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  AND EXISTS (
    SELECT 1 FROM wims.users u
    WHERE u.user_id = wims.current_user_uuid()
      AND u.assigned_region_id = wims.data_import_batches.region_id
      AND u.is_active = TRUE
  )
);

DROP POLICY IF EXISTS batches_read_global ON wims.data_import_batches;
CREATE POLICY batches_read_global
ON wims.data_import_batches FOR SELECT USING (
  wims.current_user_role() IN ('NATIONAL_ANALYST', 'SYSTEM_ADMIN')
);

-- Drop broken legacy write policy
DROP POLICY IF EXISTS batches_region_write ON wims.data_import_batches;

DROP POLICY IF EXISTS batches_region_insert ON wims.data_import_batches;
CREATE POLICY batches_region_insert
ON wims.data_import_batches FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  AND EXISTS (
    SELECT 1 FROM wims.users u
    WHERE u.user_id = wims.current_user_uuid()
      AND u.assigned_region_id = wims.data_import_batches.region_id
      AND u.is_active = TRUE
  )
);

DROP POLICY IF EXISTS batches_region_update ON wims.data_import_batches;
CREATE POLICY batches_region_update
ON wims.data_import_batches FOR UPDATE USING (
  wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  AND EXISTS (
    SELECT 1 FROM wims.users u
    WHERE u.user_id = wims.current_user_uuid()
      AND u.assigned_region_id = wims.data_import_batches.region_id
      AND u.is_active = TRUE
  )
) WITH CHECK (
  wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  AND EXISTS (
    SELECT 1 FROM wims.users u
    WHERE u.user_id = wims.current_user_uuid()
      AND u.assigned_region_id = wims.data_import_batches.region_id
      AND u.is_active = TRUE
  )
);

DROP POLICY IF EXISTS batches_region_delete ON wims.data_import_batches;
CREATE POLICY batches_region_delete
ON wims.data_import_batches FOR DELETE USING (
  wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  AND EXISTS (
    SELECT 1 FROM wims.users u
    WHERE u.user_id = wims.current_user_uuid()
      AND u.assigned_region_id = wims.data_import_batches.region_id
      AND u.is_active = TRUE
  )
);

-- SYSTEM_ADMIN: unrestricted CRUD on batches
DROP POLICY IF EXISTS batches_system_admin_all ON wims.data_import_batches;
CREATE POLICY batches_system_admin_all
ON wims.data_import_batches FOR ALL
USING (wims.current_user_role() IN ('SYSTEM_ADMIN'))
WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN'));

-- ─── FIRE_INCIDENTS POLICIES ────────────────────────────────────────────────
DROP POLICY IF EXISTS fire_incidents_select ON wims.fire_incidents;
CREATE POLICY fire_incidents_select
ON wims.fire_incidents FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')
  OR region_id = wims.current_user_region_id()
);

DROP POLICY IF EXISTS fire_incidents_insert ON wims.fire_incidents;
CREATE POLICY fire_incidents_insert
ON wims.fire_incidents FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN')
  OR region_id = wims.current_user_region_id()
);

DROP POLICY IF EXISTS fire_incidents_update ON wims.fire_incidents;
CREATE POLICY fire_incidents_update
ON wims.fire_incidents FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN')
  OR region_id = wims.current_user_region_id()
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN')
  OR region_id = wims.current_user_region_id()
);

DROP POLICY IF EXISTS fire_incidents_delete ON wims.fire_incidents;
CREATE POLICY fire_incidents_delete
ON wims.fire_incidents FOR DELETE USING (wims.current_user_role() IN ('SYSTEM_ADMIN'));

-- ─── CITIZEN_REPORTS POLICIES ───────────────────────────────────────────────
DROP POLICY IF EXISTS citizen_reports_select ON wims.citizen_reports;
CREATE POLICY citizen_reports_select
ON wims.citizen_reports FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')
  OR (
    incident_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM wims.fire_incidents fi
      WHERE fi.incident_id = wims.citizen_reports.incident_id
        AND fi.region_id = wims.current_user_region_id()
    )
  )
);

DROP POLICY IF EXISTS citizen_reports_write ON wims.citizen_reports;
CREATE POLICY citizen_reports_write
ON wims.citizen_reports FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN')
  OR (
    incident_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM wims.fire_incidents fi
      WHERE fi.incident_id = wims.citizen_reports.incident_id
        AND fi.region_id = wims.current_user_region_id()
    )
  )
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN')
  OR (
    incident_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM wims.fire_incidents fi
      WHERE fi.incident_id = wims.citizen_reports.incident_id
        AND fi.region_id = wims.current_user_region_id()
    )
  )
);

DROP POLICY IF EXISTS citizen_reports_insert ON wims.citizen_reports;
CREATE POLICY citizen_reports_insert
ON wims.citizen_reports FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN')
  OR (
    incident_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM wims.fire_incidents fi
      WHERE fi.incident_id = wims.citizen_reports.incident_id
        AND fi.region_id = wims.current_user_region_id()
    )
  )
);

DROP POLICY IF EXISTS citizen_reports_delete ON wims.citizen_reports;
CREATE POLICY citizen_reports_delete
ON wims.citizen_reports FOR DELETE USING (wims.current_user_role() IN ('SYSTEM_ADMIN'));

-- ─── CHILD TABLE POLICIES (via fire_incidents FK) ───────────────────────────
-- Pattern: SYSTEM_ADMIN + NATIONAL_ANALYST + REGIONAL_ENCODER + NATIONAL_VALIDATOR
-- have full CRUD; CIVILIAN_REPORTER has no access via this path

-- incident_nonsensitive_details
DROP POLICY IF EXISTS incident_nonsensitive_details_region_select ON wims.incident_nonsensitive_details;
CREATE POLICY incident_nonsensitive_details_region_select
ON wims.incident_nonsensitive_details FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_nonsensitive_details_region_insert ON wims.incident_nonsensitive_details;
CREATE POLICY incident_nonsensitive_details_region_insert
ON wims.incident_nonsensitive_details FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_nonsensitive_details_region_update ON wims.incident_nonsensitive_details;
CREATE POLICY incident_nonsensitive_details_region_update
ON wims.incident_nonsensitive_details FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id AND fi.region_id = wims.current_user_region_id())
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_nonsensitive_details_region_delete ON wims.incident_nonsensitive_details;
CREATE POLICY incident_nonsensitive_details_region_delete
ON wims.incident_nonsensitive_details FOR DELETE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id AND fi.region_id = wims.current_user_region_id())
);

-- incident_sensitive_details
DROP POLICY IF EXISTS incident_sensitive_details_region_select ON wims.incident_sensitive_details;
CREATE POLICY incident_sensitive_details_region_select
ON wims.incident_sensitive_details FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_sensitive_details.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_sensitive_details_region_insert ON wims.incident_sensitive_details;
CREATE POLICY incident_sensitive_details_region_insert
ON wims.incident_sensitive_details FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_sensitive_details.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_sensitive_details_region_update ON wims.incident_sensitive_details;
CREATE POLICY incident_sensitive_details_region_update
ON wims.incident_sensitive_details FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_sensitive_details.incident_id AND fi.region_id = wims.current_user_region_id())
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_sensitive_details.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_sensitive_details_region_delete ON wims.incident_sensitive_details;
CREATE POLICY incident_sensitive_details_region_delete
ON wims.incident_sensitive_details FOR DELETE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_sensitive_details.incident_id AND fi.region_id = wims.current_user_region_id())
);

-- incident_attachments
DROP POLICY IF EXISTS incident_attachments_region_select ON wims.incident_attachments;
CREATE POLICY incident_attachments_region_select
ON wims.incident_attachments FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_attachments.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_attachments_region_write ON wims.incident_attachments;
CREATE POLICY incident_attachments_region_write
ON wims.incident_attachments FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_attachments.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_attachments_region_update ON wims.incident_attachments;
CREATE POLICY incident_attachments_region_update
ON wims.incident_attachments FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_attachments.incident_id AND fi.region_id = wims.current_user_region_id())
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_attachments.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_attachments_region_delete ON wims.incident_attachments;
CREATE POLICY incident_attachments_region_delete
ON wims.incident_attachments FOR DELETE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_attachments.incident_id AND fi.region_id = wims.current_user_region_id())
);

-- incident_verification_history
DROP POLICY IF EXISTS incident_verification_history_region_select ON wims.incident_verification_history;
CREATE POLICY incident_verification_history_region_select
ON wims.incident_verification_history FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_verification_history.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_verification_history_region_insert ON wims.incident_verification_history;
CREATE POLICY incident_verification_history_region_insert
ON wims.incident_verification_history FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_verification_history.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_verification_history_region_update ON wims.incident_verification_history;
CREATE POLICY incident_verification_history_region_update
ON wims.incident_verification_history FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_verification_history.incident_id AND fi.region_id = wims.current_user_region_id())
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_verification_history.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_verification_history_region_delete ON wims.incident_verification_history;
CREATE POLICY incident_verification_history_region_delete
ON wims.incident_verification_history FOR DELETE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_verification_history.incident_id AND fi.region_id = wims.current_user_region_id())
);

-- involved_parties
DROP POLICY IF EXISTS involved_parties_region_select ON wims.involved_parties;
CREATE POLICY involved_parties_region_select
ON wims.involved_parties FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.involved_parties.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS involved_parties_region_insert ON wims.involved_parties;
CREATE POLICY involved_parties_region_insert
ON wims.involved_parties FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.involved_parties.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS involved_parties_region_update ON wims.involved_parties;
CREATE POLICY involved_parties_region_update
ON wims.involved_parties FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.involved_parties.incident_id AND fi.region_id = wims.current_user_region_id())
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.involved_parties.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS involved_parties_region_delete ON wims.involved_parties;
CREATE POLICY involved_parties_region_delete
ON wims.involved_parties FOR DELETE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.involved_parties.incident_id AND fi.region_id = wims.current_user_region_id())
);

-- operational_challenges
DROP POLICY IF EXISTS operational_challenges_region_select ON wims.operational_challenges;
CREATE POLICY operational_challenges_region_select
ON wims.operational_challenges FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.operational_challenges.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS operational_challenges_region_insert ON wims.operational_challenges;
CREATE POLICY operational_challenges_region_insert
ON wims.operational_challenges FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.operational_challenges.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS operational_challenges_region_update ON wims.operational_challenges;
CREATE POLICY operational_challenges_region_update
ON wims.operational_challenges FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.operational_challenges.incident_id AND fi.region_id = wims.current_user_region_id())
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.operational_challenges.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS operational_challenges_region_delete ON wims.operational_challenges;
CREATE POLICY operational_challenges_region_delete
ON wims.operational_challenges FOR DELETE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.operational_challenges.incident_id AND fi.region_id = wims.current_user_region_id())
);

-- responding_units
DROP POLICY IF EXISTS responding_units_region_select ON wims.responding_units;
CREATE POLICY responding_units_region_select
ON wims.responding_units FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.responding_units.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS responding_units_region_insert ON wims.responding_units;
CREATE POLICY responding_units_region_insert
ON wims.responding_units FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.responding_units.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS responding_units_region_update ON wims.responding_units;
CREATE POLICY responding_units_region_update
ON wims.responding_units FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.responding_units.incident_id AND fi.region_id = wims.current_user_region_id())
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.responding_units.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS responding_units_region_delete ON wims.responding_units;
CREATE POLICY responding_units_region_delete
ON wims.responding_units FOR DELETE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.responding_units.incident_id AND fi.region_id = wims.current_user_region_id())
);

-- ─── WILDLAND AFOR POLICIES (two-level chain: child→incident_wildland_afor→fire_incidents) ───
-- incident_wildland_afor
DROP POLICY IF EXISTS incident_wildland_afor_region_select ON wims.incident_wildland_afor;
CREATE POLICY incident_wildland_afor_region_select
ON wims.incident_wildland_afor FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_wildland_afor.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_wildland_afor_region_insert ON wims.incident_wildland_afor;
CREATE POLICY incident_wildland_afor_region_insert
ON wims.incident_wildland_afor FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_wildland_afor.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_wildland_afor_region_update ON wims.incident_wildland_afor;
CREATE POLICY incident_wildland_afor_region_update
ON wims.incident_wildland_afor FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_wildland_afor.incident_id AND fi.region_id = wims.current_user_region_id())
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_wildland_afor.incident_id AND fi.region_id = wims.current_user_region_id())
);
DROP POLICY IF EXISTS incident_wildland_afor_region_delete ON wims.incident_wildland_afor;
CREATE POLICY incident_wildland_afor_region_delete
ON wims.incident_wildland_afor FOR DELETE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (SELECT 1 FROM wims.fire_incidents fi WHERE fi.incident_id = wims.incident_wildland_afor.incident_id AND fi.region_id = wims.current_user_region_id())
);

-- wildland_afor_alarm_statuses (via two-level join)
DROP POLICY IF EXISTS wildland_afor_alarm_statuses_region_select ON wims.wildland_afor_alarm_statuses;
CREATE POLICY wildland_afor_alarm_statuses_region_select
ON wims.wildland_afor_alarm_statuses FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_alarm_statuses.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);
DROP POLICY IF EXISTS wildland_afor_alarm_statuses_region_insert ON wims.wildland_afor_alarm_statuses;
CREATE POLICY wildland_afor_alarm_statuses_region_insert
ON wims.wildland_afor_alarm_statuses FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_alarm_statuses.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);
DROP POLICY IF EXISTS wildland_afor_alarm_statuses_region_update ON wims.wildland_afor_alarm_statuses;
CREATE POLICY wildland_afor_alarm_statuses_region_update
ON wims.wildland_afor_alarm_statuses FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_alarm_statuses.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_alarm_statuses.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);
DROP POLICY IF EXISTS wildland_afor_alarm_statuses_region_delete ON wims.wildland_afor_alarm_statuses;
CREATE POLICY wildland_afor_alarm_statuses_region_delete
ON wims.wildland_afor_alarm_statuses FOR DELETE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_alarm_statuses.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- wildland_afor_assistance_rows (via two-level join)
DROP POLICY IF EXISTS wildland_afor_assistance_rows_region_select ON wims.wildland_afor_assistance_rows;
CREATE POLICY wildland_afor_assistance_rows_region_select
ON wims.wildland_afor_assistance_rows FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_assistance_rows.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);
DROP POLICY IF EXISTS wildland_afor_assistance_rows_region_insert ON wims.wildland_afor_assistance_rows;
CREATE POLICY wildland_afor_assistance_rows_region_insert
ON wims.wildland_afor_assistance_rows FOR INSERT WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_assistance_rows.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);
DROP POLICY IF EXISTS wildland_afor_assistance_rows_region_update ON wims.wildland_afor_assistance_rows;
CREATE POLICY wildland_afor_assistance_rows_region_update
ON wims.wildland_afor_assistance_rows FOR UPDATE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_assistance_rows.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
) WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_assistance_rows.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);
DROP POLICY IF EXISTS wildland_afor_assistance_rows_region_delete ON wims.wildland_afor_assistance_rows;
CREATE POLICY wildland_afor_assistance_rows_region_delete
ON wims.wildland_afor_assistance_rows FOR DELETE USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_assistance_rows.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- ─── SECURITY / AUDIT TABLE POLICIES ───────────────────────────────────────
-- security_threat_logs: GLOBAL (borderless — cybersecurity threats)
-- NATIONAL_ANALYST and SYSTEM_ADMIN get full CRUD for IDS correlation
DROP POLICY IF EXISTS security_logs_admin_only ON wims.security_threat_logs;
CREATE POLICY security_logs_admin_only
ON wims.security_threat_logs FOR ALL
USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST'))
WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST'));

-- system_audit_trails: read for self + admins, insert for service
DROP POLICY IF EXISTS audit_trails_read_admin_or_self ON wims.system_audit_trails;
CREATE POLICY audit_trails_read_admin_or_self
ON wims.system_audit_trails FOR SELECT USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')
  OR user_id = wims.current_user_uuid()
);

DROP POLICY IF EXISTS audit_trails_insert_service ON wims.system_audit_trails;
CREATE POLICY audit_trails_insert_service
ON wims.system_audit_trails FOR INSERT WITH CHECK (TRUE);

-- ─── LOCKDOWN ───────────────────────────────────────────────────────────────
REVOKE ALL ON SCHEMA wims FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA wims FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA wims FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA wims REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA wims REVOKE ALL ON SEQUENCES FROM PUBLIC;

COMMIT;
