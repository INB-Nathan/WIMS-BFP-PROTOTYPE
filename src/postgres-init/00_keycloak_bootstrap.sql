-- Keycloak database bootstrap for fresh Postgres volumes.
-- Idempotent and self-healing for role/password drift.

-- Ensure the role exists and always has the expected password.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'keycloak'
  ) THEN
    CREATE ROLE keycloak LOGIN PASSWORD 'secret';
  ELSE
    ALTER ROLE keycloak WITH LOGIN PASSWORD 'secret';
  END IF;
END
$$;

-- Ensure the database exists.
SELECT 'CREATE DATABASE keycloak OWNER keycloak'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'keycloak'
)\gexec

-- Ensure ownership and privileges are correct even if DB already existed.
ALTER DATABASE keycloak OWNER TO keycloak;
GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak;

\connect keycloak
GRANT ALL ON SCHEMA public TO keycloak;
