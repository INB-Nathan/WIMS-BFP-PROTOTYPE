-- 60_audit_forensics_columns.sql
-- Purpose : Add old_values / new_values JSONB columns to system_audit_trails
--           for forensic completeness per ASVS V7.3.1.  Addresses GH #242.
-- Depends : 08_security_audit.sql (system_audit_trails must exist)
-- Idempotent: YES (ADD COLUMN IF NOT EXISTS)
--
-- Apply:
--   docker compose exec -T postgres psql -U postgres -d wims \
--     < src/postgres-init/60_audit_forensics_columns.sql

BEGIN;

ALTER TABLE wims.system_audit_trails
    ADD COLUMN IF NOT EXISTS old_values JSONB;

ALTER TABLE wims.system_audit_trails
    ADD COLUMN IF NOT EXISTS new_values JSONB;

COMMENT ON COLUMN wims.system_audit_trails.old_values IS
    'JSONB snapshot of row values before an UPDATE action. NULL for INSERT or DELETE actions.';

COMMENT ON COLUMN wims.system_audit_trails.new_values IS
    'JSONB snapshot of row values after an UPDATE action. NULL for INSERT or DELETE actions.';

COMMIT;
