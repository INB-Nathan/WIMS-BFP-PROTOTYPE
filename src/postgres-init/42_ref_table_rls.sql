-- 42_ref_table_rls.sql
-- Enable RLS on reference geography tables.
-- REGIONAL_ENCODER sees only their assigned region's data.
-- NATIONAL_VALIDATOR, NATIONAL_ANALYST, and SYSTEM_ADMIN see all.
-- ref_fire_stations is intentionally excluded (public emergency reference).
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.ref_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.ref_regions FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.ref_provinces ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.ref_provinces FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.ref_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.ref_cities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ref_regions_select ON wims.ref_regions;
CREATE POLICY ref_regions_select
ON wims.ref_regions FOR SELECT USING (
    wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_VALIDATOR')
    OR region_id = wims.current_user_region_id()
);

DROP POLICY IF EXISTS ref_provinces_select ON wims.ref_provinces;
CREATE POLICY ref_provinces_select
ON wims.ref_provinces FOR SELECT USING (
    wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_VALIDATOR')
    OR region_id = wims.current_user_region_id()
);

-- ref_cities has no direct region_id; filter via ref_provinces FK
DROP POLICY IF EXISTS ref_cities_select ON wims.ref_cities;
CREATE POLICY ref_cities_select
ON wims.ref_cities FOR SELECT USING (
    wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_VALIDATOR')
    OR province_id IN (
        SELECT province_id FROM wims.ref_provinces
        WHERE region_id = wims.current_user_region_id()
    )
);

COMMIT;
