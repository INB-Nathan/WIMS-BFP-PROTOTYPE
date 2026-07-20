-- 99_citizen_report_geoip_reporter_envelope.sql
-- Coarse GeoIP evidence and encrypted reporter-identity snapshot parity for
-- Alembic revision 0029.
-- Dependencies: 05_citizen_reports.sql, PostGIS extension from 00_extensions.sql
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.citizen_reports
    ADD COLUMN IF NOT EXISTS ip_geo_city TEXT,
    ADD COLUMN IF NOT EXISTS ip_geo_province TEXT,
    ADD COLUMN IF NOT EXISTS ip_geo_centroid geography(Point, 4326),
    ADD COLUMN IF NOT EXISTS ip_geo_accuracy_m INTEGER,
    ADD COLUMN IF NOT EXISTS ip_geo_provider TEXT,
    ADD COLUMN IF NOT EXISTS ip_geo_lookup_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reporter_pii_blob_enc TEXT,
    ADD COLUMN IF NOT EXISTS reporter_encryption_iv TEXT,
    ADD COLUMN IF NOT EXISTS reporter_crypto_provider VARCHAR(64),
    ADD COLUMN IF NOT EXISTS reporter_key_version INTEGER,
    ADD COLUMN IF NOT EXISTS reporter_kms_key_name TEXT;

COMMENT ON COLUMN wims.citizen_reports.ip_geo_city IS
    'GeoIP-derived city or municipality label; coarse evidence only.';
COMMENT ON COLUMN wims.citizen_reports.ip_geo_province IS
    'GeoIP-derived province or region label; coarse evidence only.';
COMMENT ON COLUMN wims.citizen_reports.ip_geo_centroid IS
    'Approximate city or municipality centroid; never an exact client location.';
COMMENT ON COLUMN wims.citizen_reports.ip_geo_accuracy_m IS
    'Provider-reported accuracy radius in metres for the coarse GeoIP centroid.';
COMMENT ON COLUMN wims.citizen_reports.ip_geo_provider IS
    'GeoIP database/provider identifier; raw client IP is never retained here.';
COMMENT ON COLUMN wims.citizen_reports.ip_geo_lookup_at IS
    'Timestamp when coarse GeoIP evidence was resolved at submission.';
COMMENT ON COLUMN wims.citizen_reports.reporter_pii_blob_enc IS
    'Encrypted immutable submission-time reporter identity snapshot.';
COMMENT ON COLUMN wims.citizen_reports.reporter_encryption_iv IS
    'AES-GCM nonce/IV for reporter_pii_blob_enc.';
COMMENT ON COLUMN wims.citizen_reports.reporter_crypto_provider IS
    'Crypto provider used for reporter_pii_blob_enc.';
COMMENT ON COLUMN wims.citizen_reports.reporter_key_version IS
    'Crypto key version used for reporter_pii_blob_enc.';
COMMENT ON COLUMN wims.citizen_reports.reporter_kms_key_name IS
    'KMS key name used for reporter_pii_blob_enc when applicable.';

COMMIT;
