-- 63_ivh_ip_address.sql
-- Add ip_address column to wims.incident_verification_history for audit trail.
-- Idempotent: YES (ADD COLUMN IF NOT EXISTS)

ALTER TABLE wims.incident_verification_history
    ADD COLUMN IF NOT EXISTS ip_address TEXT;

COMMENT ON COLUMN wims.incident_verification_history.ip_address
    IS 'IP address of the client that triggered this audit event';
