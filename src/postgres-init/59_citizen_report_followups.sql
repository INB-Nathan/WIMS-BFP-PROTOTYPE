-- =============================================================================
-- Migration: 59_citizen_report_followups.sql
-- Purpose  : Issue #62 — civilian follow-up submissions for existing reports
--
-- Allows civilians to submit text-based follow-up information linked to their
-- existing citizen report via tracking/reference code. Follow-up rows are
-- persisted separately from full report appends (linked child reports).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS wims.citizen_report_followups (
    followup_id   SERIAL PRIMARY KEY,
    report_id     INTEGER NOT NULL
                      REFERENCES wims.citizen_reports(report_id)
                      ON DELETE CASCADE,
    followup_text TEXT NOT NULL
                      CHECK (char_length(followup_text) BETWEEN 1 AND 2000),
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_citizen_report_followups_report
    ON wims.citizen_report_followups (report_id);

CREATE INDEX IF NOT EXISTS idx_citizen_report_followups_created
    ON wims.citizen_report_followups (created_at ASC);

COMMENT ON TABLE wims.citizen_report_followups IS
    'Civilian text follow-ups linked to citizen_reports. One row per follow-up submission.';

COMMENT ON COLUMN wims.citizen_report_followups.followup_text IS
    'Free-text follow-up from the civilian, max 2000 chars.';

COMMIT;
