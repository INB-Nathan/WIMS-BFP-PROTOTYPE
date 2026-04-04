-- WIMS initial schema — single source of truth for Docker / local bootstrap.
-- Idempotent: safe if applied more than once (e.g. Compose-mounted schema_v2.sql re-include).
-- Auth: Keycloak-linked wims.users (no auth.users). Geospatial: PostGIS geography.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- required for gen_random_uuid()

CREATE SCHEMA IF NOT EXISTS wims;

-- ─────────────────────────────────────────────────────────────────────────────
-- FRS Roles (must exist before any RLS policy TO clause references them)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE ROLE CIVILIAN_REPORTER;
CREATE ROLE REGIONAL_ENCODER;
CREATE ROLE NATIONAL_VALIDATOR;
CREATE ROLE NATIONAL_ANALYST;
CREATE ROLE SYSTEM_ADMIN;


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
      'CIVILIAN_REPORTER',
      'REGIONAL_ENCODER',
      'NATIONAL_VALIDATOR',
      'NATIONAL_ANALYST',
      'SYSTEM_ADMIN'
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
    verification_status IN ('DRAFT', 'PENDING', 'PENDING_VALIDATION', 'VERIFIED', 'REJECTED')
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
  caller_name VARCHAR,          -- legacy plaintext; set NULL for new writes (PII-bLOB IS authoritative)
  caller_number VARCHAR,         -- legacy plaintext; set NULL for new writes
  narrative_report TEXT,
  prepared_by_officer VARCHAR,
  noted_by_officer VARCHAR,
  disposition_status VARCHAR,
  remarks TEXT,
  encryption_iv VARCHAR,        -- base64-encoded 12-byte AES-GCM nonce; NOT NULL when pii_blob_enc IS NOT NULL
  pii_blob_enc TEXT,           -- base64-encoded AES-256-GCM ciphertext containing {caller_name, caller_number, owner_name, occupant_name}
  receiver_name VARCHAR,        -- NOT encrypted (public/internal)
  establishment_name VARCHAR,
  owner_name VARCHAR,           -- legacy plaintext; set NULL for new writes (pii_blob_enc IS authoritative)
  occupant_name VARCHAR,        -- legacy plaintext; set NULL for new writes
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

-- ─────────────────────────────────────────────────────────────────────────────
-- ARCHITECTURAL DECISION RECORD: BFP SECURITY OPERATIONS INTENT
-- Table: security_threat_logs (Suricata IDS Ingestion)
-- Scope: GLOBAL (Intentionally NOT region-filtered)
-- Justification: Cybersecurity threats are borderless. To defend the WIMS-BFP
-- network, SYSTEM_ADMIN (CRUD) and NATIONAL_ANALYST (Read-Only) require complete,
-- unfiltered visibility into all regional IDS logs to perform lateral movement
-- analysis and national threat correlation.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ---------------------------------------------------------------------------
-- WIMS RLS patch (regional isolation + least privilege)
-- Assumes app sets:
--   SET LOCAL wims.current_user_id = '<uuid>';
-- ---------------------------------------------------------------------------

-- 0) Safety helper to read current app user UUID from GUC
CREATE OR REPLACE FUNCTION wims.current_user_uuid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('wims.current_user_id', true), '')::uuid
$$;

-- 1) Helper: current WIMS role
CREATE OR REPLACE FUNCTION wims.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT u.role
  FROM wims.users u
  WHERE u.user_id = wims.current_user_uuid()
    AND u.is_active = TRUE
$$;

-- 2) Helper: current assigned region
CREATE OR REPLACE FUNCTION wims.current_user_region_id()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT u.assigned_region_id
  FROM wims.users u
  WHERE u.user_id = wims.current_user_uuid()
    AND u.is_active = TRUE
$$;
-- current_region_id() — thin alias for current_user_region_id() so callers
-- (analytics RLS policies) do not need to change
CREATE OR REPLACE FUNCTION wims.current_region_id()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT wims.current_user_region_id()
$$;


-- 3) Enable + force RLS on multi-tenant/sensitive tables
ALTER TABLE wims.users                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.users                          FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.data_import_batches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.data_import_batches            FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.fire_incidents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.fire_incidents                 FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.citizen_reports                ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.citizen_reports                FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.incident_nonsensitive_details  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_nonsensitive_details  FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.incident_sensitive_details     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_sensitive_details     FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.incident_verification_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_verification_history  FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.incident_attachments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_attachments           FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.involved_parties               ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.involved_parties               FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.operational_challenges         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.operational_challenges         FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.responding_units               ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.responding_units               FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.incident_wildland_afor         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.incident_wildland_afor         FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.wildland_afor_alarm_statuses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.wildland_afor_alarm_statuses   FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.wildland_afor_assistance_rows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.wildland_afor_assistance_rows  FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.security_threat_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.security_threat_logs           FORCE ROW LEVEL SECURITY;

