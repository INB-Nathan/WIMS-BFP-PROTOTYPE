-- Migration 58: Attachment encryption at rest (M6a, #151)
-- Adds encryption metadata columns to wims.incident_attachments.
--
-- FORWARD-ONLY: no backfill. Existing rows keep is_encrypted=false (intentional
-- deviation from the AC's DEFAULT true — applying true to pre-existing plaintext
-- files would cause all legacy attachments to fail decryption on serve). The
-- upload handler sets is_encrypted=true explicitly for every new write.
--
-- key_version: not in the original AC; added for KMS rotation compatibility.
-- When WIMS_MASTER_KEY is rotated the key_version column lets decrypt_bytes
-- select the correct key from the versioned keyring rather than silently failing.

BEGIN;

ALTER TABLE wims.incident_attachments
    ADD COLUMN IF NOT EXISTS is_encrypted    BOOLEAN  NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS encryption_iv   VARCHAR,
    ADD COLUMN IF NOT EXISTS key_version     INTEGER  NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS crypto_provider TEXT     NOT NULL DEFAULT 'env_aesgcm',
    ADD COLUMN IF NOT EXISTS kms_key_name    VARCHAR;

COMMENT ON COLUMN wims.incident_attachments.is_encrypted IS
    'True iff the file at storage_path is AES-256-GCM ciphertext. '
    'DEFAULT false for legacy plaintext files — serve raw, skip decrypt.';

COMMENT ON COLUMN wims.incident_attachments.encryption_iv IS
    'Base64-encoded 12-byte AES-256-GCM nonce used at encryption time. '
    'NULL when is_encrypted = false.';

COMMENT ON COLUMN wims.incident_attachments.key_version IS
    'WIMS_MASTER_KEY version (integer) used to encrypt this file. '
    'Used by decrypt_bytes to select the correct key from the keyring.';

COMMENT ON COLUMN wims.incident_attachments.crypto_provider IS
    'Name of the crypto provider used to encrypt this attachment '
    '(env_aesgcm or openbao_transit). Mirrors incident_sensitive_details '
    'pattern — serve route dispatches get_crypto_provider(row) using this value.';

COMMENT ON COLUMN wims.incident_attachments.kms_key_name IS
    'OpenBao Transit key name when crypto_provider = openbao_transit; '
    'NULL for env_aesgcm rows.';

COMMIT;
