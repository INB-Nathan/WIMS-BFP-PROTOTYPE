-- 52_operations_map.sql
-- M4 Operations Board: add map coordinates + radius to wims.operations.
-- Validators can pinpoint fire location on a map and define fire radius.
-- Idempotent: YES (all IF NOT EXISTS)

BEGIN;

ALTER TABLE wims.operations ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE wims.operations ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE wims.operations ADD COLUMN IF NOT EXISTS radius_meters DOUBLE PRECISION;

COMMENT ON COLUMN wims.operations.latitude IS 'Latitude from map pin drop (WGS84)';
COMMENT ON COLUMN wims.operations.longitude IS 'Longitude from map pin drop (WGS84)';
COMMENT ON COLUMN wims.operations.radius_meters IS 'Fire radius in meters (from map circle drag)';

COMMIT;
