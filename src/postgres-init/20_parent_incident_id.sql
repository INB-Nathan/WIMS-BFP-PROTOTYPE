-- 20_parent_incident_id.sql
-- Tracks replacement/update requests linking a new PENDING incident to the
-- original VERIFIED incident it supersedes.  When a validator approves the
-- replacement, the new incident inherits the original reference number and the
-- original is archived.
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.fire_incidents
    ADD COLUMN IF NOT EXISTS parent_incident_id INTEGER
        REFERENCES wims.fire_incidents(incident_id);

COMMENT ON COLUMN wims.fire_incidents.parent_incident_id IS
    'Set when an encoder submits a replacement for a VERIFIED incident. '
    'Validator approval of this incident archives the parent and inherits its reference number.';

CREATE INDEX IF NOT EXISTS idx_fire_incidents_parent_incident_id
    ON wims.fire_incidents (parent_incident_id)
    WHERE parent_incident_id IS NOT NULL;

COMMIT;