ALTER TABLE wims.system_audit_trails            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.system_audit_trails            FORCE ROW LEVEL SECURITY;

-- 4) Users table policy (self row, admin full)
CREATE POLICY users_self_or_admin_select
ON wims.users
FOR SELECT
USING (
  user_id = wims.current_user_uuid()
  OR wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN')
);

CREATE POLICY users_self_update_or_admin
ON wims.users
FOR UPDATE
USING (
  user_id = wims.current_user_uuid()
  OR wims.current_user_role() IN ('SYSTEM_ADMIN')
)
WITH CHECK (
  user_id
  = wims.current_user_uuid()
  OR wims.current_user_role() IN ('SYSTEM_ADMIN')
);

-- Optional: only SYSTEM_ADMIN can insert/delete users
CREATE POLICY users_admin_insert
ON wims.users
FOR INSERT
WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

CREATE POLICY users_admin_delete
ON wims.users
FOR DELETE
USING (wims.current_user_role() = 'SYSTEM_ADMIN');

-- 5) Region-scoped parent tables
-- fire_incidents
CREATE POLICY fire_incidents_select
ON wims.fire_incidents
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_ANALYST')
  OR region_id = wims.current_user_region_id()
);

CREATE POLICY fire_incidents_insert
ON wims.fire_incidents
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN')
  OR region_id = wims.current_user_region_id()
);

CREATE POLICY fire_incidents_update
ON wims.fire_incidents
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN')
  OR region_id = wims.current_user_region_id()
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN')
  OR region_id = wims.current_user_region_id()
);

CREATE POLICY fire_incidents_delete
ON wims.fire_incidents
FOR DELETE
USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN'));

-- data_import_batches
-- Drop the broken batches_region_read (had deprecated ADMIN/ANALYST, wrongly region-locked SYSTEM_ADMIN/NATIONAL_ANALYST)
DROP POLICY IF EXISTS batches_region_read ON wims.data_import_batches;

-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT policies split by access scope
-- ─────────────────────────────────────────────────────────────────────────────

-- batches_read_regional: REGIONAL_ENCODER + NATIONAL_VALIDATOR — region-scoped via explicit users join
CREATE POLICY batches_read_regional
ON wims.data_import_batches
FOR SELECT
USING (
  wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  AND EXISTS (
    SELECT 1
    FROM wims.users u
    WHERE u.user_id = wims.current_user_uuid()
      AND u.assigned_region_id = wims.data_import_batches.region_id
      AND u.is_active = TRUE
  )
);

-- batches_read_global: NATIONAL_ANALYST + SYSTEM_ADMIN — unrestricted global SELECT
CREATE POLICY batches_read_global
ON wims.data_import_batches
FOR SELECT
USING (
  wims.current_user_role() IN ('NATIONAL_ANALYST', 'SYSTEM_ADMIN')
);

-- Drop the broken FOR ALL policy first
DROP POLICY IF EXISTS batches_region_write ON wims.data_import_batches;

-- ─────────────────────────────────────────────────────────────────────────────
-- batches_region_write: AIR-TIGHT INSERT/UPDATE/DELETE
-- Roles: REGIONAL_ENCODER, NATIONAL_VALIDATOR ONLY
-- Must join wims.users → assigned_region_id = batches.region_id
-- NATIONAL_ANALYST and CIVILIAN_REPORTER are mathematically excluded
-- SYSTEM_ADMIN gets a separate unrestricted policy (see below)
-- ─────────────────────────────────────────────────────────────────────────────

-- INSERT: WITH CHECK only (no existing row to evaluate)
CREATE POLICY batches_region_insert
ON wims.data_import_batches
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  AND EXISTS (
    SELECT 1
    FROM wims.users u
    WHERE u.user_id = wims.current_user_uuid()
      AND u.assigned_region_id = wims.data_import_batches.region_id
      AND u.is_active = TRUE
  )
);

