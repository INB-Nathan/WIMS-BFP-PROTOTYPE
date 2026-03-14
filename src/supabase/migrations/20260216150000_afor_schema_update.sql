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
