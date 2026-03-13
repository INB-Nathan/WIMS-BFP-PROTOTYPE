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
