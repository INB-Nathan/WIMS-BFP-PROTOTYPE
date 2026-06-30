-- 79_schema_migrations.sql
-- Ledger for live deploy migrations. Fresh Postgres volumes still bootstrap
-- src/postgres-init/*.sql through Docker entrypoint; live deploys use
-- backend/scripts/apply_live_migrations.py to baseline existing files and
-- apply future files exactly once.
-- Dependencies: 09_rls_helpers.sql, 10_rls_policies.sql, 60/62 audit columns,
-- 72_partition_audit_trail.sql.
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.schema_migrations (
    filename        TEXT PRIMARY KEY,
    checksum_sha256 TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('baseline', 'applied', 'failed')),
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms     INTEGER,
    deploy_commit   TEXT,
    error_text      TEXT
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at
    ON wims.schema_migrations(applied_at DESC);

ALTER TABLE wims.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.schema_migrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schema_migrations_admin_select ON wims.schema_migrations;
CREATE POLICY schema_migrations_admin_select
ON wims.schema_migrations FOR SELECT
USING (wims.current_user_role() = 'SYSTEM_ADMIN');

DROP POLICY IF EXISTS schema_migrations_admin_write ON wims.schema_migrations;
DROP POLICY IF EXISTS schema_migrations_admin_insert ON wims.schema_migrations;
CREATE POLICY schema_migrations_admin_insert
ON wims.schema_migrations FOR INSERT
WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

DROP POLICY IF EXISTS schema_migrations_admin_update ON wims.schema_migrations;
CREATE POLICY schema_migrations_admin_update
ON wims.schema_migrations FOR UPDATE
USING (wims.current_user_role() = 'SYSTEM_ADMIN')
WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

CREATE OR REPLACE FUNCTION wims.audit_schema_migration_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wims, pg_catalog
AS $$
BEGIN
    INSERT INTO wims.system_audit_trails (
        user_id,
        action_type,
        table_affected,
        record_id,
        ip_address,
        user_agent,
        new_values,
        result
    ) VALUES (
        NULL,
        'SCHEMA_MIGRATION_LEDGER_CHANGE',
        'wims.schema_migrations',
        NULL,
        NULL,
        'apply_live_migrations.py',
        jsonb_build_object(
            'filename', NEW.filename,
            'status', NEW.status,
            'deploy_commit', NEW.deploy_commit,
            'duration_ms', NEW.duration_ms
        ),
        'success'
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_schema_migration_change ON wims.schema_migrations;

CREATE TRIGGER trg_audit_schema_migration_change
AFTER INSERT OR UPDATE ON wims.schema_migrations
FOR EACH ROW
EXECUTE FUNCTION wims.audit_schema_migration_change();

COMMIT;
