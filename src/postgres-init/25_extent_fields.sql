-- Migration 25: Add extent_description and extent_objects_count to incident_nonsensitive_details
-- Run this against existing instances:
--   docker exec -i wims-postgres psql -U postgres -d wims -c "ALTER TABLE wims.incident_nonsensitive_details ADD COLUMN IF NOT EXISTS extent_description TEXT, ADD COLUMN IF NOT EXISTS extent_objects_count INT;"

ALTER TABLE wims.incident_nonsensitive_details
    ADD COLUMN IF NOT EXISTS extent_description TEXT,
    ADD COLUMN IF NOT EXISTS extent_objects_count INT;
