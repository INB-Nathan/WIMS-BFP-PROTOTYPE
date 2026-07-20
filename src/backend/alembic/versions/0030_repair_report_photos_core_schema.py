"""Repair persistent report_photos tables created from the minimal 0003 fallback.

Revision ID: 0030
Revises: 0029
Create Date: 2026-07-20
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0030"
down_revision: Union[str, None] = "0029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CORE_COLUMNS = (
    "media_type",
    "file_extension",
    "image_width",
    "image_height",
    "file_size_bytes",
    "original_storage_path",
    "original_file_size_bytes",
    "original_sha256",
    "orig_encryption_iv",
    "orig_key_version",
    "orig_crypto_provider",
    "orig_kms_key_name",
    "sanitized_storage_path",
    "sanitized_file_size_bytes",
    "sanitized_sha256",
    "sanitized_encryption_iv",
    "sanitized_key_version",
    "sanitized_crypto_provider",
    "sanitized_kms_key_name",
    "sensitive_metadata_blob_enc",
    "metadata_encryption_iv",
    "metadata_key_version",
    "metadata_crypto_provider",
    "metadata_kms_key_name",
    "cleanup_status",
)


def upgrade() -> None:
    # Never invent encrypted evidence metadata for an occupied partial table.
    # The known affected production shape is empty; any occupied installation
    # requires an operator-led recovery from its actual artifact source.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM wims.report_photos LIMIT 1)
               AND EXISTS (
                   SELECT 1
                   FROM unnest(ARRAY[
                       'media_type', 'file_extension', 'image_width', 'image_height',
                       'file_size_bytes', 'original_storage_path',
                       'original_file_size_bytes', 'original_sha256',
                       'orig_encryption_iv', 'orig_key_version',
                       'orig_crypto_provider', 'orig_kms_key_name',
                       'sanitized_storage_path', 'sanitized_file_size_bytes',
                       'sanitized_sha256', 'sanitized_encryption_iv',
                       'sanitized_key_version', 'sanitized_crypto_provider',
                       'sanitized_kms_key_name', 'sensitive_metadata_blob_enc',
                       'metadata_encryption_iv', 'metadata_key_version',
                       'metadata_crypto_provider', 'metadata_kms_key_name',
                       'cleanup_status'
                   ]) AS required(column_name)
                   WHERE NOT EXISTS (
                       SELECT 1
                       FROM information_schema.columns existing
                       WHERE existing.table_schema = 'wims'
                         AND existing.table_name = 'report_photos'
                         AND existing.column_name = required.column_name
                   )
               )
            THEN
                RAISE EXCEPTION
                    'Cannot repair occupied partial wims.report_photos table automatically';
            END IF;
        END
        $$;
        """
    )
    op.execute(
        """
        ALTER TABLE wims.report_photos
            ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL
                CHECK (media_type IN ('image/jpeg', 'image/png')),
            ADD COLUMN IF NOT EXISTS file_extension TEXT NOT NULL
                CHECK (file_extension IN ('jpg', 'jpeg', 'png')),
            ADD COLUMN IF NOT EXISTS image_width INTEGER NOT NULL CHECK (image_width > 0),
            ADD COLUMN IF NOT EXISTS image_height INTEGER NOT NULL CHECK (image_height > 0),
            ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
            ADD COLUMN IF NOT EXISTS original_storage_path TEXT NOT NULL,
            ADD COLUMN IF NOT EXISTS original_file_size_bytes INTEGER NOT NULL
                CHECK (original_file_size_bytes >= 0),
            ADD COLUMN IF NOT EXISTS original_sha256 TEXT NOT NULL,
            ADD COLUMN IF NOT EXISTS orig_encryption_iv TEXT NOT NULL,
            ADD COLUMN IF NOT EXISTS orig_key_version INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS orig_crypto_provider TEXT NOT NULL DEFAULT 'env_aesgcm'
                CHECK (orig_crypto_provider IN ('env_aesgcm', 'openbao_transit')),
            ADD COLUMN IF NOT EXISTS orig_kms_key_name TEXT,
            ADD COLUMN IF NOT EXISTS sanitized_storage_path TEXT NOT NULL,
            ADD COLUMN IF NOT EXISTS sanitized_file_size_bytes INTEGER NOT NULL
                CHECK (sanitized_file_size_bytes >= 0),
            ADD COLUMN IF NOT EXISTS sanitized_sha256 TEXT NOT NULL,
            ADD COLUMN IF NOT EXISTS sanitized_encryption_iv TEXT NOT NULL,
            ADD COLUMN IF NOT EXISTS sanitized_key_version INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS sanitized_crypto_provider TEXT NOT NULL DEFAULT 'env_aesgcm'
                CHECK (sanitized_crypto_provider IN ('env_aesgcm', 'openbao_transit')),
            ADD COLUMN IF NOT EXISTS sanitized_kms_key_name TEXT,
            ADD COLUMN IF NOT EXISTS sensitive_metadata_blob_enc TEXT NOT NULL,
            ADD COLUMN IF NOT EXISTS metadata_encryption_iv TEXT NOT NULL,
            ADD COLUMN IF NOT EXISTS metadata_key_version INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS metadata_crypto_provider TEXT NOT NULL DEFAULT 'env_aesgcm'
                CHECK (metadata_crypto_provider IN ('env_aesgcm', 'openbao_transit')),
            ADD COLUMN IF NOT EXISTS metadata_kms_key_name TEXT,
            ADD COLUMN IF NOT EXISTS cleanup_status TEXT
                CHECK (cleanup_status IS NULL OR cleanup_status IN ('pending_cleanup', 'cleaned_up'))
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_report_photos_report ON wims.report_photos(report_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_report_photos_cleanup "
        "ON wims.report_photos(cleanup_status) WHERE cleanup_status IS NOT NULL"
    )


def downgrade() -> None:
    raise RuntimeError(
        "0030 repairs the persistent encrypted-evidence schema and cannot be safely downgraded"
    )
