-- Migration: Add trust_score and description to citizen_reports (for Zero-Trust Civilian Portal)
-- Safe to run: uses IF NOT EXISTS / DO blocks for idempotency

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'wims' AND table_name = 'citizen_reports' AND column_name = 'trust_score'
  ) THEN
    ALTER TABLE wims.citizen_reports ADD COLUMN trust_score INTEGER DEFAULT 0;
    ALTER TABLE wims.citizen_reports ADD CONSTRAINT citizen_reports_trust_score_check
      CHECK (trust_score >= -100 AND trust_score <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'wims' AND table_name = 'citizen_reports' AND column_name = 'description'
  ) THEN
    ALTER TABLE wims.citizen_reports ADD COLUMN description TEXT;
  END IF;
END $$;
