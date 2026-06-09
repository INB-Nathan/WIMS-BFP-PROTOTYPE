-- 47_notification_preferences.sql
-- Add per-user notification opt-in flags (email + push) for #72
-- Defaults TRUE preserves existing notification behaviour for all current users.
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.users ADD COLUMN IF NOT EXISTS email_opt_in BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE wims.users ADD COLUMN IF NOT EXISTS push_opt_in  BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
