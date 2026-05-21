-- 28_general_description_column.sql
-- Adds a direct text column for general_description_of_involved to
-- incident_nonsensitive_details so edits can be persisted reliably
-- without depending on the JSONB alarm_timeline._response path.

BEGIN;

ALTER TABLE wims.incident_nonsensitive_details
  ADD COLUMN IF NOT EXISTS general_description_of_involved TEXT;

COMMIT;
