-- =============================================================================
-- ARCHIVE: superseded / unused SQL consolidated 2026-03-22T19:24:02+08:00
-- Canonical DDL: src/postgres-init/01_wims_initial.sql
-- =============================================================================

-- =============================================================================
-- SOURCE: src/postgres-init/02_wims_schema.sql
-- =============================================================================
-- Thin compatibility layer: re-apply canonical DDL (idempotent) for environments
-- that run this as a second init step. \ir resolves relative to this file's directory.
\ir 01_wims_initial.sql


-- =============================================================================
-- SOURCE: src/postgres-init/03_seed_regions.sql
-- =============================================================================
-- Deprecated: merged into 03_seed_reference.sql — kept for external scripts that still reference this filename.
-- No-op:
SELECT 1;


-- =============================================================================
-- SOURCE: src/postgres-init/04_citizen_reports_columns.sql
-- =============================================================================
-- Deprecated: trust_score, description, and VERIFIED/validator CHECK are in 01_wims_initial.sql.
-- No-op for legacy bootstrap paths:
SELECT 1;


-- =============================================================================
-- SOURCE: src/postgres-init/05_add_national_analyst_role.sql
-- =============================================================================
-- Deprecated: NATIONAL_ANALYST and REGIONAL_ENCODER are in users_role_check in 01_wims_initial.sql.
-- No-op for legacy bootstrap paths:
SELECT 1;


-- =============================================================================
-- SOURCE: src/supabase/wims_schema.sql
-- =============================================================================
-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
-- Diff checklist vs canonical v2: see SCHEMA_MERGE_NOTES.md at repo root.
-- Executable DDL: src/postgres-init/01_wims_initial.sql

