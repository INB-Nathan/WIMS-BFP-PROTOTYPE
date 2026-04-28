-- 02_ref_geography.sql
-- Dependencies: 01_extensions_roles.sql (schema + roles exist)
-- Idempotent: YES

BEGIN;

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


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ref_provinces_region_name_unique'
  ) THEN
    ALTER TABLE wims.ref_provinces
      ADD CONSTRAINT ref_provinces_region_name_unique
      UNIQUE (region_id, province_name);
  END IF;
END $$;

COMMIT;
