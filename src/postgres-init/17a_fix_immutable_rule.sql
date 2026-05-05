BEGIN;

-- Narrow no_update_verified to only block verification_status changes on VERIFIED rows.
-- The broad rule (blocks ALL updates) prevents /correct from updating data_hash.
-- This replacement rule only blocks attempts to change verification_status away from VERIFIED.

DROP RULE IF EXISTS no_update_verified ON wims.fire_incidents;
CREATE RULE no_update_verified AS
    ON UPDATE TO wims.fire_incidents
    WHERE (
        OLD.verification_status = 'VERIFIED'
        AND NEW.verification_status != 'VERIFIED'
    )
    DO INSTEAD NOTHING;

COMMENT ON RULE no_update_verified ON wims.fire_incidents IS
    'Blocks status changes away from VERIFIED at DB layer. '
    'Does not block data_hash or other field updates on VERIFIED rows. '
    'Application-layer /correct endpoint handles authorized content updates.';

COMMIT;