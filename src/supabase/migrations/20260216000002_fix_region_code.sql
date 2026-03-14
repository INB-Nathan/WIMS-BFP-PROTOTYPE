-- Migration: Fix Region Code Length
-- Description: Increases the length of wims.ref_regions.region_code to accommodate 'Region IV-A' (11 chars) etc.

ALTER TABLE wims.ref_regions
ALTER COLUMN region_code TYPE VARCHAR(20);
