-- 07_wildland_afor.sql
-- Dependencies: 04_import_incidents.sql, 06_incident_details.sql
-- Idempotent: YES

BEGIN;

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
  caller_transmitted_by TEXT,
  caller_office_address TEXT,
  call_received_by_personnel TEXT,
  engine_dispatched TEXT,
  incident_location_description TEXT,
  distance_to_fire_station_km NUMERIC(12, 2),
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
  weather JSONB DEFAULT '{}'::jsonb,
  fire_behavior JSONB DEFAULT '{}'::jsonb,
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
      'fire', 'agricultural land fire', 'brush fire', 'forest fire',
      'grassland fire', 'grazing land fire', 'mineral land fire', 'peatland fire'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_incident_wildland_afor_created ON wims.incident_wildland_afor (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_wildland_afor_source ON wims.incident_wildland_afor (source);

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
      '1st Alarm','2nd Alarm','3rd Alarm','4th Alarm',
      'Task Force Alpha','Task Force Bravo','General Alarm',
      'Ongoing','Fire Out','Fire Under Control',
      'Fire Out Upon Arrival','Fire Under Investigation',
      'Late Reported','Unresponded','No Firefighting Conducted'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_wildland_afor_alarm_parent ON wims.wildland_afor_alarm_statuses (incident_wildland_afor_id, sort_order);

CREATE TABLE IF NOT EXISTS wims.wildland_afor_assistance_rows (
  wildland_afor_assistance_row_id SERIAL PRIMARY KEY,
  incident_wildland_afor_id INTEGER NOT NULL REFERENCES wims.incident_wildland_afor(incident_wildland_afor_id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  organization_or_unit TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wildland_afor_assistance_parent ON wims.wildland_afor_assistance_rows (incident_wildland_afor_id, sort_order);

COMMIT;
