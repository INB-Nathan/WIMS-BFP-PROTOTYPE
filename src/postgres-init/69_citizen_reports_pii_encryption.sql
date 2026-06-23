-- 69_citizen_reports_pii_encryption.sql
-- Encrypt witness PII at rest in citizen_reports (PR #429).
-- Dependencies: 05_citizen_reports.sql (existing table)
-- Idempotent: YES
--
-- Adds blob-encryption columns mirroring the incident_sensitive_details
-- pattern (pii_blob_enc / encryption_iv / crypto_provider / key_version).
-- Plaintext witness_name, witness_phone, device_id, and ip_hash are NULLed
-- on new writes; legacy rows retain plaintext until the backlog script runs.
--
-- AAD namespace: citizen_report:{report_id}

BEGIN;

ALTER TABLE wims.citizen_reports
    ADD COLUMN IF NOT EXISTS witness_pii_blob_enc     TEXT,
    ADD COLUMN IF NOT EXISTS witness_encryption_iv     TEXT,
    ADD COLUMN IF NOT EXISTS witness_crypto_provider   VARCHAR(64),
    ADD COLUMN IF NOT EXISTS witness_key_version       INTEGER;

COMMENT ON COLUMN wims.citizen_reports.witness_pii_blob_enc IS
    'AES-256-GCM encrypted JSON blob: witness_name, witness_phone, device_id, ip_hash. '
    'NULL for legacy rows or anonymized reports.';

COMMENT ON COLUMN wims.citizen_reports.witness_encryption_iv IS
    'Base64-encoded 12-byte AES-GCM nonce (RFC 5116). NULL for legacy/anonymized.';

COMMENT ON COLUMN wims.citizen_reports.witness_crypto_provider IS
    'Crypto provider identifier (env_aesgcm | openbao_transit). NULL for legacy/anonymized.';

COMMENT ON COLUMN wims.citizen_reports.witness_key_version IS
    'Key version used for encryption. NULL for legacy/anonymized.';

COMMIT;
