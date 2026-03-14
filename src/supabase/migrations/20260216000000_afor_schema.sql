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
