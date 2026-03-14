-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

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