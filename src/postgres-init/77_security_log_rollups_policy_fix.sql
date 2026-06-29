-- 77_security_log_rollups_policy_fix.sql
-- Live-DB migration for pen-test findings 2026-06-29:
-- 1. Replace the single FOR ALL policy with three granular policies so the
--    svc_suricata service account (role NATIONAL_ANALYST) can INSERT/UPDATE
--    rollup rows. DELETE remains SYSTEM_ADMIN-only for audit integrity.
-- 2. Flip siem.store_low_value_raw to 'true' so admin monitoring views
--    (which read security_threat_logs, not the rollups) see scanner/probe/
--    bot traffic during pen-test reviews. The 1-day raw retention
--    (retention.security_threat_logs_days=1) bounds storage cost.
--
-- This file is idempotent and safe to re-run. Apply to the live VPS with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 77_security_log_rollups_policy_fix.sql
--
-- Dependencies: 75_security_log_rollups.sql
-- Idempotent: YES

BEGIN;

-- ── RLS policies (replace single FOR ALL with three granular policies) ─────
-- The 75 file's CREATE POLICY for security_rollups_admin_all is still
-- FOR ALL → SYSTEM_ADMIN only. We drop it and add the granular split.
DROP POLICY IF EXISTS security_rollups_admin_all ON wims.security_threat_log_rollups;

DROP POLICY IF EXISTS security_rollups_insert ON wims.security_threat_log_rollups;
CREATE POLICY security_rollups_insert
ON wims.security_threat_log_rollups FOR INSERT
WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST'));

DROP POLICY IF EXISTS security_rollups_update ON wims.security_threat_log_rollups;
CREATE POLICY security_rollups_update
ON wims.security_threat_log_rollups FOR UPDATE
USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST'))
WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST'));

DROP POLICY IF EXISTS security_rollups_delete ON wims.security_threat_log_rollups;
CREATE POLICY security_rollups_delete
ON wims.security_threat_log_rollups FOR DELETE
USING (wims.current_user_role() = 'SYSTEM_ADMIN');

-- ── Flip siem.store_low_value_raw to 'true' on the live DB ─────────────────
-- The 75 file's INSERT uses ON CONFLICT DO UPDATE, so fresh deploys get
-- the new 'true' default automatically. On the live DB, the row already
-- exists with the old 'false' value, so we update it here.
UPDATE wims.system_config
SET config_value = 'true',
    description  = 'When true, store background/scanner/bot low-value alerts in raw + rollups; admin monitoring views see them. When false, low-value alerts go to rollups only.'
WHERE config_key = 'siem.store_low_value_raw';

COMMIT;
