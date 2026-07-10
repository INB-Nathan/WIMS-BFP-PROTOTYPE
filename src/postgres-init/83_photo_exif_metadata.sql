-- 83_photo_exif_metadata.sql
-- Civilian Photo Enhancement Phase E — EXIF metadata columns.
-- Adds GPS coordinate, altitude, datetime original, and provenance
-- tracking columns to wims.report_photos for client-supplied EXIF data.
--
-- The client extracts EXIF before compression (OffscreenCanvas strips it)
-- and submits it as form fields. The server also independently extracts
-- EXIF from the binary and overwrites client values when available.
--
-- Dependencies: 82_civilian_report_photos.sql (table must exist)
--
-- Idempotent: YES (uses IF NOT EXISTS)

BEGIN;

-- EXIF GPS columns (latitude, longitude, altitude, datetime original)
ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS exif_gps_lat NUMERIC(10,7);
ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS exif_gps_lon NUMERIC(10,7);
ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS exif_gps_altitude NUMERIC;
ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS exif_datetime_original TIMESTAMPTZ;

-- Provenance tracking
ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS exif_data_source TEXT;

COMMENT ON COLUMN wims.report_photos.exif_gps_lat IS
  'EXIF GPS latitude (client-supplied or server-extracted, signed decimal degrees)';
COMMENT ON COLUMN wims.report_photos.exif_gps_lon IS
  'EXIF GPS longitude (client-supplied or server-extracted, signed decimal degrees)';
COMMENT ON COLUMN wims.report_photos.exif_gps_altitude IS
  'EXIF GPS altitude in meters (signed, negative = below sea level)';
COMMENT ON COLUMN wims.report_photos.exif_datetime_original IS
  'EXIF DateTimeOriginal as timestamptz';
COMMENT ON COLUMN wims.report_photos.exif_data_source IS
  'Source of EXIF data: NULL (none), server_extracted (from binary), or client_extracted (from form fields)';

COMMIT;
