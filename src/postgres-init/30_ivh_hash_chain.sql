-- 30_ivh_hash_chain.sql
-- Purpose : Add hash-chain columns to wims.incident_verification_history for
--           M6-D correction tamper-evident audit trail.
-- Depends  : 15_validator_workflow.sql (IVH table must exist)
--           The Python code in regional.py:L2138 already expects these columns
--           and returns HTTP 500 if they are missing.
-- Idempotent: YES (ADD COLUMN IF NOT EXISTS)
--
-- Apply:
--   docker compose exec -T postgres psql -U postgres -d wims \
--     < src/postgres-init/30_ivh_hash_chain.sql

BEGIN;

-- 1. old_data_hash — SHA-256 of incident data before correction
ALTER TABLE wims.incident_verification_history
    ADD COLUMN IF NOT EXISTS old_data_hash VARCHAR(64);

COMMENT ON COLUMN wims.incident_verification_history.old_data_hash IS
    'SHA-256 of incident canonical JSON before correction (copied from fire_incidents.data_hash)';

-- 2. new_data_hash — SHA-256 of incident data after correction
ALTER TABLE wims.incident_verification_history
    ADD COLUMN IF NOT EXISTS new_data_hash VARCHAR(64);

COMMENT ON COLUMN wims.incident_verification_history.new_data_hash IS
    'SHA-256 of incident canonical JSON after correction (replaces fire_incidents.data_hash)';

-- 3. corrected_fields — JSON serialized list of field names that were corrected
ALTER TABLE wims.incident_verification_history
    ADD COLUMN IF NOT EXISTS corrected_fields TEXT;

COMMENT ON COLUMN wims.incident_verification_history.corrected_fields IS
    'JSON array of corrected field names (e.g. ["alarm_level","estimated_damage_php"])';

-- 4. prev_ivh_hash — previous IVH row's ivh_row_hash for cryptographic chain linking
ALTER TABLE wims.incident_verification_history
    ADD COLUMN IF NOT EXISTS prev_ivh_hash VARCHAR(64);

COMMENT ON COLUMN wims.incident_verification_history.prev_ivh_hash IS
    'SHA-256 of the immediately preceding IVH row for this incident (NULL if first)';

-- 5. ivh_row_hash — SHA-256 of this IVH row's chain payload (prev_ivh_hash + new_data_hash + corrected_fields + action_timestamp)
ALTER TABLE wims.incident_verification_history
    ADD COLUMN IF NOT EXISTS ivh_row_hash VARCHAR(64);

COMMENT ON COLUMN wims.incident_verification_history.ivh_row_hash IS
    'SHA-256 of chain_payload dict — tamper-evident hash of this audit row';

COMMIT;
