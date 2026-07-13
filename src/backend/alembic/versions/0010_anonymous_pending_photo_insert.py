"""Add capability-bound anonymous pending photo insertion.

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-12
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_INSERT_HELPER = """
CREATE OR REPLACE FUNCTION wims.insert_anonymous_pending_photo(
    p_raw_token TEXT,
    p_photo_id UUID,
    p_client_photo_id UUID,
    p_media_type TEXT,
    p_file_extension TEXT,
    p_image_width INTEGER,
    p_image_height INTEGER,
    p_file_size_bytes INTEGER,
    p_original_storage_path TEXT,
    p_original_file_size_bytes INTEGER,
    p_original_sha256 TEXT,
    p_orig_encryption_iv TEXT,
    p_orig_key_version INTEGER,
    p_orig_crypto_provider TEXT,
    p_orig_kms_key_name TEXT,
    p_sanitized_storage_path TEXT,
    p_sanitized_file_size_bytes INTEGER,
    p_sanitized_sha256 TEXT,
    p_sanitized_encryption_iv TEXT,
    p_sanitized_key_version INTEGER,
    p_sanitized_crypto_provider TEXT,
    p_sanitized_kms_key_name TEXT,
    p_sensitive_metadata_blob_enc TEXT,
    p_metadata_encryption_iv TEXT,
    p_metadata_key_version INTEGER,
    p_metadata_crypto_provider TEXT,
    p_metadata_kms_key_name TEXT,
    p_exif_gps_status TEXT,
    p_browser_gps_status TEXT,
    p_gps_consensus TEXT,
    p_exif_data_source TEXT
)
RETURNS TABLE (
    photo_id UUID,
    duplicate BOOLEAN,
    cap_reached BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = wims, pg_temp
AS $$
DECLARE
    v_session_id UUID;
    v_inserted_id UUID;
    v_pending_count INTEGER;
BEGIN
    v_session_id := wims.validate_anonymous_session(p_raw_token);
    IF v_session_id IS NULL OR p_photo_id IS NULL THEN
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtext('rl:civilian-anonymous-pending-photo:' || v_session_id::text)
    );

    IF p_client_photo_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM wims.report_photos
        WHERE client_photo_id = p_client_photo_id
          AND anonymous_session_id = v_session_id
          AND report_id IS NULL
          AND attached_at IS NULL
    ) THEN
        RETURN QUERY SELECT NULL::UUID, TRUE, FALSE;
        RETURN;
    END IF;

    SELECT COUNT(*)
    INTO v_pending_count
    FROM wims.report_photos
    WHERE anonymous_session_id = v_session_id
      AND report_id IS NULL
      AND attached_at IS NULL;

    IF v_pending_count >= 1 THEN
        RETURN QUERY SELECT NULL::UUID, FALSE, TRUE;
        RETURN;
    END IF;

    INSERT INTO wims.report_photos (
        photo_id,
        report_id,
        attached_at,
        uploader_user_id,
        uploader_device_id,
        anonymous_session_id,
        media_type,
        file_extension,
        image_width,
        image_height,
        file_size_bytes,
        original_storage_path,
        original_file_size_bytes,
        original_sha256,
        orig_encryption_iv,
        orig_key_version,
        orig_crypto_provider,
        orig_kms_key_name,
        sanitized_storage_path,
        sanitized_file_size_bytes,
        sanitized_sha256,
        sanitized_encryption_iv,
        sanitized_key_version,
        sanitized_crypto_provider,
        sanitized_kms_key_name,
        sensitive_metadata_blob_enc,
        metadata_encryption_iv,
        metadata_key_version,
        metadata_crypto_provider,
        metadata_kms_key_name,
        exif_gps_status,
        browser_gps_status,
        gps_consensus,
        exif_data_source,
        client_photo_id
    ) VALUES (
        p_photo_id,
        NULL,
        NULL,
        NULL,
        NULL,
        v_session_id,
        p_media_type,
        p_file_extension,
        p_image_width,
        p_image_height,
        p_file_size_bytes,
        p_original_storage_path,
        p_original_file_size_bytes,
        p_original_sha256,
        p_orig_encryption_iv,
        p_orig_key_version,
        p_orig_crypto_provider,
        p_orig_kms_key_name,
        p_sanitized_storage_path,
        p_sanitized_file_size_bytes,
        p_sanitized_sha256,
        p_sanitized_encryption_iv,
        p_sanitized_key_version,
        p_sanitized_crypto_provider,
        p_sanitized_kms_key_name,
        p_sensitive_metadata_blob_enc,
        p_metadata_encryption_iv,
        p_metadata_key_version,
        p_metadata_crypto_provider,
        p_metadata_kms_key_name,
        p_exif_gps_status,
        p_browser_gps_status,
        p_gps_consensus,
        p_exif_data_source,
        p_client_photo_id
    )
    ON CONFLICT (client_photo_id) WHERE client_photo_id IS NOT NULL DO NOTHING
    RETURNING wims.report_photos.photo_id INTO v_inserted_id;

    IF v_inserted_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY SELECT v_inserted_id, FALSE, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION wims.insert_anonymous_pending_photo(
    TEXT, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, INTEGER,
    TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, INTEGER,
    TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wims.insert_anonymous_pending_photo(
    TEXT, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, INTEGER,
    TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, INTEGER,
    TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO wims_app;
"""


def upgrade() -> None:
    op.execute(_INSERT_HELPER)


def downgrade() -> None:
    op.execute(
        """
        DROP FUNCTION IF EXISTS wims.insert_anonymous_pending_photo(
            TEXT, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, INTEGER,
            TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, INTEGER,
            TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
        )
        """
    )
