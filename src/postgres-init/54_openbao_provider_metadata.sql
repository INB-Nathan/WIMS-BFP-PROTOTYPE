-- Migration 54: Add OpenBao KMS provider metadata columns
-- Tracks which crypto provider encrypted each row and which KMS key was used.
-- Enables dual-read during migration from env_aesgcm to openbao_transit.

ALTER TABLE wims.incident_sensitive_details
    ADD COLUMN IF NOT EXISTS crypto_provider TEXT NOT NULL DEFAULT 'env_aesgcm',
    ADD COLUMN IF NOT EXISTS kms_key_name TEXT;

-- Relax constraint: OpenBao Transit rows have pii_blob_enc but no encryption_iv
ALTER TABLE wims.incident_sensitive_details
    DROP CONSTRAINT IF EXISTS incident_sensitive_details_pii_blob_consistency;

ALTER TABLE wims.incident_sensitive_details
    ADD CONSTRAINT incident_sensitive_details_pii_blob_consistency
    CHECK (
        (crypto_provider = 'env_aesgcm' AND pii_blob_enc IS NOT NULL AND encryption_iv IS NOT NULL)
        OR
        (crypto_provider = 'env_aesgcm' AND pii_blob_enc IS NULL AND encryption_iv IS NULL)
        OR
        (crypto_provider = 'openbao_transit' AND pii_blob_enc IS NOT NULL)
        OR
        pii_blob_enc IS NULL
    );
