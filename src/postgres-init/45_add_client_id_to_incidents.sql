-- Migration 45: Add client_id to fire_incidents for offline-first idempotency.
--
-- client_id is a UUID set by the encoder's browser at the moment an incident is
-- first queued offline. The UNIQUE index guarantees that a retry of a timed-out
-- create request returns the already-created row instead of inserting a duplicate.
--
-- The column is nullable so existing rows (created before this migration) are
-- unaffected. Only incidents created via the offline-first sync path carry a value.

ALTER TABLE wims.fire_incidents
    ADD COLUMN IF NOT EXISTS client_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fire_incidents_client_id
    ON wims.fire_incidents (client_id)
    WHERE client_id IS NOT NULL;
