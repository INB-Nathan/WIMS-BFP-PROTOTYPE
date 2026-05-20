-- 01_extensions_roles.sql
-- Dependencies: none (runs first after 00_keycloak_bootstrap.sql)
-- Idempotent: YES
-- Purpose: Extensions, schema, and FRS application roles

BEGIN;

-- Extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- required for gen_random_uuid()

-- Schema
CREATE SCHEMA IF NOT EXISTS wims;

-- FRS Roles (must exist before any RLS policy TO clause references them)
DO $$
BEGIN
  CREATE ROLE CIVILIAN_REPORTER;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE ROLE REGIONAL_ENCODER;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE ROLE NATIONAL_VALIDATOR;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE ROLE NATIONAL_ANALYST;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE ROLE SYSTEM_ADMIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE ROLE ANONYMOUS;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

-- Application role (used by app connection pool — RLS enforces security)
DO $$
BEGIN
  CREATE ROLE wims_app WITH NOLOGIN NOCREATEROLE NOCREATEDB NOSUPERUSER NOREPLICATION;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

COMMIT;