CREATE TABLE wims.data_import_batches (
  batch_id integer NOT NULL DEFAULT nextval('wims.data_import_batches_batch_id_seq'::regclass),
  region_id integer NOT NULL,
  uploaded_by uuid,
  upload_timestamp timestamp with time zone DEFAULT now(),
  record_count integer DEFAULT 0,
  batch_checksum_hash character varying,
  sync_status character varying DEFAULT 'PENDING'::character varying,
  CONSTRAINT data_import_batches_pkey PRIMARY KEY (batch_id),
  CONSTRAINT data_import_batches_region_id_fkey FOREIGN KEY (region_id) REFERENCES wims.ref_regions(region_id),
  CONSTRAINT data_import_batches_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES wims.users(user_id)
);
CREATE TABLE wims.fire_incidents (
  incident_id integer NOT NULL DEFAULT nextval('wims.fire_incidents_incident_id_seq'::regclass),
  import_batch_id integer,
  encoder_id uuid,
  region_id integer NOT NULL,
  verification_status character varying DEFAULT 'DRAFT'::character varying CHECK (verification_status::text = ANY (ARRAY['DRAFT'::character varying, 'PENDING'::character varying, 'VERIFIED'::character varying, 'REJECTED'::character varying]::text[])),
  is_archived boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT fire_incidents_pkey PRIMARY KEY (incident_id),
  CONSTRAINT fire_incidents_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES wims.data_import_batches(batch_id),
  CONSTRAINT fire_incidents_encoder_id_fkey FOREIGN KEY (encoder_id) REFERENCES wims.users(user_id),
  CONSTRAINT fire_incidents_region_id_fkey FOREIGN KEY (region_id) REFERENCES wims.ref_regions(region_id)
);
CREATE TABLE wims.incident_attachments (
  attachment_id integer NOT NULL DEFAULT nextval('wims.incident_attachments_attachment_id_seq'::regclass),
  incident_id integer NOT NULL,
  file_name character varying NOT NULL,
  storage_path text NOT NULL,
  mime_type character varying,
  file_hash_sha256 character,
  uploaded_by uuid,
  uploaded_at timestamp with time zone DEFAULT now(),
  CONSTRAINT incident_attachments_pkey PRIMARY KEY (attachment_id),
  CONSTRAINT incident_attachments_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES wims.fire_incidents(incident_id),
  CONSTRAINT incident_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES wims.users(user_id)
);
CREATE TABLE wims.incident_nonsensitive_details (
  detail_id integer NOT NULL DEFAULT nextval('wims.incident_nonsensitive_details_detail_id_seq'::regclass),
  incident_id integer NOT NULL,
  city_id integer,
  barangay character varying,
  distance_from_station_km numeric,
  notification_dt timestamp with time zone,
  alarm_level character varying,
  general_category character varying,
  sub_category character varying,
  specific_type character varying,
  occupancy_type character varying,
  estimated_damage_php numeric,
  civilian_injured integer DEFAULT 0,
  civilian_deaths integer DEFAULT 0,
  firefighter_injured integer DEFAULT 0,
  firefighter_deaths integer DEFAULT 0,
  families_affected integer DEFAULT 0,
  water_tankers_used integer DEFAULT 0,
  foam_liters_used numeric DEFAULT 0,
  breathing_apparatus_used integer DEFAULT 0,
  responder_type character varying,
  fire_origin character varying,
  extent_of_damage character varying,
  structures_affected integer DEFAULT 0,
  households_affected integer DEFAULT 0,
  individuals_affected integer DEFAULT 0,
  resources_deployed jsonb DEFAULT '{}'::jsonb,
  alarm_timeline jsonb DEFAULT '{}'::jsonb,
  problems_encountered jsonb DEFAULT '[]'::jsonb,
  recommendations text,
  barangay_id integer,
  fire_station_name text,
  total_response_time_minutes integer,
  total_gas_consumed_liters numeric,
  stage_of_fire character varying,
  extent_total_floor_area_sqm numeric,
  extent_total_land_area_hectares numeric,
  vehicles_affected integer,
  CONSTRAINT incident_nonsensitive_details_pkey PRIMARY KEY (detail_id),
  CONSTRAINT incident_nonsensitive_details_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES wims.fire_incidents(incident_id),
  CONSTRAINT incident_nonsensitive_details_city_id_fkey FOREIGN KEY (city_id) REFERENCES wims.ref_cities(city_id),
  CONSTRAINT incident_nonsensitive_details_barangay_id_fkey FOREIGN KEY (barangay_id) REFERENCES wims.ref_barangays(barangay_id)
);
CREATE TABLE wims.incident_sensitive_details (
  sensitive_id integer NOT NULL DEFAULT nextval('wims.incident_sensitive_details_sensitive_id_seq'::regclass),
  incident_id integer NOT NULL,
  street_address text,
  landmark text,
  caller_name character varying,
  caller_number character varying,
  narrative_report text,
  prepared_by_officer character varying,
  noted_by_officer character varying,
  disposition_status character varying,
  remarks text,
  encryption_iv character varying,
  receiver_name character varying,
  establishment_name character varying,
  owner_name character varying,
  occupant_name character varying,
  personnel_on_duty jsonb DEFAULT '{}'::jsonb,
  other_personnel jsonb DEFAULT '[]'::jsonb,
  casualty_details jsonb DEFAULT '[]'::jsonb,
  icp_location text,
  is_icp_present boolean,
  disposition text,
  disposition_prepared_by text,
  disposition_noted_by text,
  CONSTRAINT incident_sensitive_details_pkey PRIMARY KEY (sensitive_id),
  CONSTRAINT incident_sensitive_details_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES wims.fire_incidents(incident_id)
);
CREATE TABLE wims.incident_verification_history (
  history_id integer NOT NULL DEFAULT nextval('wims.incident_verification_history_history_id_seq'::regclass),
  incident_id integer NOT NULL,
  action_by_user_id uuid,
  previous_status character varying,
  new_status character varying,
  comments text,
  action_timestamp timestamp with time zone DEFAULT now(),
  CONSTRAINT incident_verification_history_pkey PRIMARY KEY (history_id),
  CONSTRAINT incident_verification_history_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES wims.fire_incidents(incident_id),
  CONSTRAINT incident_verification_history_action_by_user_id_fkey FOREIGN KEY (action_by_user_id) REFERENCES wims.users(user_id)
);
CREATE TABLE wims.involved_parties (
  party_id integer NOT NULL DEFAULT nextval('wims.involved_parties_party_id_seq'::regclass),
  incident_id integer NOT NULL,
  full_name text,
  involvement_type character varying,
  age integer,
  gender character varying,
  CONSTRAINT involved_parties_pkey PRIMARY KEY (party_id),
  CONSTRAINT involved_parties_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES wims.fire_incidents(incident_id)
);
CREATE TABLE wims.operational_challenges (
  challenge_id integer NOT NULL DEFAULT nextval('wims.operational_challenges_challenge_id_seq'::regclass),
  incident_id integer NOT NULL,
  problem_code character varying,
  remarks text,
  CONSTRAINT operational_challenges_pkey PRIMARY KEY (challenge_id),
  CONSTRAINT operational_challenges_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES wims.fire_incidents(incident_id)
);
CREATE TABLE wims.ref_barangays (
  barangay_id integer NOT NULL DEFAULT nextval('wims.ref_barangays_barangay_id_seq'::regclass),
  city_id integer NOT NULL,
  barangay_name text NOT NULL,
  CONSTRAINT ref_barangays_pkey PRIMARY KEY (barangay_id),
  CONSTRAINT ref_barangays_city_id_fkey FOREIGN KEY (city_id) REFERENCES wims.ref_cities(city_id)
);
CREATE TABLE wims.ref_cities (
  city_id integer NOT NULL DEFAULT nextval('wims.ref_cities_city_id_seq'::regclass),
  province_id integer NOT NULL,
  city_name text NOT NULL,
  zip_code character varying,
  is_capital boolean DEFAULT false,
  CONSTRAINT ref_cities_pkey PRIMARY KEY (city_id),
  CONSTRAINT ref_cities_province_id_fkey FOREIGN KEY (province_id) REFERENCES wims.ref_provinces(province_id)
);
CREATE TABLE wims.ref_provinces (
  province_id integer NOT NULL DEFAULT nextval('wims.ref_provinces_province_id_seq'::regclass),
  region_id integer NOT NULL,
  province_name text NOT NULL,
  CONSTRAINT ref_provinces_pkey PRIMARY KEY (province_id),
  CONSTRAINT ref_provinces_region_id_fkey FOREIGN KEY (region_id) REFERENCES wims.ref_regions(region_id)
);
CREATE TABLE wims.ref_regions (
  region_id integer NOT NULL DEFAULT nextval('wims.ref_regions_region_id_seq'::regclass),
  region_name text NOT NULL,
  region_code character varying NOT NULL UNIQUE,
  CONSTRAINT ref_regions_pkey PRIMARY KEY (region_id)
);
CREATE TABLE wims.regional_public_keys (
  key_id integer NOT NULL DEFAULT nextval('wims.regional_public_keys_key_id_seq'::regclass),
  region_id integer NOT NULL,
  public_key_pem text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  revoked_at timestamp with time zone,
  CONSTRAINT regional_public_keys_pkey PRIMARY KEY (key_id),
  CONSTRAINT regional_public_keys_region_id_fkey FOREIGN KEY (region_id) REFERENCES wims.ref_regions(region_id)
);
CREATE TABLE wims.responding_units (
  response_id integer NOT NULL DEFAULT nextval('wims.responding_units_response_id_seq'::regclass),
  incident_id integer NOT NULL,
  station_name character varying,
  engine_number character varying,
  responder_type character varying,
  dispatch_dt timestamp with time zone,
  arrival_dt timestamp with time zone,
  return_dt timestamp with time zone,
  CONSTRAINT responding_units_pkey PRIMARY KEY (response_id),
  CONSTRAINT responding_units_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES wims.fire_incidents(incident_id)
);
CREATE TABLE wims.security_threat_logs (
  log_id bigint NOT NULL DEFAULT nextval('wims.security_threat_logs_log_id_seq'::regclass),
  timestamp timestamp with time zone DEFAULT now(),
  source_ip character varying,
  destination_ip character varying,
  suricata_sid integer,
  severity_level character varying,
  raw_payload text,
  xai_narrative text,
  xai_confidence double precision,
  admin_action_taken text,
  reviewed_by uuid,
  CONSTRAINT security_threat_logs_pkey PRIMARY KEY (log_id),
  CONSTRAINT security_threat_logs_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES wims.users(user_id)
);
CREATE TABLE wims.system_audit_trails (
  audit_id bigint NOT NULL DEFAULT nextval('wims.system_audit_trails_audit_id_seq'::regclass),
  user_id uuid,
  action_type character varying,
  table_affected character varying,
  record_id integer,
  ip_address character varying,
  user_agent text,
  timestamp timestamp with time zone DEFAULT now(),
  CONSTRAINT system_audit_trails_pkey PRIMARY KEY (audit_id),
  CONSTRAINT system_audit_trails_user_id_fkey FOREIGN KEY (user_id) REFERENCES wims.users(user_id)
);
CREATE TABLE wims.users (
  user_id uuid NOT NULL,
  username character varying NOT NULL UNIQUE,
  role character varying NOT NULL CHECK (role::text = ANY (ARRAY['ENCODER'::character varying, 'VALIDATOR'::character varying, 'ANALYST'::character varying, 'ADMIN'::character varying, 'SYSTEM_ADMIN'::character varying]::text[])),
  assigned_region_id integer,
  is_active boolean DEFAULT true,
  mfa_enabled boolean DEFAULT false,
  last_login timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (user_id),
  CONSTRAINT users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT users_assigned_region_id_fkey FOREIGN KEY (assigned_region_id) REFERENCES wims.ref_regions(region_id)
);

-- =============================================================================
-- SOURCE: src/supabase/migrations/20260216000000_afor_schema.sql
-- =============================================================================
-- Migration: Add AFOR Fields to Incident Schema
-- Description: Adds new columns to incident_nonsensitive_details and incident_sensitive_details based on Proposed-New-AFOR_Nov-2025.xlsx

-- 1. Non-Sensitive Operational Details
ALTER TABLE wims.incident_nonsensitive_details
ADD COLUMN IF NOT EXISTS responder_type VARCHAR(50), -- First Responder / Augmenting
ADD COLUMN IF NOT EXISTS fire_origin VARCHAR(100), -- Area of Origin
ADD COLUMN IF NOT EXISTS extent_of_damage VARCHAR(100), -- Classification (e.g. Confined to Room)
ADD COLUMN IF NOT EXISTS structures_affected INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS households_affected INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS individuals_affected INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS resources_deployed JSONB DEFAULT '{}'::jsonb, -- Vehicles, Tools breakdown
ADD COLUMN IF NOT EXISTS alarm_timeline JSONB DEFAULT '{}'::jsonb, -- Alarm levels and times
ADD COLUMN IF NOT EXISTS problems_encountered JSONB DEFAULT '[]'::jsonb, -- List of checkboxes
ADD COLUMN IF NOT EXISTS recommendations TEXT;

