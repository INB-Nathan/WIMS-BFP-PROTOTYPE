-- One unpublished draft per source incident. Published history remains intact.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_information_emergencies_unpublished_source_incident
    ON wims.information_emergencies (promoted_from_incident_id)
    WHERE promoted_from_incident_id IS NOT NULL AND published = FALSE;

COMMIT;
