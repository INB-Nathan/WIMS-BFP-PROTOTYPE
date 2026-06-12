-- =============================================================================
-- Migration: 56_add_client_id_to_verification_history.sql
-- Purpose  : #267 — add idempotency client_id to verification audit table
--
-- Adds client_id UUID column with partial unique index to
-- wims.incident_verification_history, enabling offline-first idempotent
-- retry detection by encoder/validator clients.
--
-- Idempotent: YES (IF NOT EXISTS guards)
-- =============================================================================

BEGIN;

ALTER TABLE wims.incident_verification_history
    ADD COLUMN IF NOT EXISTS client_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_incident_verification_history_client_id
    ON wims.incident_verification_history (client_id)
    WHERE client_id IS NOT NULL;

COMMENT ON COLUMN wims.incident_verification_history.client_id
    IS 'Client-generated UUID for idempotent retry detection. NULL for existing rows and non-offline submissions.';

COMMIT;
