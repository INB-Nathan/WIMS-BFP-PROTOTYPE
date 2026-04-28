-- 04a_fire_incidents_composite_index.sql
-- Dependencies: 01_wims_initial.sql (table exists)
-- Idempotent: YES
--
-- Analyst dashboard query pattern:
--   SELECT ... FROM fire_incidents
--   WHERE region_id = $1
--     AND verification_status = $2
--   ORDER BY created_at DESC
--
-- Existing idx_fire_incidents_region_created (region_id, created_at DESC)
-- is kept for regional encoder "newest first" queries.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_fire_incidents_composite
  ON wims.fire_incidents (region_id, verification_status, created_at DESC);

COMMIT;