-- UPDATE: USING determines visible rows; WITH CHECK restricts what you can set
CREATE POLICY batches_region_update
ON wims.data_import_batches
FOR UPDATE
USING (
  wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  AND EXISTS (
    SELECT 1
    FROM wims.users u
    WHERE u.user_id = wims.current_user_uuid()
      AND u.assigned_region_id = wims.data_import_batches.region_id
      AND u.is_active = TRUE
  )
)
WITH CHECK (
  wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  AND EXISTS (
    SELECT 1
    FROM wims.users u
    WHERE u.user_id = wims.current_user_uuid()
      AND u.assigned_region_id = wims.data_import_batches.region_id
      AND u.is_active = TRUE
  )
);

-- DELETE: USING = WITH CHECK (delete only rows you can see and have permission on)
CREATE POLICY batches_region_delete
ON wims.data_import_batches
FOR DELETE
USING (
  wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  AND EXISTS (
    SELECT 1
    FROM wims.users u
    WHERE u.user_id = wims.current_user_uuid()
      AND u.assigned_region_id = wims.data_import_batches.region_id
      AND u.is_active = TRUE
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SYSTEM_ADMIN: Unrestricted full CRUD on data_import_batches (bypasses region)
-- Applies to ALL operations (SELECT, INSERT, UPDATE, DELETE)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY batches_system_admin_all
ON wims.data_import_batches
FOR ALL
USING (wims.current_user_role() = 'SYSTEM_ADMIN')
WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

-- citizen_reports (via incident region when incident_id present)
CREATE POLICY citizen_reports_select
ON wims.citizen_reports
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_ANALYST')
  OR (
    incident_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM wims.fire_incidents fi
      WHERE fi.incident_id = wims.citizen_reports.incident_id
        AND fi.region_id = wims.current_user_region_id()
    )
  )
);

CREATE POLICY citizen_reports_write
ON wims.citizen_reports
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN')
  OR (
    incident_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM wims.fire_incidents fi
      WHERE fi.incident_id = wims.citizen_reports.incident_id
        AND fi.region_id = wims.current_user_region_id()
    )
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN')
  OR (
    incident_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM wims.fire_incidents fi
      WHERE fi.incident_id = wims.citizen_reports.incident_id
        AND fi.region_id = wims.current_user_region_id()
    )
  )
);

CREATE POLICY citizen_reports_insert
ON wims.citizen_reports
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN')
  OR (
    incident_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM wims.fire_incidents fi
      WHERE fi.incident_id = wims.citizen_reports.incident_id
        AND fi.region_id = wims.current_user_region_id()
    )
  )
);

CREATE POLICY citizen_reports_delete
ON wims.citizen_reports
FOR DELETE
USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN'));

-- 6) Child tables: incident_id FK → fire_incidents.region_id
-- Reusable pattern; split into per-operation policies to enforce read-only analysts.
--
-- Roles (consistent model across all child tables):
--   SELECT:  SYSTEM_ADMIN, ADMIN, NATIONAL_ANALYST, REGIONAL_ENCODER, VALIDATOR
--   INSERT / UPDATE / DELETE: SYSTEM_ADMIN, NATIONAL_ANALYST, REGIONAL_ENCODER, VALIDATOR
--   (ANALYST is read-only on all child tables; ADMIN is read-only on child records)

