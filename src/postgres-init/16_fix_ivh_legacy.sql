-- Migration: 16_fix_ivh_legacy.sql
-- Purpose: Legacy incident_verification_history compatibility after validator workflow.

BEGIN;

ALTER TABLE wims.incident_verification_history
  ADD COLUMN IF NOT EXISTS target_type VARCHAR(16),
  ADD COLUMN IF NOT EXISTS target_id INTEGER,
  ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE wims.incident_verification_history
SET target_type = COALESCE(target_type, 'OFFICIAL'),
    target_id = COALESCE(target_id, incident_id),
    notes = COALESCE(notes, comments)
WHERE target_type IS NULL OR target_id IS NULL OR notes IS NULL;

ALTER TABLE wims.incident_verification_history
  ALTER COLUMN target_type SET NOT NULL,
  ALTER COLUMN target_id SET NOT NULL;

-- Legacy schema used incident_id as required. New validator workflow writes
-- target_type/target_id instead, so incident_id must be nullable.
ALTER TABLE wims.incident_verification_history
  ALTER COLUMN incident_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname='wims' AND c.conname='incident_verification_history_target_type_check'
  ) THEN
    ALTER TABLE wims.incident_verification_history
      ADD CONSTRAINT incident_verification_history_target_type_check
      CHECK (target_type IN ('OFFICIAL','CIVILIAN'));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_ivh_target ON wims.incident_verification_history (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_ivh_action_by ON wims.incident_verification_history (action_by_user_id);

COMMIT;
