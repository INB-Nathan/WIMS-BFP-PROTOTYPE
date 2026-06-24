-- 71_operation_report_unique.sql
-- Enforce one-operation-per-civilian-report for the Operations Board.
-- Idempotent: YES for the index creation; deliberately fails if duplicates exist.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT report_id
        FROM wims.operation_citizen_reports
        GROUP BY report_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate operation_citizen_reports.report_id rows must be resolved before adding one-operation-per-report uniqueness';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_operation_citizen_reports_report_id
    ON wims.operation_citizen_reports (report_id);

COMMIT;
