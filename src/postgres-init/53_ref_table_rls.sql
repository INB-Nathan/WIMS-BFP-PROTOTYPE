-- 53_ref_table_rls.sql
-- M15: Revise RLS on reference geography tables.
-- SELECT: Region-scoped per FRS M15 vi — REGIONAL_ENCODER and NATIONAL_VALIDATOR
--   see only their assigned region; NATIONAL_ANALYST and SYSTEM_ADMIN see all.
-- INSERT/UPDATE/DELETE: SYSTEM_ADMIN only — seed rows use superuser during
--   bootstrap; no runtime application code writes to these tables.
-- ref_fire_stations is intentionally excluded (public emergency reference,
--   no RLS applied).
-- Adds SECURITY DEFINER helper wims.get_first_region_id() for public_dmz
--   fallback path where no user GUC is set — bypasses ref_regions RLS
--   without weakening the SELECT policy to global-read open access.
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.ref_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.ref_regions FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.ref_provinces ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.ref_provinces FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.ref_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.ref_cities FORCE ROW LEVEL SECURITY;

-- ── SECURITY DEFINER fallback helper ────────────────────────────────────────
-- public_dmz unauthenticated path has no user GUC; wims.current_user_role()
-- returns 'ANONYMOUS' which matches none of the region-scoped roles.
-- This helper runs as the function owner (superuser), bypassing RLS so
-- public_dmz can read a single region_id for incident routing.
-- SEARCH_PATH is locked to wims, pg_temp to prevent function-injection.

CREATE OR REPLACE FUNCTION wims.get_first_region_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = wims, pg_temp
AS $$
  SELECT region_id FROM wims.ref_regions ORDER BY region_id LIMIT 1;
$$;

REVOKE ALL ON FUNCTION wims.get_first_region_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wims.get_first_region_id() TO wims_app;

-- ── ref_regions ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS ref_regions_select ON wims.ref_regions;
CREATE POLICY ref_regions_select
  ON wims.ref_regions FOR SELECT
  USING (
    wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')
    OR (
      wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
      AND region_id = wims.current_user_region_id()
    )
  );

DROP POLICY IF EXISTS ref_regions_write ON wims.ref_regions;
CREATE POLICY ref_regions_write
  ON wims.ref_regions FOR ALL
  USING (wims.current_user_role() = 'SYSTEM_ADMIN')
  WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

-- ── ref_provinces ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS ref_provinces_select ON wims.ref_provinces;
CREATE POLICY ref_provinces_select
  ON wims.ref_provinces FOR SELECT
  USING (
    wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')
    OR (
      wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
      AND region_id = wims.current_user_region_id()
    )
  );

DROP POLICY IF EXISTS ref_provinces_write ON wims.ref_provinces;
CREATE POLICY ref_provinces_write
  ON wims.ref_provinces FOR ALL
  USING (wims.current_user_role() = 'SYSTEM_ADMIN')
  WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

-- ── ref_cities ──────────────────────────────────────────────────────────────
-- cities have no direct region_id; filter via ref_provinces FK subquery

DROP POLICY IF EXISTS ref_cities_select ON wims.ref_cities;
CREATE POLICY ref_cities_select
  ON wims.ref_cities FOR SELECT
  USING (
    wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')
    OR (
      wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
      AND province_id IN (
        SELECT province_id FROM wims.ref_provinces
        WHERE region_id = wims.current_user_region_id()
      )
    )
  );

DROP POLICY IF EXISTS ref_cities_write ON wims.ref_cities;
CREATE POLICY ref_cities_write
  ON wims.ref_cities FOR ALL
  USING (wims.current_user_role() = 'SYSTEM_ADMIN')
  WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

COMMIT;
