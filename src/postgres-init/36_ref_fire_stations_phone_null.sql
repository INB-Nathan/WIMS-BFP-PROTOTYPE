-- 36_ref_fire_stations_phone_null.sql
-- Civilian Reporting Phase 2 — Add phone column to ref_fire_stations (existing rows)
-- Dependencies: 32_ref_fire_stations.sql
-- Idempotent: YES
--
-- The phone column was added to ref_fire_stations in the schema definition.
-- Specific local station numbers are not yet authoritative in the seed set, so
-- Phase 2 uses the emergency hotline as a safe public fallback until official
-- station contact data is loaded.

BEGIN;

ALTER TABLE wims.ref_fire_stations
  ADD COLUMN IF NOT EXISTS phone TEXT;

UPDATE wims.ref_fire_stations
SET phone = '911'
WHERE phone IS NULL;

COMMIT;
