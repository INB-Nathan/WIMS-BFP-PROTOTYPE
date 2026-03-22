-- WIMS initial schema — single source of truth for Docker / local bootstrap.
-- Idempotent: safe if applied more than once (e.g. Compose-mounted schema_v2.sql re-include).
-- Auth: Keycloak-linked wims.users (no auth.users). Geospatial: PostGIS geography.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS wims;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reference geography
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wims.ref_regions (
  region_id SERIAL PRIMARY KEY,
  region_name TEXT NOT NULL,
  region_code VARCHAR NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS wims.ref_provinces (
  province_id SERIAL PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES wims.ref_regions(region_id),
  province_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wims.ref_cities (
  city_id SERIAL PRIMARY KEY,
  province_id INTEGER NOT NULL REFERENCES wims.ref_provinces(province_id),
  city_name TEXT NOT NULL,
  zip_code VARCHAR,
  is_capital BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS wims.ref_barangays (
  barangay_id SERIAL PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES wims.ref_cities(city_id),
  barangay_name TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Users (Keycloak)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wims.users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_id UUID NOT NULL UNIQUE,
  username VARCHAR NOT NULL UNIQUE,
  role VARCHAR NOT NULL,
  assigned_region_id INTEGER REFERENCES wims.ref_regions(region_id),
  is_active BOOLEAN DEFAULT TRUE,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT users_role_check CHECK (
    role IN (
      'ENCODER',
      'VALIDATOR',
      'ANALYST',
      'NATIONAL_ANALYST',
      'ADMIN',
      'SYSTEM_ADMIN',
      'REGIONAL_ENCODER'
    )
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Import / incidents
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wims.data_import_batches (
  batch_id SERIAL PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES wims.ref_regions(region_id),
  uploaded_by UUID REFERENCES wims.users(user_id),
  upload_timestamp TIMESTAMPTZ DEFAULT now(),
  record_count INTEGER DEFAULT 0,
  batch_checksum_hash VARCHAR,
  sync_status VARCHAR DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS wims.fire_incidents (
  incident_id SERIAL PRIMARY KEY,
  import_batch_id INTEGER REFERENCES wims.data_import_batches(batch_id),
  encoder_id UUID REFERENCES wims.users(user_id),
  region_id INTEGER NOT NULL REFERENCES wims.ref_regions(region_id),
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  verification_status VARCHAR DEFAULT 'DRAFT' CHECK (
    verification_status IN ('DRAFT', 'PENDING', 'VERIFIED', 'REJECTED')
  ),
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fire_incidents_location ON wims.fire_incidents USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_fire_incidents_region_created ON wims.fire_incidents (region_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Citizen reports
-- ─────────────────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────────────────
-- Incident details & related
-- ─────────────────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────────────────
-- Wildland AFOR (workbook: WILDLAND FIRE AFOR + Sheet1 type list)
-- One bundle per incident; repeating groups in child tables; JSONB for nested blobs.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wims.incident_wildland_afor (
  incident_wildland_afor_id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id) ON DELETE CASCADE,
  import_batch_id INTEGER REFERENCES wims.data_import_batches(batch_id),
  source VARCHAR NOT NULL,
  external_reference VARCHAR(255),
  call_received_at TIMESTAMPTZ,
  fire_started_at TIMESTAMPTZ,
  fire_arrival_at TIMESTAMPTZ,
  fire_controlled_at TIMESTAMPTZ,
  -- B. Caller/reporter (not location; see section C)
  caller_transmitted_by TEXT,
  caller_office_address TEXT,
  call_received_by_personnel TEXT,
  engine_dispatched TEXT,
  -- C. Location of incident & approx distance to FS
  incident_location_description TEXT,
  distance_to_fire_station_km NUMERIC(12, 2),
  -- D. Primary action only (no “additional action taken” rows on form)
  primary_action_taken TEXT,
  assistance_combined_summary TEXT,
  buildings_involved INTEGER,
  buildings_threatened INTEGER,
  ownership_and_property_notes TEXT,
  total_area_burned_display TEXT,
  total_area_burned_hectares NUMERIC(14, 4),
  wildland_fire_type TEXT,
  area_type_summary JSONB DEFAULT '{}'::jsonb,
  causes_and_ignition_factors JSONB DEFAULT '{}'::jsonb,
  suppression_factors JSONB DEFAULT '{}'::jsonb,
  -- M. Weather: include fuel_moisture, fire_danger_rating, air_temperature plus wind/RH etc.
  weather JSONB DEFAULT '{}'::jsonb,
  fire_behavior JSONB DEFAULT '{}'::jsonb,
  -- peso_losses JSON shape: { "pre_incident_value": {"property": n, "contents": n}, "losses": {"property": n, "contents": n} }
  peso_losses JSONB DEFAULT '{}'::jsonb,
  casualties JSONB DEFAULT '{}'::jsonb,
  narration TEXT,
  problems_encountered JSONB DEFAULT '[]'::jsonb,
  recommendations JSONB DEFAULT '[]'::jsonb,
  prepared_by TEXT,
  prepared_by_title TEXT,
  noted_by TEXT,
  noted_by_title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT incident_wildland_afor_incident_unique UNIQUE (incident_id),
  CONSTRAINT incident_wildland_afor_source_check CHECK (source IN ('AFOR_IMPORT', 'MANUAL')),
  CONSTRAINT incident_wildland_afor_fire_type_check CHECK (
    wildland_fire_type IS NULL
    OR lower(trim(wildland_fire_type)) IN (
      'fire',
      'agricultural land fire',
      'brush fire',
      'forest fire',
      'grassland fire',
      'grazing land fire',
      'mineral land fire',
      'peatland fire'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_incident_wildland_afor_created
  ON wims.incident_wildland_afor (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_wildland_afor_source
  ON wims.incident_wildland_afor (source);

CREATE TABLE IF NOT EXISTS wims.wildland_afor_alarm_statuses (
  wildland_afor_alarm_status_id SERIAL PRIMARY KEY,
  incident_wildland_afor_id INTEGER NOT NULL REFERENCES wims.incident_wildland_afor(incident_wildland_afor_id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  alarm_status TEXT NOT NULL,
  time_declared TEXT,
  ground_commander TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT wildland_afor_alarm_status_value_check CHECK (
    alarm_status IN (
      '1st Alarm',
      '2nd Alarm',
      '3rd Alarm',
      '4th Alarm',
      'Task Force Alpha',
      'Task Force Bravo',
      'General Alarm',
      'Ongoing',
      'Fire Out',
      'Fire Under Control',
      'Fire Out Upon Arrival',
      'Fire Under Investigation',
      'Late Reported',
      'Unresponded',
      'No Firefighting Conducted'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_wildland_afor_alarm_parent
  ON wims.wildland_afor_alarm_statuses (incident_wildland_afor_id, sort_order);

CREATE TABLE IF NOT EXISTS wims.wildland_afor_assistance_rows (
  wildland_afor_assistance_row_id SERIAL PRIMARY KEY,
  incident_wildland_afor_id INTEGER NOT NULL REFERENCES wims.incident_wildland_afor(incident_wildland_afor_id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  organization_or_unit TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wildland_afor_assistance_parent
  ON wims.wildland_afor_assistance_rows (incident_wildland_afor_id, sort_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- Regional keys & audit / security
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wims.regional_public_keys (
  key_id SERIAL PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES wims.ref_regions(region_id),
  public_key_pem TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wims.security_threat_logs (
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
  resolved_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES wims.users(user_id)
);

CREATE TABLE IF NOT EXISTS wims.system_audit_trails (
  audit_id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES wims.users(user_id),
  action_type VARCHAR,
  table_affected VARCHAR,
  record_id INTEGER,
  ip_address VARCHAR,
  user_agent TEXT,
  timestamp TIMESTAMPTZ DEFAULT now()
);
