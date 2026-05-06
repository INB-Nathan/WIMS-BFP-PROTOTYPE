-- 22_duplicate_flags.sql
-- Adds is_duplicate flag and duplicate_of FK to fire_incidents.
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.fire_incidents
    ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS duplicate_of INTEGER REFERENCES wims.fire_incidents(incident_id);

CREATE INDEX IF NOT EXISTS idx_fire_incidents_duplicate_of
    ON wims.fire_incidents(duplicate_of)
    WHERE duplicate_of IS NOT NULL;

COMMIT;
