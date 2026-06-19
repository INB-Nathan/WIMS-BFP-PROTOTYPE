-- 62_security_threat_classification.sql
-- Dependencies: 08_security_audit.sql
-- Idempotent: YES
--
-- Add classification, Suricata signature, and Suricata category columns
-- to wims.security_threat_logs for threat telemetry dashboard support (#410).

BEGIN;

ALTER TABLE wims.security_threat_logs
  ADD COLUMN IF NOT EXISTS classification TEXT,
  ADD COLUMN IF NOT EXISTS suricata_signature TEXT,
  ADD COLUMN IF NOT EXISTS suricata_category TEXT;

COMMIT;
