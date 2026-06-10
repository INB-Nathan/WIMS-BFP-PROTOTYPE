-- 50_unique_security_alert.sql
-- M8d (#165): prevent duplicate DRAFT incidents for the same security alert
-- Dependencies: 34_security_incident.sql
-- Idempotent: YES

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fire_incidents_security_alert
    ON wims.fire_incidents (security_alert_id)
    WHERE security_alert_id IS NOT NULL;

COMMIT;
