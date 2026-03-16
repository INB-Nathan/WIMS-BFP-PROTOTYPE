-- Migration: Add REGIONAL_ENCODER role to wims.users
-- Description: Extends the role CHECK constraint to include REGIONAL_ENCODER for regional office access.

-- 1. Drop old constraint
ALTER TABLE wims.users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2. Add updated constraint with REGIONAL_ENCODER
ALTER TABLE wims.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('ENCODER', 'VALIDATOR', 'ANALYST', 'ADMIN', 'SYSTEM_ADMIN', 'REGIONAL_ENCODER'));

-- 3. Comment
COMMENT ON CONSTRAINT users_role_check ON wims.users IS 'Valid roles including REGIONAL_ENCODER for regional office data entry';
