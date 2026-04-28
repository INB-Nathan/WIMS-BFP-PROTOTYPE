-- 06_incident_details.sql
-- Dependencies: 04_import_incidents.sql, 05_citizen_reports.sql
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.incident_attachments (
  attachment_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  file_name VARCHAR NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type VARCHAR,
  file_hash_sha256 CHAR(64),
  uploaded_by UUID REFERENCES wims.users(user_id),
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wims.incident_nonsensitive_details (
  detail_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  city_id INTEGER REFERENCES wims.ref_cities(city_id),
  barangay_id INTEGER REFERENCES wims.ref_barangays(barangay_id),
  distance_from_station_km NUMERIC,
  notification_dt TIMESTAMPTZ,
  alarm_level VARCHAR,
  general_category VARCHAR,
  sub_category VARCHAR,
  specific_type VARCHAR,
  occupancy_type VARCHAR,
  estimated_damage_php NUMERIC,
  civilian_injured INTEGER DEFAULT 0,
  civilian_deaths INTEGER DEFAULT 0,
  firefighter_injured INTEGER DEFAULT 0,
  firefighter_deaths INTEGER DEFAULT 0,
  families_affected INTEGER DEFAULT 0,
  water_tankers_used INTEGER DEFAULT 0,
  foam_liters_used NUMERIC DEFAULT 0,
  breathing_apparatus_used INTEGER DEFAULT 0,
  responder_type VARCHAR,
  fire_origin VARCHAR,
  extent_of_damage VARCHAR,
  structures_affected INTEGER DEFAULT 0,
  households_affected INTEGER DEFAULT 0,
  individuals_affected INTEGER DEFAULT 0,
  resources_deployed JSONB DEFAULT '{}'::jsonb,
  alarm_timeline JSONB DEFAULT '{}'::jsonb,
  problems_encountered JSONB DEFAULT '[]'::jsonb,
  recommendations TEXT,
  fire_station_name TEXT,
  total_response_time_minutes INTEGER,
  total_gas_consumed_liters NUMERIC,
  stage_of_fire VARCHAR,
  extent_total_floor_area_sqm NUMERIC,
  extent_total_land_area_hectares NUMERIC,
  vehicles_affected INTEGER
);

CREATE TABLE IF NOT EXISTS wims.incident_sensitive_details (
  sensitive_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  street_address TEXT,
  landmark TEXT,
  caller_name VARCHAR,
  caller_number VARCHAR,
  narrative_report TEXT,
  prepared_by_officer VARCHAR,
  noted_by_officer VARCHAR,
  disposition_status VARCHAR,
  remarks TEXT,
  encryption_iv VARCHAR,
  pii_blob_enc TEXT,
  receiver_name VARCHAR,
  establishment_name VARCHAR,
  owner_name VARCHAR,
  occupant_name VARCHAR,
  personnel_on_duty JSONB DEFAULT '{}'::jsonb,
  other_personnel JSONB DEFAULT '[]'::jsonb,
  casualty_details JSONB DEFAULT '[]'::jsonb,
  icp_location TEXT,
  is_icp_present BOOLEAN,
  disposition TEXT,
  disposition_prepared_by TEXT,
  disposition_noted_by TEXT,
  CONSTRAINT incident_sensitive_details_pii_blob_consistency
    CHECK (
      (pii_blob_enc IS NULL AND encryption_iv IS NULL)
      OR
      (pii_blob_enc IS NOT NULL AND encryption_iv IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS wims.incident_verification_history (
  history_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  action_by_user_id UUID REFERENCES wims.users(user_id),
  previous_status VARCHAR,
  new_status VARCHAR,
  comments TEXT,
  action_timestamp TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wims.involved_parties (
  party_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  full_name TEXT,
  involvement_type VARCHAR,
  age INTEGER,
  gender VARCHAR
);

CREATE TABLE IF NOT EXISTS wims.operational_challenges (
  challenge_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  problem_code VARCHAR,
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS wims.responding_units (
  response_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  station_name VARCHAR,
  engine_number VARCHAR,
  responder_type VARCHAR,
  dispatch_dt TIMESTAMPTZ,
  arrival_dt TIMESTAMPTZ,
  return_dt TIMESTAMPTZ
);

COMMIT;
