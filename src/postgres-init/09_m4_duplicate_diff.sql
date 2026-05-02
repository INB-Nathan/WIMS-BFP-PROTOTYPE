-- M4-D / M4-G: duplicate detection support and diff snapshots
-- Adds the supersedes link used when an encoder updates a verified incident,
-- and the diff-snapshot table that lets validators see what changed on resubmissions.

ALTER TABLE wims.fire_incidents
    ADD COLUMN IF NOT EXISTS supersedes_incident_id INTEGER
    REFERENCES wims.fire_incidents(incident_id);

CREATE TABLE IF NOT EXISTS wims.incident_diff_snapshots (
    snapshot_id       SERIAL PRIMARY KEY,
    incident_id       INTEGER NOT NULL UNIQUE
                          REFERENCES wims.fire_incidents(incident_id),
    original_snapshot JSONB NOT NULL,
    snapshot_reason   VARCHAR(32) NOT NULL
                          CHECK (snapshot_reason IN (
                              'REJECTED',
                              'UPDATE_EXISTING_PENDING',
                              'SUPERSEDES_VERIFIED'
                          )),
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diff_snapshots_incident
    ON wims.incident_diff_snapshots (incident_id);
