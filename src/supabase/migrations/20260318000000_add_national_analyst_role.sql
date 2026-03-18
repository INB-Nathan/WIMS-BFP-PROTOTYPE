-- Migration: Add NATIONAL_ANALYST role to wims.users
-- Description: Canonical analyst role for National Analyst Dashboard access.

ALTER TABLE wims.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE wims.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('ENCODER', 'VALIDATOR', 'ANALYST', 'NATIONAL_ANALYST', 'ADMIN', 'SYSTEM_ADMIN', 'REGIONAL_ENCODER'));
