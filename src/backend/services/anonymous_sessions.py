"""Database-backed anonymous session capability adapter.

Raw bearer capabilities are accepted only at this boundary. Issuance returns
one raw token for the caller to deliver once; ordinary validation and revocation
return only derived state. The upload dependency uses a request-local validated
value only to pass the bearer to its fixed-search-path SQL helper. This module
deliberately does not log or persist bearer values.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class IssuedAnonymousSession:
    """The one-time issuance result; ``raw_token`` must not be stored or logged."""

    anonymous_session_id: UUID
    raw_token: str


@dataclass(frozen=True)
class ValidatedAnonymousCapability:
    """Request-local bearer validation result.

    The raw token is deliberately excluded from repr output. Callers must keep
    this object transient and must never log, serialize, persist, or audit it.
    """

    anonymous_session_id: UUID
    raw_token: str = field(repr=False)


def issue_anonymous_session(
    db: Session,
    device_id_hash: str | None = None,
) -> IssuedAnonymousSession:
    """Issue a capability through the SECURITY DEFINER SQL helper.

    ``device_id_hash`` is optional analytics data and must already be hashed by
    the caller.  The raw bearer is returned only in this issuance result.
    """
    try:
        row = db.execute(
            text(
                "SELECT anonymous_session_id, raw_token "
                "FROM wims.issue_anonymous_session(:device_id_hash)"
            ),
            {"device_id_hash": device_id_hash},
        ).one()
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise

    session_id, raw_token = row[0], row[1]
    if session_id is None or not isinstance(raw_token, str):
        raise RuntimeError("Anonymous session helper returned an invalid issuance")
    return IssuedAnonymousSession(anonymous_session_id=UUID(str(session_id)), raw_token=raw_token)


def validate_anonymous_session(db: Session, raw_token: str) -> UUID | None:
    """Validate a bearer and return only its derived session UUID.

    The SQL helper enforces token shape, idle/absolute expiry, and revocation.
    The caller owns the surrounding transaction; validation's last-seen update
    is therefore committed with the protected operation.
    """
    result = db.execute(
        text("SELECT wims.validate_anonymous_session(:raw_token)"),
        {"raw_token": raw_token},
    )
    value = result.scalar_one_or_none()
    return UUID(str(value)) if value is not None else None


def revoke_anonymous_session(db: Session, raw_token: str) -> bool:
    """Revoke a bearer through the SQL helper without exposing an owner ID."""
    try:
        result = db.execute(
            text("SELECT wims.revoke_anonymous_session(:raw_token)"),
            {"raw_token": raw_token},
        )
        revoked = bool(result.scalar_one_or_none())
        db.commit()
        return revoked
    except SQLAlchemyError:
        db.rollback()
        raise


def insert_anonymous_pending_photo(
    db: Session,
    capability: ValidatedAnonymousCapability,
    *,
    photo_id: UUID,
    client_photo_id: UUID | None,
    media_type: str,
    file_extension: str,
    image_width: int,
    image_height: int,
    file_size_bytes: int,
    original_storage_path: str,
    original_file_size_bytes: int,
    original_sha256: str,
    orig_encryption_iv: str,
    orig_key_version: int,
    orig_crypto_provider: str,
    orig_kms_key_name: str | None,
    sanitized_storage_path: str,
    sanitized_file_size_bytes: int,
    sanitized_sha256: str,
    sanitized_encryption_iv: str,
    sanitized_key_version: int,
    sanitized_crypto_provider: str,
    sanitized_kms_key_name: str | None,
    sensitive_metadata_blob_enc: str,
    metadata_encryption_iv: str,
    metadata_key_version: int,
    metadata_crypto_provider: str,
    metadata_kms_key_name: str | None,
    exif_gps_status: str,
    browser_gps_status: str,
    gps_consensus: str | None,
    exif_data_source: str | None,
) -> tuple[UUID | None, bool, bool] | None:
    """Insert one pending row through the capability-bound SQL helper."""
    result = db.execute(
        text(
            "SELECT photo_id, duplicate, cap_reached "
            "FROM wims.insert_anonymous_pending_photo("
            ":p_raw_token, :p_photo_id, :p_client_photo_id, :p_media_type, "
            ":p_file_extension, :p_image_width, :p_image_height, :p_file_size_bytes, "
            ":p_original_storage_path, :p_original_file_size_bytes, :p_original_sha256, "
            ":p_orig_encryption_iv, :p_orig_key_version, :p_orig_crypto_provider, "
            ":p_orig_kms_key_name, :p_sanitized_storage_path, "
            ":p_sanitized_file_size_bytes, :p_sanitized_sha256, "
            ":p_sanitized_encryption_iv, :p_sanitized_key_version, "
            ":p_sanitized_crypto_provider, :p_sanitized_kms_key_name, "
            ":p_sensitive_metadata_blob_enc, :p_metadata_encryption_iv, "
            ":p_metadata_key_version, :p_metadata_crypto_provider, "
            ":p_metadata_kms_key_name, :p_exif_gps_status, :p_browser_gps_status, "
            ":p_gps_consensus, :p_exif_data_source)"
        ),
        {
            "p_raw_token": capability.raw_token,
            "p_photo_id": photo_id,
            "p_client_photo_id": client_photo_id,
            "p_media_type": media_type,
            "p_file_extension": file_extension,
            "p_image_width": image_width,
            "p_image_height": image_height,
            "p_file_size_bytes": file_size_bytes,
            "p_original_storage_path": original_storage_path,
            "p_original_file_size_bytes": original_file_size_bytes,
            "p_original_sha256": original_sha256,
            "p_orig_encryption_iv": orig_encryption_iv,
            "p_orig_key_version": orig_key_version,
            "p_orig_crypto_provider": orig_crypto_provider,
            "p_orig_kms_key_name": orig_kms_key_name,
            "p_sanitized_storage_path": sanitized_storage_path,
            "p_sanitized_file_size_bytes": sanitized_file_size_bytes,
            "p_sanitized_sha256": sanitized_sha256,
            "p_sanitized_encryption_iv": sanitized_encryption_iv,
            "p_sanitized_key_version": sanitized_key_version,
            "p_sanitized_crypto_provider": sanitized_crypto_provider,
            "p_sanitized_kms_key_name": sanitized_kms_key_name,
            "p_sensitive_metadata_blob_enc": sensitive_metadata_blob_enc,
            "p_metadata_encryption_iv": metadata_encryption_iv,
            "p_metadata_key_version": metadata_key_version,
            "p_metadata_crypto_provider": metadata_crypto_provider,
            "p_metadata_kms_key_name": metadata_kms_key_name,
            "p_exif_gps_status": exif_gps_status,
            "p_browser_gps_status": browser_gps_status,
            "p_gps_consensus": gps_consensus,
            "p_exif_data_source": exif_data_source,
        },
    )
    row = result.fetchone()
    if row is None:
        return None
    return (
        UUID(str(row[0])) if row[0] is not None else None,
        bool(row[1]),
        bool(row[2]),
    )


def attach_anonymous_pending_photos(
    db: Session,
    capability: ValidatedAnonymousCapability,
    report_id: int,
    photo_ids: list[UUID],
) -> bool:
    """Attach a complete same-session pending photo set to a report.

    Delegates ownership derivation and atomicity to the SECURITY DEFINER helper.
    The raw token is passed only to the helper and is never logged, returned, or
    audited.
    """
    result = db.execute(
        text(
            "SELECT wims.attach_anonymous_photos(:p_raw_token, :p_report_id, :p_photo_ids::uuid[])"
        ),
        {
            "p_raw_token": capability.raw_token,
            "p_report_id": report_id,
            "p_photo_ids": list(photo_ids),
        },
    )
    value = result.scalar_one_or_none()
    return bool(value)


def authorize_pending_photo(
    db: Session,
    raw_token: str,
    photo_id: UUID,
) -> bool:
    """Authorize one pending photo using the capability SQL helper.

    This is intentionally kept as a service-only adapter. HTTP dependencies
    must keep bearer handling header-only and request-local; routes expose only
    derived state and upload responses never include the bearer.
    """
    result = db.execute(
        text("SELECT wims.authorize_anonymous_pending_photo(:raw_token, :photo_id)"),
        {"raw_token": raw_token, "photo_id": photo_id},
    )
    return bool(result.scalar_one_or_none())


def resolve_pending_photo_owner(
    *,
    registered_user: dict[str, Any] | None,
    anonymous_session_id: UUID | None,
) -> tuple[UUID | None, UUID | None]:
    """Return ``(uploader_user_id, anonymous_session_id)`` for a pending row.

    A pending row has exactly one owner.  Caller-supplied device IDs are not
    accepted as an anonymous ownership mechanism.
    """
    if registered_user is not None:
        if registered_user.get("role") != "CIVILIAN_REPORTER":
            raise ValueError("registered user is not a civilian reporter")
        try:
            return UUID(str(registered_user["user_id"])), None
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise ValueError("registered user has no valid UUID") from exc
    if anonymous_session_id is None:
        raise ValueError("anonymous pending photo requires a validated session")
    return None, UUID(str(anonymous_session_id))
