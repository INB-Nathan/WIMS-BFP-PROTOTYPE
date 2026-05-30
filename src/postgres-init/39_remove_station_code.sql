-- 39_remove_station_code.sql
-- Drops the station_code column from incident_nonsensitive_details and updates
-- the reference_number comment to reflect the new format (no station segment).
-- Idempotent: YES (uses IF EXISTS)

BEGIN;

ALTER TABLE wims.incident_nonsensitive_details
    DROP COLUMN IF EXISTS station_code;

COMMENT ON COLUMN wims.fire_incidents.reference_number IS
    'AFOR reference number: AFOR-RGN-{region_code}-{type_code}-{MMM}-{YYYY}-{NNNN}';

COMMIT;
