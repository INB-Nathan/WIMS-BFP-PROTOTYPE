-- 68_correction_data_hash_fix.sql
-- Purpose : Allow the correction flow to update fire_incidents.data_hash on
--           VERIFIED incidents.
--
-- The no_update_verified rule (last updated by migration 41) blocks ALL updates
-- to VERIFIED rows except VERIFIED→REPLACED transitions and is_archived changes.
-- The RP-06 correction hash-chain feature (correct_verified_incident) needs to
-- write a new data_hash to fire_incidents after recomputing it over the updated
-- NSD fields.  Without this exception the UPDATE is silently a no-op, causing
-- the anchor check in verify_incident_hash_chain to fail with "Anchor mismatch".
--
-- This migration adds a fourth exception: allow updates where only data_hash
-- changes while verification_status stays 'VERIFIED' and is_archived is
-- unchanged.  All other field mutations on VERIFIED rows remain blocked.
-- Idempotent: YES (DROP RULE IF EXISTS before CREATE RULE)

BEGIN;

DROP RULE IF EXISTS no_update_verified ON wims.fire_incidents;

CREATE RULE no_update_verified AS
    ON UPDATE TO wims.fire_incidents
    WHERE (
        OLD.verification_status = 'VERIFIED'
        AND NEW.verification_status != 'REPLACED'
        AND NOT (NEW.is_archived = TRUE  AND OLD.is_archived = FALSE)
        AND NOT (NEW.is_archived = FALSE AND OLD.is_archived = TRUE)
        AND NOT (
            -- Allow data_hash recompute from the correction hash-chain flow
            NEW.data_hash IS DISTINCT FROM OLD.data_hash
            AND NEW.verification_status = 'VERIFIED'
            AND NEW.is_archived = OLD.is_archived
        )
    )
    DO INSTEAD NOTHING;

COMMENT ON TABLE wims.fire_incidents IS
    'no_update_verified rule: blocks all updates to VERIFIED rows EXCEPT the '
    'VERIFIED→REPLACED transition, is_archived archive/unarchive transitions, '
    'and data_hash recomputation from the correction hash-chain flow.';

COMMIT;
