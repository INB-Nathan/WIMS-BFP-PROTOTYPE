-- 09_rls_helpers.sql
-- Dependencies: 01_extensions_roles.sql, 03_users.sql
-- Idempotent: YES (CREATE OR REPLACE)

BEGIN;

-- current_user_uuid: reads current_user_id GUC set by app per-request
CREATE OR REPLACE FUNCTION wims.current_user_uuid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('wims.current_user_id', true), '')::uuid
$$;

-- current_user_role: returns FRS role from wims.users.role
-- COALESCE to ANONYMOUS is a defensive sentinel for no-session / broken configs
-- ANONYMOUS does NOT appear in any RLS policy IN clause — it is a deny sentinel only
CREATE OR REPLACE FUNCTION wims.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    u.role,
    'ANONYMOUS'::text
  )
  FROM wims.users u
  WHERE u.user_id = wims.current_user_uuid()
    AND u.is_active = TRUE
$$;

-- current_user_region_id: returns assigned_region_id from wims.users
CREATE OR REPLACE FUNCTION wims.current_user_region_id()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT u.assigned_region_id
  FROM wims.users u
  WHERE u.user_id = wims.current_user_uuid()
    AND u.is_active = TRUE
$$;

-- current_region_id: thin alias so analytics RLS callers don't need to change
CREATE OR REPLACE FUNCTION wims.current_region_id()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT wims.current_user_region_id()
$$;

-- set_current_user_uuid: sets the wims.current_user_id GUC directly in the session.
-- Used by admin-write routes (e.g. create_user) where the route authenticates via
-- Keycloak JWT / get_system_admin, but the postgres service-account session has no
-- GUC — causing current_user_role() to return 'ANONYMOUS' and RLS to block the write.
-- SECURITY DEFINER so it bypasses FORCE ROW LEVEL SECURITY on wims.users.
CREATE OR REPLACE FUNCTION wims.set_current_user_uuid(uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('wims.current_user_id', uid::text, true);
END;
$$;

-- exec_as_system_admin: convenience wrapper that sets GUC + role cache for a given
-- user_id so RLS policies (which use wims.current_user_uuid() and
-- wims.current_user_role()) evaluate correctly under the postgres service account.
-- The session's transaction will use this context for all RLS checks.
CREATE OR REPLACE FUNCTION wims.exec_as_system_admin(uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('wims.current_user_id', uid::text, true);
END;
$$;

COMMIT;