-- 2. Sensitive Personal/Personnel Details
ALTER TABLE wims.incident_sensitive_details
ADD COLUMN IF NOT EXISTS receiver_name VARCHAR(100), -- Person who took the call
ADD COLUMN IF NOT EXISTS establishment_name VARCHAR(200),
ADD COLUMN IF NOT EXISTS owner_name VARCHAR(200), -- Main owner convenience field
ADD COLUMN IF NOT EXISTS occupant_name VARCHAR(200), -- If different from owner
ADD COLUMN IF NOT EXISTS personnel_on_duty JSONB DEFAULT '{}'::jsonb, -- Crew list
ADD COLUMN IF NOT EXISTS other_personnel JSONB DEFAULT '[]'::jsonb, -- Other BFP/Significant personalities
ADD COLUMN IF NOT EXISTS casualty_details JSONB DEFAULT '[]'::jsonb; -- Detailed list if not using involved_parties

-- 3. Comments/Documentation
COMMENT ON COLUMN wims.incident_nonsensitive_details.responder_type IS 'Role of the responding unit (First Responder or Augmenting)';
COMMENT ON COLUMN wims.incident_nonsensitive_details.resources_deployed IS 'JSON object detailing count of fire trucks, ambulances, tools used, etc.';
COMMENT ON COLUMN wims.incident_nonsensitive_details.alarm_timeline IS 'JSON object mapping alarm levels to timestamps';
COMMENT ON COLUMN wims.incident_nonsensitive_details.problems_encountered IS 'JSON array of strings citing issues faced during operation';

COMMENT ON COLUMN wims.incident_sensitive_details.personnel_on_duty IS 'JSON object listing crew: Engine Commander, Nozzleman, etc.';


-- =============================================================================
-- SOURCE: src/supabase/migrations/20260216000001_geo_schema.sql
-- =============================================================================
-- Migration: Add Reference Table for Barangays
-- Description: Creates wims.ref_barangays and links it to incidents.

-- 1. Create Reference Table
CREATE TABLE IF NOT EXISTS wims.ref_barangays (
    barangay_id SERIAL PRIMARY KEY,
    city_id INTEGER NOT NULL REFERENCES wims.ref_cities(city_id),
    barangay_name TEXT NOT NULL
);

-- 2. Add RLS Policies (Read-only for authenticated)
ALTER TABLE wims.ref_barangays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ref_barangays_select_auth" ON wims.ref_barangays
    FOR SELECT TO authenticated USING (true);

-- 3. Link to Incidents (Optional FK, falling back to text if needed, but better to strict link)
-- We previously had 'barangay' as VARCHAR(100). We will keep it for legacy/fallback 
-- but add barangay_id for structured data.
ALTER TABLE wims.incident_nonsensitive_details
ADD COLUMN IF NOT EXISTS barangay_id INTEGER REFERENCES wims.ref_barangays(barangay_id);

-- Optional: Index for performance
CREATE INDEX IF NOT EXISTS idx_ref_barangays_city_id ON wims.ref_barangays(city_id);


-- =============================================================================
-- SOURCE: src/supabase/migrations/20260216000002_fix_region_code.sql
-- =============================================================================
-- Migration: Fix Region Code Length
-- Description: Increases the length of wims.ref_regions.region_code to accommodate 'Region IV-A' (11 chars) etc.

ALTER TABLE wims.ref_regions
ALTER COLUMN region_code TYPE VARCHAR(20);


-- =============================================================================
-- SOURCE: src/supabase/migrations/20260216000003_nhq_users.sql
-- =============================================================================
-- Migration: Add NHQ Users to wims.users
-- Description: Links provided Auth UUIDs to wims.users with NHQ roles (NULL region).

-- Encoder: ac90c0e1-a5a6-4332-bab1-d817cc484243
INSERT INTO wims.users (user_id, username, role, assigned_region_id, is_active)
VALUES (
    'ac90c0e1-a5a6-4332-bab1-d817cc484243',
    'nhq_encoder',
    'ENCODER',
    NULL, -- NULL means NHQ / National Scope
    TRUE
)
ON CONFLICT (user_id) DO UPDATE
SET role = 'ENCODER', assigned_region_id = NULL;

-- Validator: 0231f88d-a873-46e2-91d5-8b48de9eb8d9
INSERT INTO wims.users (user_id, username, role, assigned_region_id, is_active)
VALUES (
    '0231f88d-a873-46e2-91d5-8b48de9eb8d9',
    'nhq_validator',
    'VALIDATOR',
    NULL, -- NULL means NHQ / National Scope
    TRUE
)
ON CONFLICT (user_id) DO UPDATE
SET role = 'VALIDATOR', assigned_region_id = NULL;


-- =============================================================================
-- SOURCE: src/supabase/migrations/20260216150000_afor_schema_update.sql
-- =============================================================================
-- Add new columns to incident_nonsensitive_details
ALTER TABLE wims.incident_nonsensitive_details
ADD COLUMN IF NOT EXISTS fire_station_name text,
ADD COLUMN IF NOT EXISTS total_response_time_minutes integer,
ADD COLUMN IF NOT EXISTS total_gas_consumed_liters numeric,
ADD COLUMN IF NOT EXISTS stage_of_fire character varying,
ADD COLUMN IF NOT EXISTS extent_total_floor_area_sqm numeric,
ADD COLUMN IF NOT EXISTS extent_total_land_area_hectares numeric,
ADD COLUMN IF NOT EXISTS vehicles_affected integer;

-- Add new columns to incident_sensitive_details
ALTER TABLE wims.incident_sensitive_details
ADD COLUMN IF NOT EXISTS icp_location text,
ADD COLUMN IF NOT EXISTS is_icp_present boolean,
ADD COLUMN IF NOT EXISTS disposition text, -- Section L
ADD COLUMN IF NOT EXISTS disposition_prepared_by text, -- Section L
ADD COLUMN IF NOT EXISTS disposition_noted_by text; -- Section L


-- =============================================================================
-- SOURCE: src/supabase/migrations/20260314000000_add_resolved_at_security_threat_logs.sql
-- =============================================================================
-- Add resolved_at to security_threat_logs for admin resolution tracking
ALTER TABLE wims.security_threat_logs ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;


-- =============================================================================
-- SOURCE: src/supabase/migrations/20260315000000_add_regional_encoder_role.sql
-- =============================================================================
-- Migration: Add REGIONAL_ENCODER role to wims.users
-- Description: Extends the role CHECK constraint to include REGIONAL_ENCODER for regional office access.

-- 1. Drop old constraint
ALTER TABLE wims.users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2. Add updated constraint with REGIONAL_ENCODER
ALTER TABLE wims.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('ENCODER', 'VALIDATOR', 'ANALYST', 'ADMIN', 'SYSTEM_ADMIN', 'REGIONAL_ENCODER'));

-- 3. Comment
COMMENT ON CONSTRAINT users_role_check ON wims.users IS 'Valid roles including REGIONAL_ENCODER for regional office data entry';


