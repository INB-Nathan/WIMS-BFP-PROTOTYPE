-- 53_ref_table_rls.sql
-- M15: Revise RLS on reference geography tables.
-- SELECT: USING (TRUE) — globally readable; public/civilian endpoints read
--   ref_regions without a GUC, so the prior role-gated policy (migration 42)
--   silently returned zero rows on unauthenticated paths.
-- INSERT/UPDATE/DELETE: SYSTEM_ADMIN only — seed rows use superuser during
--   bootstrap; no runtime application code writes to these tables.
-- ref_fire_stations is intentionally excluded (public emergency reference,
--   no RLS applied).
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.ref_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.ref_regions FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.ref_provinces ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.ref_provinces FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.ref_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.ref_cities FORCE ROW LEVEL SECURITY;

-- ── ref_regions ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS ref_regions_select ON wims.ref_regions;
CREATE POLICY ref_regions_select
  ON wims.ref_regions FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS ref_regions_write ON wims.ref_regions;
CREATE POLICY ref_regions_write
  ON wims.ref_regions FOR ALL
  USING (wims.current_user_role() = 'SYSTEM_ADMIN')
  WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

-- ── ref_provinces ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS ref_provinces_select ON wims.ref_provinces;
CREATE POLICY ref_provinces_select
  ON wims.ref_provinces FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS ref_provinces_write ON wims.ref_provinces;
CREATE POLICY ref_provinces_write
  ON wims.ref_provinces FOR ALL
  USING (wims.current_user_role() = 'SYSTEM_ADMIN')
  WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

-- ── ref_cities ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS ref_cities_select ON wims.ref_cities;
CREATE POLICY ref_cities_select
  ON wims.ref_cities FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS ref_cities_write ON wims.ref_cities;
CREATE POLICY ref_cities_write
  ON wims.ref_cities FOR ALL
  USING (wims.current_user_role() = 'SYSTEM_ADMIN')
  WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

COMMIT;
