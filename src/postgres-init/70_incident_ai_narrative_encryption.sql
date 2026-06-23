-- 70_incident_ai_narrative_encryption.sql
-- Encrypt AI-generated narratives at rest in fire_incidents (PR #429).
-- Dependencies: 04_import_incidents.sql (fire_incidents table)
-- Idempotent: YES
--
-- Adds blob-encryption columns alongside the existing ai_narrative /
-- ai_narrative_confidence plaintext columns. New narratives are stored
-- encrypted in ai_narrative_enc; the plaintext ai_narrative is NULLed.
--
-- AAD namespace: incident_id:{incident_id}:ai_narrative
-- (distinct from incident_sensitive_details AAD which is incident_id:{id})

BEGIN;

ALTER TABLE wims.fire_incidents
    ADD COLUMN IF NOT EXISTS ai_narrative_enc               TEXT,
    ADD COLUMN IF NOT EXISTS ai_narrative_encryption_iv     TEXT,
    ADD COLUMN IF NOT EXISTS ai_narrative_crypto_provider   VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ai_narrative_key_version       INTEGER;

COMMENT ON COLUMN wims.fire_incidents.ai_narrative_enc IS
    'AES-256-GCM encrypted JSON blob: {"narrative": "..."}. '
    'NULL for incidents without a narrative or with legacy plaintext.';

COMMENT ON COLUMN wims.fire_incidents.ai_narrative_encryption_iv IS
    'Base64-encoded 12-byte AES-GCM nonce (RFC 5116). NULL for legacy/anonymized.';

COMMENT ON COLUMN wims.fire_incidents.ai_narrative_crypto_provider IS
    'Crypto provider identifier (env_aesgcm | openbao_transit). NULL for legacy.';

COMMENT ON COLUMN wims.fire_incidents.ai_narrative_key_version IS
    'Key version used for encryption. NULL for legacy.';

-- Composite index for the Celery batch-generation query:
-- finds VERIFIED incidents with neither plaintext nor encrypted narrative.
CREATE INDEX IF NOT EXISTS idx_fire_incidents_ai_narrative_null_v2
    ON wims.fire_incidents (incident_id, created_at DESC)
    WHERE ai_narrative_enc IS NULL
      AND ai_narrative IS NULL
      AND verification_status = 'VERIFIED'
      AND is_archived = FALSE;

COMMIT;