-- =============================================================================
-- SOURCE: src/supabase/migrations/20260318000000_add_national_analyst_role.sql
-- =============================================================================
-- Migration: Add NATIONAL_ANALYST role to wims.users
-- Description: Canonical analyst role for National Analyst Dashboard access.

ALTER TABLE wims.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE wims.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('ENCODER', 'VALIDATOR', 'ANALYST', 'NATIONAL_ANALYST', 'ADMIN', 'SYSTEM_ADMIN', 'REGIONAL_ENCODER'));


-- =============================================================================
-- SOURCE: src/supabase/seeds/02_geo_philippines.sql
-- =============================================================================
-- Geo Seed: Regions, Provinces, Cities, Barangays for Philippines (Partial/Representative)
-- Note: User requested "all regions and provinces and everything under them". 
-- Given the sheer volume (42k+ barangays), this seed includes ALL Regions and ALL Provinces, 
-- plus a VERY comprehensive list for NCR and major key cities to demonstrate the hierarchy.

-- 0. Cleanup Legacy/Test Data (to prevent hierarchy conflicts with new IDs)
--    We detach any existing incidents from old City IDs (< 1000) and delete old Provinces (< 100).
DO $$
BEGIN
    -- Detach incidents from legacy cities (if any)
    UPDATE wims.incident_nonsensitive_details SET city_id = NULL WHERE city_id < 1000;
    
    -- Delete legacy Cities (IDs 1-999)
    DELETE FROM wims.ref_cities WHERE city_id < 1000;
    
    -- Delete legacy Provinces (IDs 1-99)
    DELETE FROM wims.ref_provinces WHERE province_id < 100;
    
    -- Note: Regions 1 and 2 exist but will be updated below. 
    -- Region 2 (was Bicol) will become CAR. Incidents linked to Region 2 will effectively move to CAR.
END $$;


-- 1. Regions (All 17)
INSERT INTO wims.ref_regions (region_id, region_name, region_code) VALUES
(1, 'National Capital Region', 'NCR'),
(2, 'Cordillera Administrative Region', 'CAR'),
(3, 'Ilocos Region', 'Region I'),
(4, 'Cagayan Valley', 'Region II'),
(5, 'Central Luzon', 'Region III'),
(6, 'CALABARZON', 'Region IV-A'),
(7, 'MIMAROPA Region', 'Region IV-B'),
(8, 'Bicol Region', 'Region V'),
(9, 'Western Visayas', 'Region VI'),
(10, 'Central Visayas', 'Region VII'),
(11, 'Eastern Visayas', 'Region VIII'),
(12, 'Zamboanga Peninsula', 'Region IX'),
(13, 'Northern Mindanao', 'Region X'),
(14, 'Davao Region', 'Region XI'),
(15, 'SOCCSKSARGEN', 'Region XII'),
(16, 'Caraga', 'Region XIII'),
(17, 'Bangsamoro Autonomous Region in Muslim Mindanao', 'BARMM')
ON CONFLICT (region_id) DO UPDATE 
SET region_name = EXCLUDED.region_name, 
    region_code = EXCLUDED.region_code;


-- 2. Provinces (All 81+ + NCR Districts)
-- NCR (Special Districts acting as Provinces for hierarchy simplicity)
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(100, 1, 'Metro Manila 1st District (Manila)'),
(101, 1, 'Metro Manila 2nd District'),
(102, 1, 'Metro Manila 3rd District'),
(103, 1, 'Metro Manila 4th District')
ON CONFLICT (province_id) DO NOTHING;

-- CAR
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(201, 2, 'Abra'), (202, 2, 'Apayao'), (203, 2, 'Benguet'), (204, 2, 'Ifugao'), (205, 2, 'Kalinga'), (206, 2, 'Mountain Province')
ON CONFLICT (province_id) DO NOTHING;

-- Region I
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(301, 3, 'Ilocos Norte'), (302, 3, 'Ilocos Sur'), (303, 3, 'La Union'), (304, 3, 'Pangasinan')
ON CONFLICT (province_id) DO NOTHING;

-- Region II
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(401, 4, 'Batanes'), (402, 4, 'Cagayan'), (403, 4, 'Isabela'), (404, 4, 'Nueva Vizcaya'), (405, 4, 'Quirino')
ON CONFLICT (province_id) DO NOTHING;

-- Region III
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(501, 5, 'Aurora'), (502, 5, 'Bataan'), (503, 5, 'Bulacan'), (504, 5, 'Nueva Ecija'), (505, 5, 'Pampanga'), (506, 5, 'Tarlac'), (507, 5, 'Zambales')
ON CONFLICT (province_id) DO NOTHING;

-- Region IV-A
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(601, 6, 'Batangas'), (602, 6, 'Cavite'), (603, 6, 'Laguna'), (604, 6, 'Quezon'), (605, 6, 'Rizal')
ON CONFLICT (province_id) DO NOTHING;

-- Region IV-B
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(701, 7, 'Marinduque'), (702, 7, 'Occidental Mindoro'), (703, 7, 'Oriental Mindoro'), (704, 7, 'Palawan'), (705, 7, 'Romblon')
ON CONFLICT (province_id) DO NOTHING;

-- Region V
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(801, 8, 'Albay'), (802, 8, 'Camarines Norte'), (803, 8, 'Camarines Sur'), (804, 8, 'Catanduanes'), (805, 8, 'Masbate'), (806, 8, 'Sorsogon')
ON CONFLICT (province_id) DO NOTHING;

-- Region VI
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(901, 9, 'Aklan'), (902, 9, 'Antique'), (903, 9, 'Capiz'), (904, 9, 'Guimaras'), (905, 9, 'Iloilo'), (906, 9, 'Negros Occidental')
ON CONFLICT (province_id) DO NOTHING;

-- Region VII
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1001, 10, 'Bohol'), (1002, 10, 'Cebu'), (1003, 10, 'Negros Oriental'), (1004, 10, 'Siquijor')
ON CONFLICT (province_id) DO NOTHING;

-- Region VIII
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1101, 11, 'Biliran'), (1102, 11, 'Eastern Samar'), (1103, 11, 'Leyte'), (1104, 11, 'Northern Samar'), (1105, 11, 'Samar'), (1106, 11, 'Southern Leyte')
ON CONFLICT (province_id) DO NOTHING;

-- Region IX
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1201, 12, 'Zamboanga del Norte'), (1202, 12, 'Zamboanga del Sur'), (1203, 12, 'Zamboanga Sibugay')
ON CONFLICT (province_id) DO NOTHING;

-- Region X
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1301, 13, 'Bukidnon'), (1302, 13, 'Camiguin'), (1303, 13, 'Lanao del Norte'), (1304, 13, 'Misamis Occidental'), (1305, 13, 'Misamis Oriental')
ON CONFLICT (province_id) DO NOTHING;

-- Region XI
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1401, 14, 'Davao de Oro'), (1402, 14, 'Davao del Norte'), (1403, 14, 'Davao del Sur'), (1404, 14, 'Davao Occidental'), (1405, 14, 'Davao Oriental')
ON CONFLICT (province_id) DO NOTHING;

-- Region XII
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1501, 15, 'Cotabato'), (1502, 15, 'Sarangani'), (1503, 15, 'South Cotabato'), (1504, 15, 'Sultan Kudarat')
ON CONFLICT (province_id) DO NOTHING;

