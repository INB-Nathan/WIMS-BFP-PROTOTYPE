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

COMMIT;
