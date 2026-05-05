-- 17_immutable_records.sql
-- Purpose : M6-D — SHA-256 data_hash column + DB-level immutability rules
-- Depends : 15_validator_workflow.sql (incident_verification_history must exist)
-- Idempotent: YES
--   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   - DROP RULE IF EXISTS before each CREATE RULE
--
-- Apply:
--   docker compose exec -T postgres psql -U postgres -d wims \
--     < src/postgres-init/17_immutable_records.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. SHA-256 hash column on fire_incidents
--    Populated by verify_incident() at the VERIFIED transition.
--    NULL for incidents verified before this migration or not yet VERIFIED.
-- ---------------------------------------------------------------------------

ALTER TABLE wims.fire_incidents
    ADD COLUMN IF NOT EXISTS data_hash VARCHAR(64);

COMMENT ON COLUMN wims.fire_incidents.data_hash IS
    'SHA-256 hex digest of canonical incident JSON, set at VERIFIED transition. Immutable after set.';

-- ---------------------------------------------------------------------------
-- 2. Block UPDATE on VERIFIED fire_incidents rows
--    Encoder corrections and validator pending-actions are blocked at DB level
--    once a row reaches VERIFIED. Application 403 is a second layer only.
-- ---------------------------------------------------------------------------

DROP RULE IF EXISTS no_update_verified ON wims.fire_incidents;
CREATE RULE no_update_verified AS
    ON UPDATE TO wims.fire_incidents
    WHERE (OLD.verification_status = 'VERIFIED')
    DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Block DELETE on VERIFIED fire_incidents rows
--    Hard-deleting a VERIFIED incident is not permitted. Use is_archived instead.
-- ---------------------------------------------------------------------------

DROP RULE IF EXISTS no_delete_verified ON wims.fire_incidents;
CREATE RULE no_delete_verified AS
    ON DELETE TO wims.fire_incidents
    WHERE (OLD.verification_status = 'VERIFIED')
    DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Block DELETE on incident_verification_history (append-only audit table)
--    Every validator action is permanently recorded.
-- ---------------------------------------------------------------------------

DROP RULE IF EXISTS no_delete_ivh ON wims.incident_verification_history;
CREATE RULE no_delete_ivh AS
    ON DELETE TO wims.incident_verification_history
    DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Analytics schema expansion — required for sync_incident_to_analytics (#84)
--    Migration 11 created analytics_incident_facts with a subset of columns.
--    These extended columns are referenced by sync_incident_to_analytics() in
--    services/analytics_read_model.py and must exist for verify_incident() to
--    successfully sync VERIFIED incidents to the analytics read model.
-- ---------------------------------------------------------------------------

ALTER TABLE wims.analytics_incident_facts
    ADD COLUMN IF NOT EXISTS civilian_injured       INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS civilian_deaths        INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS firefighter_injured    INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS firefighter_deaths     INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_response_time_minutes NUMERIC,
    ADD COLUMN IF NOT EXISTS estimated_damage_php   NUMERIC,
    ADD COLUMN IF NOT EXISTS fire_station_name      TEXT,
    ADD COLUMN IF NOT EXISTS barangay_name          TEXT;

COMMIT;