-- Region XIII
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1601, 16, 'Agusan del Norte'), (1602, 16, 'Agusan del Sur'), (1603, 16, 'Dinagat Islands'), (1604, 16, 'Surigao del Norte'), (1605, 16, 'Surigao del Sur')
ON CONFLICT (province_id) DO NOTHING;

-- BARMM
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1701, 17, 'Basilan'), (1702, 17, 'Lanao del Sur'), (1703, 17, 'Maguindanao del Norte'), (1704, 17, 'Maguindanao del Sur'), (1705, 17, 'Sulu'), (1706, 17, 'Tawi-Tawi')
ON CONFLICT (province_id) DO NOTHING;


-- 3. Cities (Representative List)
-- NCR Cities
INSERT INTO wims.ref_cities (city_id, province_id, city_name, is_capital) VALUES
(1001, 100, 'City of Manila', TRUE),
(1002, 101, 'Mandaluyong City', FALSE),
(1003, 101, 'Marikina City', FALSE),
(1004, 101, 'Pasig City', FALSE),
(1005, 101, 'Quezon City', FALSE),
(1006, 101, 'San Juan City', FALSE),
(1007, 102, 'Caloocan City', FALSE),
(1008, 102, 'Malabon City', FALSE),
(1009, 102, 'Navotas City', FALSE),
(1010, 102, 'Valenzuela City', FALSE),
(1011, 103, 'Las Piñas City', FALSE),
(1012, 103, 'Makati City', FALSE),
(1013, 103, 'Muntinlupa City', FALSE),
(1014, 103, 'Parañaque City', FALSE),
(1015, 103, 'Pasay City', FALSE),
(1016, 103, 'Taguig City', FALSE),
(1017, 103, 'Pateros', FALSE)
ON CONFLICT (city_id) DO NOTHING;

-- Key Provincial Cities
INSERT INTO wims.ref_cities (city_id, province_id, city_name, is_capital) VALUES
(2031, 203, 'Baguio City', TRUE), -- Benguet
(3011, 301, 'Laoag City', TRUE), -- Ilocos Norte
(4021, 402, 'Tuguegarao City', TRUE), -- Cagayan
(5051, 505, 'San Fernando (Pampanga)', TRUE), -- Pampanga
(5052, 505, 'Angeles City', FALSE),
(6021, 602, 'Cavite City', FALSE), -- Cavite
(6022, 602, 'Tagaytay City', FALSE),
(8011, 801, 'Legazpi City', TRUE), -- Albay
(9051, 905, 'Iloilo City', TRUE), -- Iloilo
(10021, 1002, 'Cebu City', TRUE), -- Cebu
(10022, 1002, 'Lapu-Lapu City', FALSE),
(14031, 1403, 'Davao City', TRUE), -- Davao del Sur
(12021, 1202, 'Zamboanga City', TRUE) -- Zamboanga del Sur
ON CONFLICT (city_id) DO NOTHING;

-- 4. Barangays (Representative Sample for select cities)

-- Quezon City (1005) - Partial
INSERT INTO wims.ref_barangays (city_id, barangay_name) VALUES
(1005, 'Alicia'), (1005, 'Bagong Pag-asa'), (1005, 'Bahay Toro'), (1005, 'Balingasa'), (1005, 'Bungad'), 
(1005, 'Damayan'), (1005, 'Del Monte'), (1005, 'Katipunan'), (1005, 'Lourdes'), (1005, 'Maharlika'), 
(1005, 'Mariblo'), (1005, 'Masambong'), (1005, 'NS Amoranto'), (1005, 'Nayong Kanluran'), (1005, 'Paang Bundok'), 
(1005, 'Pag-ibig sa Nayon'), (1005, 'Paltok'), (1005, 'Paraiso'), (1005, 'Phil-Am'), (1005, 'Project 6'), 
(1005, 'Ramon Magsaysay'), (1005, 'Saint Peter'), (1005, 'Salvacion'), (1005, 'San Antonio'), (1005, 'San Isidro Labrador'), 
(1005, 'San Jose'), (1005, 'Santa Cruz'), (1005, 'Santa Teresita'), (1005, 'Santo Cristo'), (1005, 'Santo Domingo'), 
(1005, 'Siena'), (1005, 'Talayan'), (1005, 'Vasra'), (1005, 'Veterans Village'), (1005, 'West Triangle'),
(1005, 'Batasan Hills'), (1005, 'Commonwealth'), (1005, 'Holy Spirit'), (1005, 'Payatas'), (1005, 'Bagong Silangan')
ON CONFLICT (barangay_id) DO NOTHING;

-- Manila (1001) - Example
INSERT INTO wims.ref_barangays (city_id, barangay_name) VALUES
(1001, 'Barangay 1'), (1001, 'Barangay 2'), (1001, 'Barangay 3'), (1001, 'Barangay 4'), (1001, 'Barangay 5'),
(1001, 'Binondo'), (1001, 'Ermita'), (1001, 'Intramuros'), (1001, 'Malate'), (1001, 'Paco'),
(1001, 'Pandacan'), (1001, 'Port Area'), (1001, 'Quiapo'), (1001, 'Sampaloc'), (1001, 'San Miguel'),
(1001, 'San Nicolas'), (1001, 'Santa Ana'), (1001, 'Santa Cruz'), (1001, 'Tondo I'), (1001, 'Tondo II')
ON CONFLICT (barangay_id) DO NOTHING;

-- Davao City (14031) - Example
INSERT INTO wims.ref_barangays (city_id, barangay_name) VALUES
(14031, 'Poblacion District'), (14031, 'Talomo District'), (14031, 'Agdao District'), (14031, 'Buhangin District'),
(14031, 'Bunawan District'), (14031, 'Paquibato District'), (14031, 'Baguio District'), (14031, 'Calinan District'),
(14031, 'Marilog District'), (14031, 'Toril District'), (14031, 'Tugbok District')
ON CONFLICT (barangay_id) DO NOTHING;

-- Cebu City (10021) - Example
INSERT INTO wims.ref_barangays (city_id, barangay_name) VALUES
(10021, 'Adlaon'), (10021, 'Agsungot'), (10021, 'Apas'), (10021, 'Babag'), (10021, 'Bacayan'),
(10021, 'Banilad'), (10021, 'Basak Pardo'), (10021, 'Basak San Nicolas'), (10021, 'Bonbon'), (10021, 'Budlaan'),
(10021, 'Buhisan'), (10021, 'Bulacao'), (10021, 'Buot-Taup'), (10021, 'Busay'), (10021, 'Calamba'),
(10021, 'Cambinocot'), (10021, 'Capitol Site'), (10021, 'Carreta'), (10021, 'Cogon Pardo'), (10021, 'Cogon Ramos')
ON CONFLICT (barangay_id) DO NOTHING;


-- =============================================================================
-- SOURCE: src/supabase/seeds/incident_updates_seed.sql
-- =============================================================================
-- =============================================================================
-- Incident Updates and New Seeds
-- Run this if you already have users and reference data in your DB
-- using the specific Validator and Encoder UUIDs.
-- =============================================================================

