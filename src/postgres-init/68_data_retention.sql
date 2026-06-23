-- 68_data_retention.sql
-- ASVS V14.2.4 Data retention policy implementation
-- Part A: Seed system_config retention keys
-- Part B: Add data_retention_erased_at column to incident_sensitive_details
-- Dependencies: 06_incident_details.sql (incident_sensitive_details table)
-- Idempotent: YES

BEGIN;

-- ==========================================================================
-- Part A: Seed retention config keys
-- ==========================================================================
INSERT INTO wims.system_config (config_key, config_value, description) VALUES
  ('retention.fire_incidents_days', '2555', '7 years for fire_incidents (soft-archive VERIFIED, hard-delete non-VERIFIED)'),
  ('retention.incident_sensitive_details_days', '2555', '7 years for PII blob-erasure on incident_sensitive_details'),
  ('retention.security_threat_logs_days', '365', '1 year for IDS alert log'),
  ('retention.consent_log_days', '1095', '3 years for consent log'),
  ('retention.kms_key_rotation_runs_days', '1095', '3 years for KMS rotation history'),
  ('retention.ip_blocklist_days', '365', '1 year for IP blocklist')
ON CONFLICT (config_key) DO NOTHING;

-- ==========================================================================
-- Part B: Add forensic-erasure timestamp to incident_sensitive_details
-- ==========================================================================
ALTER TABLE wims.incident_sensitive_details
  ADD COLUMN IF NOT EXISTS data_retention_erased_at TIMESTAMPTZ;

COMMIT;
