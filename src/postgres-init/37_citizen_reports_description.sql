-- 37_citizen_reports_description.sql
-- Adds a description TEXT column to wims.citizen_reports for free-text append notes from citizens.
-- This is a nullable text field with no length limit, allowing citizens to provide
-- additional narrative context beyond the structured category/sub_category fields.

BEGIN;

ALTER TABLE wims.citizen_reports
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMIT;