-- 1. Update existing incidents to match dashboard categories
UPDATE wims.incident_nonsensitive_details SET general_category = 'STRUCTURAL', specific_type = 'Residential' WHERE incident_id = 1001;
UPDATE wims.incident_nonsensitive_details SET general_category = 'STRUCTURAL', specific_type = 'Mercantile' WHERE incident_id = 1002;
UPDATE wims.incident_nonsensitive_details SET general_category = 'STRUCTURAL', specific_type = 'Mixed Occupancies' WHERE incident_id = 1003;
UPDATE wims.incident_nonsensitive_details SET general_category = 'NON_STRUCTURAL', specific_type = 'Rubbish Fire' WHERE incident_id = 1004;
UPDATE wims.incident_nonsensitive_details SET general_category = 'STRUCTURAL', specific_type = 'Single and Two Family Dwelling' WHERE incident_id = 1005;

-- 1.25 Insert Reference Data (Regions, Provinces, Cities) required for FK constraints
INSERT INTO wims.ref_regions (region_id, region_name, region_code) VALUES
(1, 'National Capital Region', 'NCR'),
(2, 'Bicol Region', 'Region V')
ON CONFLICT (region_id) DO NOTHING;

INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1, 1, 'Metro Manila'),
(2, 2, 'Albay'),
(3, 2, 'Camarines Sur')
ON CONFLICT (province_id) DO NOTHING;

INSERT INTO wims.ref_cities (city_id, province_id, city_name, zip_code, is_capital) VALUES
(1, 1, 'Quezon City', '1100', FALSE),
(2, 1, 'Manila', '1000', TRUE),
(3, 1, 'Makati City', '1200', FALSE),
(4, 2, 'Legazpi City', '4500', TRUE),
(5, 2, 'Tabaco City', '4511', FALSE),
(6, 3, 'Naga City', '4400', FALSE)
ON CONFLICT (city_id) DO NOTHING;

-- 1.5 Insert Data Import Batches (required for FK constraints)
-- If these ID's already exist, use ON CONFLICT DO NOTHING to avoid duplicate key errors.
INSERT INTO wims.data_import_batches (batch_id, region_id, uploaded_by, record_count, batch_checksum_hash, sync_status) VALUES
(101, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 5, 'sha256_dummy_hash_1', 'COMPLETED'),
(102, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 3, 'sha256_dummy_hash_2', 'PENDING'),
(103, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 10, 'sha256_dummy_hash_3', 'COMPLETED')
ON CONFLICT (batch_id) DO NOTHING;

-- 2. Insert new incidents (IDs 1006 to 1010)
-- Using the Encoder UUID: ac90c0e1-a5a6-4332-bab1-d817cc484243
INSERT INTO wims.fire_incidents (incident_id, import_batch_id, encoder_id, region_id, verification_status, is_archived) VALUES
(1006, 103, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1007, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1008, 102, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'PENDING', FALSE),
(1009, 103, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1010, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE);

INSERT INTO wims.incident_nonsensitive_details (incident_id, city_id, barangay, alarm_level, general_category, specific_type, civilian_injured, estimated_damage_php) VALUES
(1006, 3, 'Makati CBD', '1st Alarm', 'STRUCTURAL', 'Business', 0, 50000.00),
(1007, 1, 'EDSA', '2nd Alarm', 'VEHICULAR', 'Automobile', 1, 300000.00),
(1008, 2, 'Port Area', '3rd Alarm', 'VEHICULAR', 'Truck', 0, 1500000.00),
(1009, 3, 'Forbes Park', '1st Alarm', 'NON_STRUCTURAL', 'Grass Fire', 0, 5000.00),
(1010, 1, 'Diliman', 'Task Force Bravo', 'STRUCTURAL', 'Educational', 0, 5000000.00);

INSERT INTO wims.incident_sensitive_details (incident_id, caller_name, caller_number, street_address, narrative_report, disposition_status) VALUES
(1006, 'Lapu Lapu', '09224445555', 'Ayala Ave, Makati', 'Office building fire alarm...', 'Resolved'),
(1007, 'Gabriela S', '09235556666', 'EDSA, Quezon City', 'Car caught fire on highway...', 'Under Investigation'),
(1008, 'Antonio L', '09246667777', 'Pier 4, Port Area', 'Cargo truck engine fire...', 'Resolved'),
(1009, 'Melchora A', '09257778888', 'McKinley Rd, Forbes Park', 'Dry grass burning near wall...', 'Resolved'),
(1010, 'Apolinario M', '09268889999', 'UP Campus, Diliman', 'Laboratory chemicals reacted...', 'Resolved');

INSERT INTO wims.responding_units (incident_id, station_name, engine_number, responder_type, arrival_dt) VALUES
(1006, 'Makati Fire Station', 'E-789', 'BFP', NOW() - INTERVAL '5 hours'),
(1007, 'QC Fire Station', 'E-333', 'BFP', NOW() - INTERVAL '6 hours'),
(1008, 'Manila Fire Station', 'E-111', 'BFP', NOW() - INTERVAL '7 hours'),
(1009, 'Makati Fire Station', 'E-222', 'BFP', NOW() - INTERVAL '8 hours'),
(1010, 'Diliman Fire Station', 'E-444', 'BFP', NOW() - INTERVAL '9 hours');


-- =============================================================================
-- SOURCE: src/supabase/seeds/security_threat_logs_seed.sql
-- =============================================================================
-- Seed data for wims.security_threat_logs
-- This script populates the table with synthetic "Suricata-like" security events
-- and corresponding "AI" narratives for the prototype.

