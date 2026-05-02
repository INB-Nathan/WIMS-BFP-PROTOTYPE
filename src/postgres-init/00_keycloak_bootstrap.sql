-- Keycloak database bootstrap for fresh Postgres volumes.
-- This runs automatically via docker-entrypoint-initdb.d before 01_wims_initial.sql.

-- Create the Keycloak role only if it does not already exist.
SELECT 'CREATE ROLE keycloak LOGIN PASSWORD ''secret''' 
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'keycloak'
)\gexec

-- Create the Keycloak database only if it does not already exist.
SELECT 'CREATE DATABASE keycloak OWNER keycloak'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'keycloak'
)\gexec

GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak;

\connect keycloak
GRANT ALL ON SCHEMA public TO keycloak;
