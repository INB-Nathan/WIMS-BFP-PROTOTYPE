-- 61_check_constraints.sql
-- Add non-negative CHECK constraints to wims.incident_nonsensitive_details
-- numeric columns. Mirrors critical semantic invariants as defense-in-depth
-- below the app validation layer (Issue #387 / D13).
-- Idempotent: YES (DO $$ guards per constraint).
--
-- Columns covered (all nullable, some with DEFAULT 0):
--   civilian_deaths, civilian_injured, firefighter_deaths, firefighter_injured,
--   estimated_damage_php, families_affected, water_tankers_used,
--   foam_liters_used, breathing_apparatus_used, structures_affected,
--   households_affected, individuals_affected, vehicles_affected,
--   total_response_time_minutes, total_gas_consumed_liters,
--   extent_total_floor_area_sqm, extent_total_land_area_hectares,
--   distance_from_station_km

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. civilian_deaths
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_civilian_deaths_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_civilian_deaths_non_negative
            CHECK (civilian_deaths IS NULL OR civilian_deaths >= 0);
        RAISE NOTICE 'Added CHECK: chk_incident_nonsensitive_details_civilian_deaths_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_civilian_deaths_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. civilian_injured
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_civilian_injured_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_civilian_injured_non_negative
            CHECK (civilian_injured IS NULL OR civilian_injured >= 0);
        RAISE NOTICE 'Added CHECK: chk_incident_nonsensitive_details_civilian_injured_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_civilian_injured_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. firefighter_deaths
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_firefighter_deaths_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_firefighter_deaths_non_negative
            CHECK (firefighter_deaths IS NULL OR firefighter_deaths >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_firefighter_deaths_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_firefighter_deaths_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. firefighter_injured
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_firefighter_injured_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_firefighter_injured_non_negative
            CHECK (firefighter_injured IS NULL OR firefighter_injured >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_firefighter_injured_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_firefighter_injured_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. estimated_damage_php
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_estimated_damage_php_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_estimated_damage_php_non_negative
            CHECK (estimated_damage_php IS NULL OR estimated_damage_php >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_estimated_damage_php_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_estimated_damage_php_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. families_affected
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_families_affected_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_families_affected_non_negative
            CHECK (families_affected IS NULL OR families_affected >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_families_affected_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_families_affected_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. water_tankers_used
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_water_tankers_used_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_water_tankers_used_non_negative
            CHECK (water_tankers_used IS NULL OR water_tankers_used >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_water_tankers_used_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_water_tankers_used_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. foam_liters_used
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_foam_liters_used_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_foam_liters_used_non_negative
            CHECK (foam_liters_used IS NULL OR foam_liters_used >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_foam_liters_used_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_foam_liters_used_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. breathing_apparatus_used
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_breathing_apparatus_used_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_breathing_apparatus_used_non_negative
            CHECK (breathing_apparatus_used IS NULL OR breathing_apparatus_used >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_breathing_apparatus_used_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_breathing_apparatus_used_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10. structures_affected
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_structures_affected_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_structures_affected_non_negative
            CHECK (structures_affected IS NULL OR structures_affected >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_structures_affected_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_structures_affected_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 11. households_affected
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_households_affected_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_households_affected_non_negative
            CHECK (households_affected IS NULL OR households_affected >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_households_affected_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_households_affected_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 12. individuals_affected
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_individuals_affected_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_individuals_affected_non_negative
            CHECK (individuals_affected IS NULL OR individuals_affected >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_individuals_affected_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_individuals_affected_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 13. vehicles_affected
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_vehicles_affected_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT chk_incident_nonsensitive_details_vehicles_affected_non_negative
            CHECK (vehicles_affected IS NULL OR vehicles_affected >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_vehicles_affected_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_vehicles_affected_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 14. total_response_time_minutes
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_total_response_time_minutes_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT
                chk_incident_nonsensitive_details_total_response_time_minutes_non_negative
            CHECK (total_response_time_minutes IS NULL OR total_response_time_minutes >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_total_response_time_minutes_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_total_response_time_minutes_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 15. total_gas_consumed_liters
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_total_gas_consumed_liters_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT
                chk_incident_nonsensitive_details_total_gas_consumed_liters_non_negative
            CHECK (total_gas_consumed_liters IS NULL OR total_gas_consumed_liters >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_total_gas_consumed_liters_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_total_gas_consumed_liters_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 16. extent_total_floor_area_sqm
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_extent_total_floor_area_sqm_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT
                chk_incident_nonsensitive_details_extent_total_floor_area_sqm_non_negative
            CHECK (extent_total_floor_area_sqm IS NULL OR extent_total_floor_area_sqm >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_extent_total_floor_area_sqm_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_extent_total_floor_area_sqm_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 17. extent_total_land_area_hectares
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_extent_total_land_area_hectares_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT
                chk_incident_nonsensitive_details_extent_total_land_area_hectares_non_negative
            CHECK (extent_total_land_area_hectares IS NULL
                   OR extent_total_land_area_hectares >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_extent_total_land_area_hectares_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_extent_total_land_area_hectares_non_negative already exists; skipped.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 18. distance_from_station_km
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incident_nonsensitive_details_distance_from_station_km_non_negative'
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT
                chk_incident_nonsensitive_details_distance_from_station_km_non_negative
            CHECK (distance_from_station_km IS NULL OR distance_from_station_km >= 0);
        RAISE NOTICE
            'Added CHECK: chk_incident_nonsensitive_details_distance_from_station_km_non_negative.';
    ELSE
        RAISE NOTICE
            'CHECK chk_incident_nonsensitive_details_distance_from_station_km_non_negative already exists; skipped.';
    END IF;
END $$;

COMMIT;