INSERT INTO wims.security_threat_logs (
    timestamp,
    source_ip,
    destination_ip,
    suricata_sid,
    severity_level,
    raw_payload,
    xai_narrative,
    xai_confidence,
    admin_action_taken,
    reviewed_by
) VALUES
-- 1. High Severity: SQL Injection Attempt
(
    NOW() - INTERVAL '2 hours',
    '192.168.1.105',
    '10.0.0.5',
    '2010935',
    'HIGH',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET WEB_SERVER Possible SQL Injection Attempt", "category": "Web Application Attack"}, "payload": "GET /login?user=admin%27+OR+1%3D1-- HTTP/1.1"}',
    'The model detected a classic SQL injection pattern in the URL parameters. The attacker is attempting to bypass authentication by injecting a tautology (1=1). This is a high-confidence attack signature.',
    0.95,
    NULL,
    NULL
),
-- 2. Critical Severity: Multiple Failed Logins (Brute Force)
(
    NOW() - INTERVAL '4 hours',
    '203.0.113.42',
    '10.0.0.5',
    2002911,
    'CRITICAL',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET SCAN Potential SSH Brute Force", "category": "Attempted Administrator Privilege Gain"}, "count": 50, "duration": 60}',
    'Unusual volume of authentication failures detected from a single external IP address within a short window. The behavior indicates a scripted brute-force attack targeting the SSH service.',
    0.98,
    NULL,
    NULL
),
-- 3. Low Severity: Port Scanning
(
    NOW() - INTERVAL '1 day',
    '192.168.1.50',
    '10.0.0.0/24',
    2100498,
    'LOW',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "GPL SCAN PING NMAP", "category": "Network Scan"}, "payload": "ICMP Echo Request"}',
    'Routine network scanning activity detected. The signature matches Nmap discovery probes. This is likely an internal reconnaissance or a misconfigured monitoring tool, but warrants low-level attention.',
    0.65,
    'IGNORED', -- Previously handled
    (SELECT user_id FROM wims.users WHERE role = 'SYSTEM_ADMIN' LIMIT 1) -- Assign to a sysadmin if exists, else NULL (might fail if no users)
),
-- 4. Medium Severity: XSS Attempt
(
    NOW() - INTERVAL '30 minutes',
    '172.16.0.23',
    '10.0.0.5',
    2019401,
    'MEDIUM',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET WEB_SERVER Possible XSS Attempt", "category": "Web Application Attack"}, "payload": "<script>alert(1)</script>"}',
    'The request body contains script tags typical of a Cross-Site Scripting (XSS) attack. The payload is simple, suggesting a probe or testing tool rather than a sophisticated exploit.',
    0.85,
    NULL,
    NULL
),
-- 5. Low Severity: Policy Violation (Cleartext credentials)
(
    NOW() - INTERVAL '12 hours',
    '192.168.1.12',
    '10.0.0.8',
    2002878,
    'LOW',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET POLICY Cleartext Password in HTTP Request", "category": "Policy Violation"}, "payload": "POST /api/auth HTTP/1.1 ... password=admin"}',
    'Cleartext credentials were observed on the wire. This violates security policy but does not necessarily indicate an active compromise. It requires configuration review of the client application.',
    0.99,
    NULL,
    NULL
),
-- 6. High Severity: Escalate Demo
(
    NOW() - INTERVAL '5 hours',
    '33.44.55.66',
    '10.0.0.5',
    2019402,
    'HIGH',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET EXPLOIT Possible CVE-2023-XXXX", "category": "Attempted Administrator Privilege Gain"}, "payload": "...malicious payload..."}',
    'Pattern matching newly published CVE in edge deployment. Immediate escalation required. Automated containment initiated.',
    0.91,
    NULL,
    NULL
),
-- 7. Low Severity: False Positive Demo
(
    NOW() - INTERVAL '6 hours',
    '10.0.0.100',
    '10.0.0.5',
    2100499,
    'LOW',
    '{"proto": "UDP", "event_type": "alert", "alert": {"signature": "ET MALWARE Suspicious DNS Query", "category": "A Network Trojan was detected"}, "payload": "DNS query for unknown.local"}',
    'Suspicious DNS query detected. However, upon further context analysis, this domain belongs to an internal logging service that recently updated its hostname structure. Likely benign.',
    0.45,
    NULL,
    NULL
),
-- 8. Medium Severity: Resolved Demo
(
    NOW() - INTERVAL '1 day',
    '203.0.113.88',
    '10.0.0.5',
    2002879,
    'MEDIUM',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET SCAN Directory Traversal Attempt", "category": "Web Application Attack"}, "payload": "GET /images/../../../../etc/passwd HTTP/1.1"}',
    'Classic directory traversal string in GET request. Filter blocked the request successfully, no data exfiltrated.',
    0.89,
    NULL,
    NULL
);

-- Note: The subquery for `reviewed_by` might return NULL if no SYSTEM_ADMIN exists yet, which is fine.


-- =============================================================================
-- SOURCE: src/supabase/seeds/wims_seed.sql
-- =============================================================================
-- =============================================================================
-- WIMS-BFP Seed Data Script
-- Purpose: Populate the 'wims' schema with initial reference data and test users/incidents.
-- Usage: Run this script in the Supabase SQL Editor after 'wims_schema.sql'.
-- =============================================================================

-- Disable RLS temporarily for seeding if running as a superuser/service_role to avoid policy checks blocking inserts.
-- However, since this script is likely run via SQL Editor (postgres role), we can just proceed.

-- 1. Reference Data (Regions, Provinces, Cities)

INSERT INTO wims.ref_regions (region_id, region_name, region_code) VALUES
(1, 'National Capital Region', 'NCR'),
(2, 'Bicol Region', 'Region V');

INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1, 1, 'Metro Manila'),
(2, 2, 'Albay'),
(3, 2, 'Camarines Sur');

INSERT INTO wims.ref_cities (city_id, province_id, city_name, zip_code, is_capital) VALUES
-- NCR Cities
(1, 1, 'Quezon City', '1100', FALSE),
(2, 1, 'Manila', '1000', TRUE),
(3, 1, 'Makati City', '1200', FALSE),
-- Region V Cities
(4, 2, 'Legazpi City', '4500', TRUE),
(5, 2, 'Tabaco City', '4511', FALSE),
(6, 3, 'Naga City', '4400', FALSE);


-- 2. Test Users (Linked to auth.users)
-- We use explicit UUIDs so you can create matching auth users in Supabase Auth if needed,
-- or just use these for testing Foreign Key constraints.
-- Passwords are managed by Supabase Auth (GoTrue), not here.

-- Test User IDs:
-- Encoder (NCR):   ac90c0e1-a5a6-4332-bab1-d817cc484243
-- Validator (NCR): 0231f88d-a873-46e2-91d5-8b48de9eb8d9
-- Analyst (NHQ):   a0eebc99-9c0b-4ef8-bb6d-6bb9bd380003
-- Admin (NHQ):     a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004

-- NOTE: In a real Supabase Auth setup, you would create users via the Auth API or Dashboard.
-- For this seed script to work purely in SQL (without actual Auth users existing),
-- we might need to insert into auth.users IF we have permissions (service_role),
-- OR we just insert into wims.users and rely on relaxed FK constraints during dev (if auth schema is accessible).
-- Supabase SQL Editor usually has access to `auth` schema.

DO $$
BEGIN
    -- Try to insert into auth.users if possible (for local dev/testing functionality)
    -- This might fail on some hosted instances if `auth` schema is locked down, but usually fine in SQL Editor.
    -- We use a dummy email/password hash.
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN
        INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role)
        VALUES
            ('ac90c0e1-a5a6-4332-bab1-d817cc484243', 'encoder_ncr@bfp.gov.ph', 'dummyhash', NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW(), 'authenticated'),
            ('0231f88d-a873-46e2-91d5-8b48de9eb8d9', 'validator_ncr@bfp.gov.ph', 'dummyhash', NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW(), 'authenticated'),
            ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380003', 'analyst_nhq@bfp.gov.ph', 'dummyhash', NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW(), 'authenticated'),
            ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'admin_nhq@bfp.gov.ph', 'dummyhash', NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW(), 'authenticated')
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;


INSERT INTO wims.users (user_id, username, role, assigned_region_id, is_active) VALUES
('ac90c0e1-a5a6-4332-bab1-d817cc484243', 'encoder_ncr', 'ENCODER', 1, TRUE),
('0231f88d-a873-46e2-91d5-8b48de9eb8d9', 'validator_ncr', 'VALIDATOR', 1, TRUE),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380003', 'analyst_nhq', 'ANALYST', 1, TRUE),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'admin_nhq', 'ADMIN', 1, TRUE); -- Admin assigned to NCR but effectively global via role


-- 3. Incident Data

-- Data Import Batches (NCR)
INSERT INTO wims.data_import_batches (batch_id, region_id, uploaded_by, record_count, batch_checksum_hash, sync_status) VALUES
(101, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 5, 'sha256_dummy_hash_1', 'COMPLETED'),
(102, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 3, 'sha256_dummy_hash_2', 'PENDING'),
(103, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 10, 'sha256_dummy_hash_3', 'COMPLETED');

