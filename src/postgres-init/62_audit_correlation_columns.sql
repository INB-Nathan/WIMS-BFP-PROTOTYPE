-- 62_audit_correlation_columns.sql
-- Purpose : Standardize system_audit_trails shape for D20 audit integrity
--           (issue #394). Adds correlation_id, result, and ip_hash columns
--           so the audit trail can:
--             * Join to the X-Request-ID header for end-to-end request tracing
--             * Distinguish success vs failure outcomes
--             * Carry a salted SHA-256 of the client IP (rotating salt env:
--               WIMS_AUDIT_IP_SALT) without storing raw PII
--
-- Depends : 08_security_audit.sql (system_audit_trails must exist)
--           60_audit_forensics_columns.sql (old_values/new_values already added)
-- Idempotent: YES (ADD COLUMN IF NOT EXISTS)

BEGIN;

ALTER TABLE wims.system_audit_trails
    ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(64);

ALTER TABLE wims.system_audit_trails
    ADD COLUMN IF NOT EXISTS result VARCHAR(16) NOT NULL DEFAULT 'success';

ALTER TABLE wims.system_audit_trails
    ADD COLUMN IF NOT EXISTS ip_hash VARCHAR(128);

COMMENT ON COLUMN wims.system_audit_trails.correlation_id IS
    'X-Request-ID propagated by the WIMS correlation middleware (issue #394). '
    'Used to join audit rows to structured logs and to a specific HTTP request.';

COMMENT ON COLUMN wims.system_audit_trails.result IS
    'Action outcome: success | failure. Defaults to success for backward compat '
    'with rows written by callers that pre-date the standardized audit shape.';

COMMENT ON COLUMN wims.system_audit_trails.ip_hash IS
    'Salted SHA-256 of the client IP (rotating salt via WIMS_AUDIT_IP_SALT env). '
    'Raw IP is intentionally not persisted (D5: privacy-preserving abuse trace).';

CREATE INDEX IF NOT EXISTS system_audit_trails_correlation_idx
    ON wims.system_audit_trails (correlation_id);

CREATE INDEX IF NOT EXISTS system_audit_trails_result_idx
    ON wims.system_audit_trails (result);

COMMIT;
