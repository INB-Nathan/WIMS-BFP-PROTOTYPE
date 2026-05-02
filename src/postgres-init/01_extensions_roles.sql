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
CREATE ROLE CIVILIAN_REPORTER;
CREATE ROLE REGIONAL_ENCODER;
CREATE ROLE NATIONAL_VALIDATOR;
CREATE ROLE NATIONAL_ANALYST;
CREATE ROLE SYSTEM_ADMIN;
CREATE ROLE ANONYMOUS;

-- Application role (used by app connection pool — RLS enforces security)
CREATE ROLE wims_app WITH NOLOGIN NOCREATEROLE NOCREATEDB NOSUPERUSER NOREPLICATION;

COMMIT;
