-- 64_consent_log_ip_hash.sql
-- PR #428 (issue #392): stop storing raw client IP in consent_log.
-- Store salted SHA-256 hash instead (D5: privacy-preserving abuse trace).
-- Matches the pattern of 62_audit_correlation_columns.sql (system_audit_trails.ip_hash VARCHAR(128))
-- and 63_ivh_ip_address.sql (incident_verification_history.ip_address TEXT).
-- Idempotent: YES (ALTER TYPE on INET → VARCHAR is implicitly safe;
--   existing IPs are coerced to text; NULLs preserved.)

BEGIN;

ALTER TABLE wims.consent_log
    ALTER COLUMN request_ip TYPE VARCHAR(128)
        USING COALESCE(request_ip::text, '');

COMMENT ON COLUMN wims.consent_log.request_ip IS
    'Salted SHA-256 of the client IP (via WIMS_AUDIT_IP_SALT). '
    'Raw IP is intentionally not persisted (D5: privacy-preserving abuse trace). '
    'Schema migration 64 (PR #428) changed this column from INET to VARCHAR(128).';

COMMIT;
