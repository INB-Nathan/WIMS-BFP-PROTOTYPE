-- 43_app_login_role.sql
-- Creates wims_app_user, a login role that inherits wims_app privileges.
-- The backend and Celery worker connect as wims_app_user so RLS policies
-- are enforced.  DDL (CREATE POLICY, ALTER TABLE) still runs via the postgres
-- superuser — only data-plane queries go through this role.
--
-- Dependencies: 01_extensions_roles.sql (wims_app role must exist)
-- Idempotent: YES

BEGIN;

-- ── Login role ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  CREATE ROLE wims_app_user WITH LOGIN PASSWORD 'wimsapp' INHERIT NOCREATEROLE NOCREATEDB NOSUPERUSER;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

GRANT wims_app TO wims_app_user;

-- ── Schema access ─────────────────────────────────────────────────────────────
-- wims_app already has USAGE ON SCHEMA wims (10_rls_policies.sql).
-- Grant execute on all helper functions so RLS policies can fire.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wims TO wims_app;

-- ── Full data-plane access on all wims tables ─────────────────────────────────
-- RLS policies enforce row-level security; DB-level grants only prevent
-- connection errors.  GRANT ALL avoids brittle per-table bookkeeping as the
-- schema evolves.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wims TO wims_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA wims TO wims_app;

-- Ensure future tables/sequences are also covered (for migrations added later).
ALTER DEFAULT PRIVILEGES IN SCHEMA wims
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wims_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA wims
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO wims_app;

COMMIT;
