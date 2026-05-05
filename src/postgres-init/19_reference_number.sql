-- 19_reference_number.sql
-- Adds reference number tracking and incident type code for AFOR duplicate detection.
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.fire_incidents
    ADD COLUMN IF NOT EXISTS reference_number TEXT,
    ADD COLUMN IF NOT EXISTS incident_type_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fire_incidents_reference_number
    ON wims.fire_incidents (reference_number)
    WHERE reference_number IS NOT NULL;

COMMENT ON COLUMN wims.fire_incidents.reference_number IS
    'AFOR reference number: AFOR-RGN-{region_code}-{station_code}-{type_code}-{MMM}-{YYYY}-{NNNN}';
COMMENT ON COLUMN wims.fire_incidents.incident_type_code IS
    '3-4 letter code for the incident type (APT, INF, MSC, BRU, EBK, etc.) used in the reference number.';

ALTER TABLE wims.incident_nonsensitive_details
    ADD COLUMN IF NOT EXISTS station_code TEXT DEFAULT 'TBA';

COMMENT ON COLUMN wims.incident_nonsensitive_details.station_code IS
    'Fire station code from the AFOR reference number format (e.g. QC01). Defaults to TBA until station codes are assigned.';

COMMIT;
