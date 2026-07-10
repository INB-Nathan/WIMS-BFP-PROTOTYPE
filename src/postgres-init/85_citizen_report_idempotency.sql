-- 85_citizen_report_idempotency.sql
-- Civilian Photo Enhancement Phase D — client_report_id for idempotent
-- report submission.
--
-- The client generates a UUID (crypto.randomUUID()) before submitting a
-- report. On crash recovery, the same client_report_id is sent again and
-- the atomic INSERT ... ON CONFLICT DO NOTHING RETURNING either inserts
-- fresh (returning the new report_id) or returns NULL (duplicate).
--
-- On the duplicate path, the route performs a safe SELECT on the existing
-- row (citizen_reports has permissive RLS for the ANONYMOUS role) and
-- returns 200 with the existing report_id instead of 201.
--
-- Dependencies: 84_photo_idempotency_key.sql
--
-- Idempotent: YES (uses IF NOT EXISTS)

BEGIN;

ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS client_report_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_citizen_reports_client_id
    ON wims.citizen_reports(client_report_id)
    WHERE client_report_id IS NOT NULL;

COMMENT ON COLUMN wims.citizen_reports.client_report_id IS
  'Client-generated UUID for idempotent retry. Unique only when non-null.';

COMMIT;
