-- 36_audit_immutable.sql
-- Dependencies: 08_security_audit.sql
-- Idempotent: YES (DO $$ guards for rule existence)
-- Purpose: M4b — Audit log immutability (append-only, no DELETE/UPDATE)

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_rules
    WHERE schemaname = 'wims'
      AND tablename  = 'system_audit_trails'
      AND rulename   = 'no_delete_audit_trails'
  ) THEN
    EXECUTE 'CREATE RULE no_delete_audit_trails
      AS ON DELETE TO wims.system_audit_trails
      DO INSTEAD NOTHING';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_rules
    WHERE schemaname = 'wims'
      AND tablename  = 'system_audit_trails'
      AND rulename   = 'no_update_audit_trails'
  ) THEN
    EXECUTE 'CREATE RULE no_update_audit_trails
      AS ON UPDATE TO wims.system_audit_trails
      DO INSTEAD NOTHING';
  END IF;
END $$;