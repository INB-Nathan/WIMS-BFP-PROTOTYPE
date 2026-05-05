BEGIN;

ALTER TABLE wims.incident_verification_history
    ADD COLUMN IF NOT EXISTS old_data_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS new_data_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS corrected_fields TEXT[];

COMMENT ON COLUMN wims.incident_verification_history.old_data_hash IS
    'data_hash of fire_incidents before this correction was applied';
COMMENT ON COLUMN wims.incident_verification_history.new_data_hash IS
    'data_hash of fire_incidents after this correction was applied';
COMMENT ON COLUMN wims.incident_verification_history.corrected_fields IS
    'Array of field names changed in this correction';

COMMIT;