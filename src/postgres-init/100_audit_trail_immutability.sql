-- 100_audit_trail_immutability.sql
-- Purpose : GH #732 — restore append-only enforcement on the FINAL partitioned
--           wims.system_audit_trails schema.
--
--           Migration 17 installed no_update_audit / no_delete_audit RULES,
--           but 72_partition_audit_trail.sql replaced the plain table with a
--           range-partitioned parent and dropped the backup table (and with it
--           both rules). PostgreSQL rules cannot enforce on a partitioned
--           table: a rule attached to the parent is NOT applied to partitions
--           (verified against PG 15 — DELETE on a child partition succeeds).
--
--           This file installs BEFORE row triggers on the partitioned PARENT.
--           Row-level triggers on a partitioned table are cloned onto every
--           existing partition and are automatically applied to partitions
--           created later, so current AND future partitions are covered.
--           Triggers are not bypassed by RLS or by superuser privileges, so
--           the control holds for application roles and for superuser-capable
--           maintenance paths alike.
--
--           Semantics (approved for #732): a prohibited UPDATE/DELETE FAILS
--           CLOSED by raising an error (SQLSTATE 55000) instead of silently
--           succeeding. RLS remains the first layer for application roles
--           (no UPDATE/DELETE policies exist, so app-role writes match zero
--           rows); the trigger is the superuser-resistant layer that raises.
--
--           Ordering: runs after 72 (lexically 100 > 72) on clean bootstrap.
--           Idempotent: YES (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF
--           EXISTS), so it can also be replayed by the Alembic upgrade path
--           for existing databases (revision 0031).
--
-- Apply:
--   docker compose exec -T postgres psql -U postgres -d wims \
--     < src/postgres-init/100_audit_trail_immutability.sql

BEGIN;

CREATE OR REPLACE FUNCTION wims.prevent_audit_trail_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'system_audit_trails is append-only: % is not permitted',
        TG_OP
        USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_trails_no_update ON wims.system_audit_trails;
CREATE TRIGGER trg_audit_trails_no_update
    BEFORE UPDATE ON wims.system_audit_trails
    FOR EACH ROW
    EXECUTE FUNCTION wims.prevent_audit_trail_mutation();

DROP TRIGGER IF EXISTS trg_audit_trails_no_delete ON wims.system_audit_trails;
CREATE TRIGGER trg_audit_trails_no_delete
    BEFORE DELETE ON wims.system_audit_trails
    FOR EACH ROW
    EXECUTE FUNCTION wims.prevent_audit_trail_mutation();

COMMIT;
