-- Migration 50: Add key_version to incident_sensitive_details.
-- All existing rows default to version 1 (WIMS_MASTER_KEY).
-- New rows written after key rotation carry the version used to encrypt their blob.
ALTER TABLE wims.incident_sensitive_details
    ADD COLUMN IF NOT EXISTS key_version SMALLINT NOT NULL DEFAULT 1;
