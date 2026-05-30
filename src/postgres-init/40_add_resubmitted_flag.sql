-- Add is_resubmitted flag so validators can identify re-submitted rejected incidents.
-- Set TRUE by the submit endpoint when an encoder resubmits a previously REJECTED incident.

ALTER TABLE wims.fire_incidents
  ADD COLUMN IF NOT EXISTS is_resubmitted BOOLEAN NOT NULL DEFAULT FALSE;