-- incident_nonsensitive_details — SELECT
CREATE POLICY incident_nonsensitive_details_region_select
ON wims.incident_nonsensitive_details
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- incident_nonsensitive_details — INSERT
CREATE POLICY incident_nonsensitive_details_region_insert
ON wims.incident_nonsensitive_details
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- incident_nonsensitive_details — UPDATE
CREATE POLICY incident_nonsensitive_details_region_update
ON wims.incident_nonsensitive_details
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- incident_nonsensitive_details — DELETE
CREATE POLICY incident_nonsensitive_details_region_delete
ON wims.incident_nonsensitive_details
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- incident_sensitive_details — SELECT
CREATE POLICY incident_sensitive_details_region_select
ON wims.incident_sensitive_details
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_sensitive_details.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- incident_sensitive_details — INSERT
CREATE POLICY incident_sensitive_details_region_insert
ON wims.incident_sensitive_details
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_sensitive_details.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- incident_sensitive_details — UPDATE
CREATE POLICY incident_sensitive_details_region_update
ON wims.incident_sensitive_details
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_sensitive_details.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_sensitive_details.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- incident_sensitive_details — DELETE
CREATE POLICY incident_sensitive_details_region_delete
ON wims.incident_sensitive_details
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_sensitive_details.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- 5) Remaining child tables: direct incident_id FK → fire_incidents.region_id
-- incident_attachments — SELECT
CREATE POLICY incident_attachments_region_select
ON wims.incident_attachments
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_attachments.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- incident_attachments — INSERT/UPDATE/DELETE
CREATE POLICY incident_attachments_region_write
ON wims.incident_attachments
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_attachments.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY incident_attachments_region_update
ON wims.incident_attachments
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_attachments.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_attachments.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY incident_attachments_region_delete
ON wims.incident_attachments
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_attachments.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- incident_verification_history — SELECT
CREATE POLICY incident_verification_history_region_select
ON wims.incident_verification_history
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_verification_history.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- incident_verification_history — INSERT/UPDATE/DELETE
CREATE POLICY incident_verification_history_region_insert
ON wims.incident_verification_history
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_verification_history.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY incident_verification_history_region_update
ON wims.incident_verification_history
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_verification_history.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_verification_history.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY incident_verification_history_region_delete
ON wims.incident_verification_history
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_verification_history.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- involved_parties — SELECT
CREATE POLICY involved_parties_region_select
ON wims.involved_parties
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.involved_parties.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- involved_parties — INSERT/UPDATE/DELETE
CREATE POLICY involved_parties_region_insert
ON wims.involved_parties
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.involved_parties.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY involved_parties_region_update
ON wims.involved_parties
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.involved_parties.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.involved_parties.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY involved_parties_region_delete
ON wims.involved_parties
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.involved_parties.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- operational_challenges — SELECT
CREATE POLICY operational_challenges_region_select
ON wims.operational_challenges
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.operational_challenges.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- operational_challenges — INSERT/UPDATE/DELETE
CREATE POLICY operational_challenges_region_insert
ON wims.operational_challenges
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.operational_challenges.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY operational_challenges_region_update
ON wims.operational_challenges
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.operational_challenges.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.operational_challenges.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY operational_challenges_region_delete
ON wims.operational_challenges
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.operational_challenges.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- responding_units — SELECT
CREATE POLICY responding_units_region_select
ON wims.responding_units
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.responding_units.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- responding_units — INSERT/UPDATE/DELETE
CREATE POLICY responding_units_region_insert
ON wims.responding_units
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.responding_units.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY responding_units_region_update
ON wims.responding_units
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.responding_units.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.responding_units.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY responding_units_region_delete
ON wims.responding_units
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.responding_units.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- 6) Wildland AFOR tables: two-level chain
--    child table → incident_wildland_afor → fire_incidents
-- incident_wildland_afor — SELECT
CREATE POLICY incident_wildland_afor_region_select
ON wims.incident_wildland_afor
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_wildland_afor.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- incident_wildland_afor — INSERT/UPDATE/DELETE
CREATE POLICY incident_wildland_afor_region_insert
ON wims.incident_wildland_afor
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_wildland_afor.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY incident_wildland_afor_region_update
ON wims.incident_wildland_afor
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_wildland_afor.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_wildland_afor.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY incident_wildland_afor_region_delete
ON wims.incident_wildland_afor
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_wildland_afor.incident_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- wildland_afor_alarm_statuses (via incident_wildland_afor_id → incident_wildland_afor → fire_incidents)
-- SELECT
CREATE POLICY wildland_afor_alarm_statuses_region_select
ON wims.wildland_afor_alarm_statuses
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_alarm_statuses.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- INSERT/UPDATE/DELETE
CREATE POLICY wildland_afor_alarm_statuses_region_insert
ON wims.wildland_afor_alarm_statuses
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_alarm_statuses.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY wildland_afor_alarm_statuses_region_update
ON wims.wildland_afor_alarm_statuses
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_alarm_statuses.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_alarm_statuses.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY wildland_afor_alarm_statuses_region_delete
ON wims.wildland_afor_alarm_statuses
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_alarm_statuses.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- wildland_afor_assistance_rows (via incident_wildland_afor_id → incident_wildland_afor → fire_incidents)
-- SELECT
CREATE POLICY wildland_afor_assistance_rows_region_select
ON wims.wildland_afor_assistance_rows
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_assistance_rows.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- INSERT/UPDATE/DELETE
CREATE POLICY wildland_afor_assistance_rows_region_insert
ON wims.wildland_afor_assistance_rows
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_assistance_rows.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY wildland_afor_assistance_rows_region_update
ON wims.wildland_afor_assistance_rows
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_assistance_rows.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_assistance_rows.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

CREATE POLICY wildland_afor_assistance_rows_region_delete
ON wims.wildland_afor_assistance_rows
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.incident_wildland_afor iwa
    JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
    WHERE iwa.incident_wildland_afor_id = wims.wildland_afor_assistance_rows.incident_wildland_afor_id
      AND fi.region_id = wims.current_user_region_id()
  )
);

