BEGIN;

DROP RULE IF EXISTS no_update_verified_nsd ON wims.incident_nonsensitive_details;
CREATE RULE no_update_verified_nsd AS
    ON UPDATE TO wims.incident_nonsensitive_details
    WHERE (
        EXISTS (
            SELECT 1 FROM wims.fire_incidents fi
            WHERE fi.incident_id = OLD.incident_id
              AND fi.verification_status = 'VERIFIED'
        )
    )
    DO INSTEAD NOTHING;

DROP RULE IF EXISTS no_delete_verified_nsd ON wims.incident_nonsensitive_details;
CREATE RULE no_delete_verified_nsd AS
    ON DELETE TO wims.incident_nonsensitive_details
    WHERE (
        EXISTS (
            SELECT 1 FROM wims.fire_incidents fi
            WHERE fi.incident_id = OLD.incident_id
              AND fi.verification_status = 'VERIFIED'
        )
    )
    DO INSTEAD NOTHING;

COMMIT;