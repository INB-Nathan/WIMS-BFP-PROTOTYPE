-- 67_repudiation_hardening.sql
-- Purpose : Close repudiation gaps found in RP-01–25 pentest.
--           RP-05 — append-only UPDATE block on incident_verification_history
--           RP-20 — VERIFIED fire_incidents rows must carry a data_hash
-- Depends : 15_validator_workflow.sql, 17_immutable_records.sql
-- Idempotent: YES
--   - DROP RULE / DROP CONSTRAINT IF EXISTS before each CREATE/ADD
--
-- NOTE: These are also applied at backend startup (main.py schema patches) so
--       existing deployments are hardened on redeploy without a fresh DB init.
--
-- Apply manually:
--   docker compose exec -T postgres psql -U postgres -d wims \
--     < src/postgres-init/67_repudiation_hardening.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- RP-05: Block UPDATE on incident_verification_history (append-only audit).
--   17_immutable_records.sql already blocks DELETE (no_delete_ivh) but left
--   UPDATE open, so a DB-level actor could rewrite verification history.
-- ---------------------------------------------------------------------------

DROP RULE IF EXISTS no_update_ivh ON wims.incident_verification_history;
CREATE RULE no_update_ivh AS
    ON UPDATE TO wims.incident_verification_history
    DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- RP-20: A VERIFIED incident must carry a data_hash.
--   The application verify path always computes and stores data_hash at the
--   VERIFIED transition. This CHECK rejects direct DB inserts/updates that
--   would create a VERIFIED row with no integrity hash (and therefore no
--   tamper-evidence). NOT VALID skips the retro-scan of pre-existing rows;
--   the constraint still enforces on every subsequent INSERT/UPDATE.
-- ---------------------------------------------------------------------------

ALTER TABLE wims.fire_incidents
    DROP CONSTRAINT IF EXISTS verified_requires_data_hash;
ALTER TABLE wims.fire_incidents
    ADD CONSTRAINT verified_requires_data_hash
    CHECK (verification_status <> 'VERIFIED' OR data_hash IS NOT NULL)
    NOT VALID;

COMMIT;
