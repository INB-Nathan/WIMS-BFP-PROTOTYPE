"""Add coarse GeoIP evidence and encrypted reporter identity.

Revision ID: 0029
Revises: 0028
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0029"
down_revision: Union[str, None] = "0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_UPGRADE_SQL = """
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
"""

_DOWNGRADE_SQL = """
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM wims.citizen_reports
        WHERE reporter_pii_blob_enc IS NOT NULL
           OR reporter_encryption_iv IS NOT NULL
           OR reporter_crypto_provider IS NOT NULL
           OR reporter_key_version IS NOT NULL
           OR reporter_kms_key_name IS NOT NULL
           OR ip_geo_city IS NOT NULL
           OR ip_geo_province IS NOT NULL
           OR ip_geo_centroid IS NOT NULL
           OR ip_geo_accuracy_m IS NOT NULL
           OR ip_geo_provider IS NOT NULL
           OR ip_geo_lookup_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION
            'Migration 0029 downgrade blocked: export or remove live reporter/GeoIP evidence first';
    END IF;
END
$$;

ALTER TABLE wims.citizen_reports
    DROP COLUMN IF EXISTS reporter_kms_key_name,
    DROP COLUMN IF EXISTS reporter_key_version,
    DROP COLUMN IF EXISTS reporter_crypto_provider,
    DROP COLUMN IF EXISTS reporter_encryption_iv,
    DROP COLUMN IF EXISTS reporter_pii_blob_enc,
    DROP COLUMN IF EXISTS ip_geo_lookup_at,
    DROP COLUMN IF EXISTS ip_geo_provider,
    DROP COLUMN IF EXISTS ip_geo_accuracy_m,
    DROP COLUMN IF EXISTS ip_geo_centroid,
    DROP COLUMN IF EXISTS ip_geo_province,
    DROP COLUMN IF EXISTS ip_geo_city;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.execute(_DOWNGRADE_SQL)