-- Fire Incidents
-- Statuses: DRAFT, PENDING, VERIFIED, REJECTED
INSERT INTO wims.fire_incidents (incident_id, import_batch_id, encoder_id, region_id, verification_status, is_archived) VALUES
(1001, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1002, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'PENDING', FALSE),
(1003, 102, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'DRAFT', FALSE),
(1004, 102, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'REJECTED', FALSE),
(1005, 103, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', TRUE), -- Archived
(1006, 103, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1007, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1008, 102, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'PENDING', FALSE),
(1009, 103, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1010, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE);

-- Incident Non-Sensitive Details
INSERT INTO wims.incident_nonsensitive_details (incident_id, city_id, barangay, alarm_level, general_category, specific_type, civilian_injured, estimated_damage_php) VALUES
(1001, 1, 'Batasan Hills', '1st Alarm', 'STRUCTURAL', 'Residential', 0, 50000.00),
(1002, 2, 'Tondo', '3rd Alarm', 'STRUCTURAL', 'Mercantile', 2, 1500000.00),
(1003, 3, 'Poblacion', 'Task Force Alpha', 'STRUCTURAL', 'Mixed Occupancies', 0, 0.00), -- Draft
(1004, 1, 'Cubao', '1st Alarm', 'NON_STRUCTURAL', 'Rubbish Fire', 0, 1000.00),
(1005, 2, 'Sampaloc', '2nd Alarm', 'STRUCTURAL', 'Single and Two Family Dwelling', 1, 200000.00),
(1006, 3, 'Makati CBD', '1st Alarm', 'STRUCTURAL', 'Business', 0, 50000.00),
(1007, 1, 'EDSA', '2nd Alarm', 'VEHICULAR', 'Automobile', 1, 300000.00),
(1008, 2, 'Port Area', '3rd Alarm', 'VEHICULAR', 'Truck', 0, 1500000.00),
(1009, 3, 'Forbes Park', '1st Alarm', 'NON_STRUCTURAL', 'Grass Fire', 0, 5000.00),
(1010, 1, 'Diliman', 'Task Force Bravo', 'STRUCTURAL', 'Educational', 0, 5000000.00);


-- Incident Sensitive Details (PII)
-- Note: In real app, these might be encrypted client-side. Here plain text for seed.
INSERT INTO wims.incident_sensitive_details (incident_id, caller_name, caller_number, street_address, narrative_report, disposition_status) VALUES
(1001, 'Juan Dela Cruz', '09171234567', 'Lot 1 Blk 2, Batasan Hills', 'Fire started at kitchen...', 'Resolved'),
(1002, 'Maria Clara', '09187654321', '123 Rizal Ave, Tondo', 'Suspected electrical overload...', 'Under Investigation'),
(1003, 'Jose Rizal', '09190000000', '456 JP Rizal St, Makati', 'Smoke verified, false alarm...', 'Draft Assessment'),
(1004, 'Andres B', '09201112222', 'Aurora Blvd, Cubao', 'Small rubbish fire near mrt...', 'Rejected'),
(1005, 'Emilio A', '09213334444', '789 España Blvd, Sampaloc', 'Old house fire...', 'Resolved'),
(1006, 'Lapu Lapu', '09224445555', 'Ayala Ave, Makati', 'Office building fire alarm...', 'Resolved'),
(1007, 'Gabriela S', '09235556666', 'EDSA, Quezon City', 'Car caught fire on highway...', 'Under Investigation'),
(1008, 'Antonio L', '09246667777', 'Pier 4, Port Area', 'Cargo truck engine fire...', 'Resolved'),
(1009, 'Melchora A', '09257778888', 'McKinley Rd, Forbes Park', 'Dry grass burning near wall...', 'Resolved'),
(1010, 'Apolinario M', '09268889999', 'UP Campus, Diliman', 'Laboratory chemicals reacted...', 'Resolved');


-- Involved Parties & Responding Units
INSERT INTO wims.involved_parties (incident_id, full_name, involvement_type, age, gender) VALUES
(1001, 'Pedro Penduko', 'OWNER', 45, 'MALE'),
(1002, 'Sisa Crazy', 'VICTIM', 30, 'FEMALE');

INSERT INTO wims.responding_units (incident_id, station_name, engine_number, responder_type, arrival_dt) VALUES
(1001, 'Batasan Fire Station', 'E-123', 'BFP', NOW() - INTERVAL '1 hour'),
(1002, 'Tondo Fire Station', 'E-456', 'BFP', NOW() - INTERVAL '2 hours'),
(1006, 'Makati Fire Station', 'E-789', 'BFP', NOW() - INTERVAL '5 hours'),
(1007, 'QC Fire Station', 'E-333', 'BFP', NOW() - INTERVAL '6 hours'),
(1008, 'Manila Fire Station', 'E-111', 'BFP', NOW() - INTERVAL '7 hours'),
(1009, 'Makati Fire Station', 'E-222', 'BFP', NOW() - INTERVAL '8 hours'),
(1010, 'Diliman Fire Station', 'E-444', 'BFP', NOW() - INTERVAL '9 hours');


-- 4. Logs & Audit Trails

-- Security Threat Logs (Suricata-style)
INSERT INTO wims.security_threat_logs (timestamp, source_ip, destination_ip, suricata_sid, severity_level, raw_payload, xai_narrative, xai_confidence) VALUES
(NOW() - INTERVAL '5 minutes', '192.168.1.100', '10.0.0.5', 2001219, 'Medium', 'GET /admin/login HTTP/1.1...', 'Potential brute force attempt detected.', 0.85),
(NOW() - INTERVAL '10 minutes', '45.33.22.11', '10.0.0.5', 2100498, 'High', 'SELECT * FROM users...', 'SQL Injection pattern matched in query param.', 0.98),
(NOW() - INTERVAL '1 hour', '192.168.1.105', '10.0.0.5', 2012345, 'Low', 'PING request...', 'ICMP Echo Request.', 0.20),
(NOW() - INTERVAL '2 hours', '172.16.0.4', '10.0.0.5', 2023456, 'Medium', 'POST /upload.php...', 'Suspicious file upload signature.', 0.75),
(NOW() - INTERVAL '1 day', '10.0.0.2', '10.0.0.5', 2000001, 'Low', 'Internal extensive scan...', 'Likely internal vulnerability scanner.', 0.10);


-- System Audit Trails
INSERT INTO wims.system_audit_trails (user_id, action_type, table_affected, record_id, ip_address, user_agent, timestamp) VALUES
('ac90c0e1-a5a6-4332-bab1-d817cc484243', 'LOGIN', 'auth', NULL, '192.168.1.50', 'Mozilla/5.0...', NOW() - INTERVAL '3 hours'),
('ac90c0e1-a5a6-4332-bab1-d817cc484243', 'INSERT', 'fire_incidents', 1001, '192.168.1.50', 'Mozilla/5.0...', NOW() - INTERVAL '2 hours'),
('0231f88d-a873-46e2-91d5-8b48de9eb8d9', 'LOGIN', 'auth', NULL, '192.168.1.51', 'Mozilla/5.0...', NOW() - INTERVAL '1 hour'),
('0231f88d-a873-46e2-91d5-8b48de9eb8d9', 'UPDATE', 'fire_incidents', 1001, '192.168.1.51', 'Mozilla/5.0...', NOW() - INTERVAL '50 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'LOGIN', 'auth', NULL, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '10 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'INSERT', 'fire_incidents', 1006, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '9 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'INSERT', 'fire_incidents', 1007, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '8 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'INSERT', 'fire_incidents', 1008, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '7 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'INSERT', 'fire_incidents', 1009, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '6 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'INSERT', 'fire_incidents', 1010, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '5 minutes');


