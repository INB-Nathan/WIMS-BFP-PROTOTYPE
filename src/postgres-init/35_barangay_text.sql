-- 35_barangay_text.sql
-- Idempotent: YES
-- Adds free-text barangay column to incident_nonsensitive_details,
-- parallel to province_district and city_municipality text columns.
ALTER TABLE wims.incident_nonsensitive_details
  ADD COLUMN IF NOT EXISTS barangay TEXT;
