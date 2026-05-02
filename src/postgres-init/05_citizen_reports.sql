-- 05_citizen_reports.sql
-- Dependencies: 04_import_incidents.sql (fire_incidents exists)
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.citizen_reports (
  report_id SERIAL PRIMARY KEY,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  description TEXT,
  reporter_phone VARCHAR,
  is_sms_verified BOOLEAN DEFAULT FALSE,
  trust_score INTEGER DEFAULT 0 CHECK (trust_score >= -100 AND trust_score <= 100),
  status VARCHAR NOT NULL CHECK (status IN ('PENDING', 'VERIFIED', 'FALSE_ALARM', 'DUPLICATE')),
  incident_id INTEGER REFERENCES wims.fire_incidents(incident_id),
  validated_by UUID REFERENCES wims.users(user_id),
  verified_incident_id INTEGER REFERENCES wims.fire_incidents(incident_id),
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_verified_requires_validator CHECK (status != 'VERIFIED' OR validated_by IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_citizen_reports_location ON wims.citizen_reports USING GIST (location);

COMMIT;