-- 7) Security/audit tables
-- RLS: SELECT allowed for SYSTEM_ADMIN + NATIONAL_ANALYST (threat correlation)
--      INSERT/UPDATE/DELETE allowed for SYSTEM_ADMIN + NATIONAL_ANALYST (svc_suricata INGESTS here)
-- Note: svc_suricata account has role=NATIONAL_ANALYST and needs INSERT for eve.json ingestion.
CREATE POLICY security_logs_admin_only
ON wims.security_threat_logs
FOR ALL
USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST'))
WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST'));

CREATE POLICY audit_trails_read_admin_or_self
ON wims.system_audit_trails
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')
  OR user_id = wims.current_user_uuid()
);

CREATE POLICY audit_trails_insert_service
ON wims.system_audit_trails
FOR INSERT
WITH CHECK (TRUE);

-- 8) Lock down raw table privileges (important: RLS is not enough alone)
REVOKE ALL ON SCHEMA wims FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA wims FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA wims FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- FRS Roles (must exist before any RLS policy TO clause references them)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE ROLE wims_app WITH LOGIN NOCREATEROLE NOCREATEDB NOSUPERUSER NOREPLICATION;

-- Application role grants (RLS enforces security — grants provide minimum object access)
GRANT USAGE ON SCHEMA wims TO wims_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wims TO wims_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA wims TO wims_app;

-- Ensure future tables are also locked by default
ALTER DEFAULT PRIVILEGES IN SCHEMA wims REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA wims REVOKE ALL ON SEQUENCES FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- System service accounts (for Celery beat tasks that need RLS context)
-- ---------------------------------------------------------------------------

-- Suricata EVE ingestion service account (INGEST only — reads from IDS, writes
-- to security_threat_logs which requires NATIONAL_ANALYST role per RLS policy)
INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,  -- placeholder; no Keycloak integration needed
    'svc_suricata',
    'NATIONAL_ANALYST',
    TRUE
)
ON CONFLICT (user_id) DO NOTHING;

-- ----------------------------------------------------------------────────---
-- Analytics Read Model (denormalized for fast NATIONAL_ANALYST queries)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wims.analytics_incident_facts (
    incident_id       INTEGER PRIMARY KEY,          -- mirrors fire_incidents.incident_id
    region_id          INTEGER,                      -- mirrors fire_incidents.region_id
    location           GEOGRAPHY(POINT, 4326),       -- mirrored from fire_incidents.location
    notification_dt    TIMESTAMPTZ,                  -- mirrored from incident_nonsensitive_details
    notification_date  DATE,                         -- derived from notification_dt (partition-friendly)
    alarm_level        TEXT,
    general_category   TEXT,
    synced_at          TIMESTAMPTZ DEFAULT NOW()     -- last sync time
);

CREATE INDEX IF NOT EXISTS idx_aif_notification_date ON wims.analytics_incident_facts (notification_date);
CREATE INDEX IF NOT EXISTS idx_aif_region_id         ON wims.analytics_incident_facts (region_id);
CREATE INDEX IF NOT EXISTS idx_aif_alarm_level       ON wims.analytics_incident_facts (alarm_level);
CREATE INDEX IF NOT EXISTS idx_aif_general_category  ON wims.analytics_incident_facts (general_category);

ALTER TABLE wims.analytics_incident_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.analytics_incident_facts FORCE ROW LEVEL SECURITY;

-- NATIONAL_ANALYST: read-only access to analytics facts
CREATE POLICY aif_national_analyst_read ON wims.analytics_incident_facts
    FOR SELECT
    TO NATIONAL_ANALYST
    USING (true);

-- REGIONAL_ENCODER / NATIONAL_VALIDATOR: read-only filtered to their region
CREATE POLICY aif_regional_read ON wims.analytics_incident_facts
    FOR SELECT
    TO REGIONAL_ENCODER
    USING (region_id = wims.current_user_region_id());

CREATE POLICY aif_validator_read ON wims.analytics_incident_facts
    FOR SELECT
    TO NATIONAL_VALIDATOR
    USING (region_id = wims.current_user_region_id());

-- SYSTEM_ADMIN: full CRUD for maintenance
CREATE POLICY aif_system_admin_all ON wims.analytics_incident_facts
    FOR ALL
    TO SYSTEM_ADMIN
    USING (true);

-- App role (wims_app) needs INSERT/UPDATE to sync facts from incidents
GRANT INSERT, UPDATE ON wims.analytics_incident_facts TO wims_app;
