-- =============================================================================
-- Migration: 40_verification_audit_fields.sql
-- Purpose  : M4b / ISSUE#145 — add SHA-256 hash + sync status to verification audit
--
-- FRS M4b: incident ID, timestamp, validator ID, SHA-256 hash, sync status
--
-- Adds data_hash  VARCHAR(64)  — SHA-256 of the committed incident record
-- Adds sync_status VARCHAR(32) — sync state (default SYNCED)
-- =============================================================================

BEGIN;

ALTER TABLE wims.incident_verification_history
    ADD COLUMN IF NOT EXISTS data_hash   VARCHAR(64),
    ADD COLUMN IF NOT EXISTS sync_status VARCHAR(32) NOT NULL DEFAULT 'SYNCED';

COMMENT ON COLUMN wims.incident_verification_history.data_hash   IS 'SHA-256 hex digest of the verified incident record';
COMMENT ON COLUMN wims.incident_verification_history.sync_status IS 'Sync state: SYNCED | PENDING | FAILED';

COMMIT;
