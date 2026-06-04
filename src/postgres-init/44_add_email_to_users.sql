-- 44_add_email_to_users.sql
-- Adds email column to wims.users for self-service email editing (#28, #86)
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
    ON wims.users (LOWER(email))
    WHERE email IS NOT NULL;

COMMIT;
