-- WIMS Schema v2 — Tier 3 Constitution Compliant
-- Auth: Keycloak (no Supabase auth.users)
-- Geospatial: PostGIS with GEOGRAPHY(POINT, 4326)
-- Crowdsourced: citizen_reports table
-- Immutability: is_archived for soft deletes

CREATE SCHEMA IF NOT EXISTS wims;

CREATE EXTENSION IF NOT EXISTS postgis;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reference Tables (Geography hierarchy)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE wims.ref_regions (
  region_id SERIAL PRIMARY KEY,
  region_name TEXT NOT NULL,
  region_code VARCHAR NOT NULL UNIQUE
);

CREATE TABLE wims.ref_provinces (
  province_id SERIAL PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES wims.ref_regions(region_id),
  province_name TEXT NOT NULL
);

CREATE TABLE wims.ref_cities (
  city_id SERIAL PRIMARY KEY,
  province_id INTEGER NOT NULL REFERENCES wims.ref_provinces(province_id),
  city_name TEXT NOT NULL,
  zip_code VARCHAR,
  is_capital BOOLEAN DEFAULT FALSE
);

CREATE TABLE wims.ref_barangays (
  barangay_id SERIAL PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES wims.ref_cities(city_id),
  barangay_name TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Users (Keycloak identity linking — no auth.users)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE wims.users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_id UUID NOT NULL UNIQUE,
  username VARCHAR NOT NULL UNIQUE,
  role VARCHAR NOT NULL CHECK (role IN ('ENCODER', 'VALIDATOR', 'ANALYST', 'ADMIN', 'SYSTEM_ADMIN')),
  assigned_region_id INTEGER REFERENCES wims.ref_regions(region_id),
  is_active BOOLEAN DEFAULT TRUE,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Data Import
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE wims.data_import_batches (
  batch_id SERIAL PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES wims.ref_regions(region_id),
  uploaded_by UUID REFERENCES wims.users(user_id),
  upload_timestamp TIMESTAMPTZ DEFAULT now(),
  record_count INTEGER DEFAULT 0,
  batch_checksum_hash VARCHAR,
  sync_status VARCHAR DEFAULT 'PENDING'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Fire Incidents (PostGIS location, soft-delete via is_archived)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE wims.fire_incidents (
  incident_id SERIAL PRIMARY KEY,
  import_batch_id INTEGER REFERENCES wims.data_import_batches(batch_id),
  encoder_id UUID REFERENCES wims.users(user_id),
  region_id INTEGER NOT NULL REFERENCES wims.ref_regions(region_id),
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  verification_status VARCHAR DEFAULT 'DRAFT' CHECK (verification_status IN ('DRAFT', 'PENDING', 'VERIFIED', 'REJECTED')),
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_fire_incidents_location ON wims.fire_incidents USING GIST (location);

-- ─────────────────────────────────────────────────────────────────────────────
-- Citizen Reports (Crowdsourced Tier)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE wims.citizen_reports (
  report_id SERIAL PRIMARY KEY,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  reporter_phone VARCHAR,
  is_sms_verified BOOLEAN DEFAULT FALSE,
  status VARCHAR NOT NULL CHECK (status IN ('PENDING', 'VERIFIED', 'FALSE_ALARM', 'DUPLICATE')),
  incident_id INTEGER REFERENCES wims.fire_incidents(incident_id),
  validated_by UUID REFERENCES wims.users(user_id),
  verified_incident_id INTEGER REFERENCES wims.fire_incidents(incident_id),
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_verified_requires_validator CHECK (status != 'VERIFIED' OR validated_by IS NOT NULL)
);

CREATE INDEX idx_citizen_reports_location ON wims.citizen_reports USING GIST (location);

-- ─────────────────────────────────────────────────────────────────────────────
-- Incident Details (no string-based barangay hack — use barangay_id only)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE wims.incident_attachments (
  attachment_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  file_name VARCHAR NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type VARCHAR,
  file_hash_sha256 CHAR(64),
  uploaded_by UUID REFERENCES wims.users(user_id),
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE wims.incident_nonsensitive_details (
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

CREATE TABLE wims.incident_sensitive_details (
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
  disposition_noted_by TEXT
);

CREATE TABLE wims.incident_verification_history (
  history_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  action_by_user_id UUID REFERENCES wims.users(user_id),
  previous_status VARCHAR,
  new_status VARCHAR,
  comments TEXT,
  action_timestamp TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE wims.involved_parties (
  party_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  full_name TEXT,
  involvement_type VARCHAR,
  age INTEGER,
  gender VARCHAR
);

CREATE TABLE wims.operational_challenges (
  challenge_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  problem_code VARCHAR,
  remarks TEXT
);

CREATE TABLE wims.responding_units (
  response_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
  station_name VARCHAR,
  engine_number VARCHAR,
  responder_type VARCHAR,
  dispatch_dt TIMESTAMPTZ,
  arrival_dt TIMESTAMPTZ,
  return_dt TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Regional Keys & Audit
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE wims.regional_public_keys (
  key_id SERIAL PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES wims.ref_regions(region_id),
  public_key_pem TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE wims.security_threat_logs (
  log_id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT now(),
  source_ip VARCHAR,
  destination_ip VARCHAR,
  suricata_sid INTEGER CHECK (suricata_sid > 0),
  severity_level VARCHAR,
  raw_payload VARCHAR(65535),
  xai_narrative VARCHAR(10000),
  xai_confidence DOUBLE PRECISION,
  admin_action_taken TEXT,
  reviewed_by UUID REFERENCES wims.users(user_id)
);

CREATE TABLE wims.system_audit_trails (
  audit_id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES wims.users(user_id),
  action_type VARCHAR,
  table_affected VARCHAR,
  record_id INTEGER,
  ip_address VARCHAR,
  user_agent TEXT,
  timestamp TIMESTAMPTZ DEFAULT now()
);
