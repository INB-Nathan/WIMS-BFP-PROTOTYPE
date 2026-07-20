"""Fail-closed read access to sanitized civilian photo artifacts."""

from __future__ import annotations

import hashlib
import logging
import os
import stat
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from services.kms import get_crypto_provider
from services.report_photos import (
    AAD_SANITIZED,
    REGISTERED_MAX_BYTES,
    _FINAL_ARTIFACT_RE,
    _get_storage_dir,
)

logger = logging.getLogger("wims.report_photo_read")
MAX_ENCRYPTED_ARTIFACT_BYTES = REGISTERED_MAX_BYTES * 4
_ALLOWED_MIME_MAGIC = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
}


class SanitizedPhotoUnavailable(Exception):
    """Safe internal failure that routes project as neutral not-found."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class SanitizedPhotoContent:
    content: bytes
    media_type: str
    image_width: int
    image_height: int


def _unavailable(reason: str, report_id: int, photo_id: str) -> SanitizedPhotoUnavailable:
    logger.warning(
        "Sanitized civilian photo unavailable reason=%s report_id=%s photo_id=%s",
        reason,
        report_id,
        photo_id,
    )
    return SanitizedPhotoUnavailable(reason)


def _read_bounded_file(path: Path, max_bytes: int) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError as exc:
        raise SanitizedPhotoUnavailable("missing") from exc
    except OSError as exc:
        raise SanitizedPhotoUnavailable("path_invalid") from exc

    try:
        chunks: list[bytes] = []
        remaining = max_bytes + 1
        while remaining > 0:
            chunk = os.read(fd, min(64 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        content = b"".join(chunks)
        if len(content) > max_bytes:
            raise SanitizedPhotoUnavailable("size_invalid")
        return content
    finally:
        os.close(fd)


def _resolve_sanitized_path(stored_path: str, root: Path) -> Path:
    candidate = Path(stored_path)
    if candidate.is_symlink():
        raise SanitizedPhotoUnavailable("path_invalid")
    if not _FINAL_ARTIFACT_RE.fullmatch(candidate.name) or not candidate.name.endswith(
        "_sanitized.bin"
    ):
        raise SanitizedPhotoUnavailable("path_invalid")

    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise SanitizedPhotoUnavailable("missing") from exc
    if root not in resolved.parents:
        raise SanitizedPhotoUnavailable("path_invalid")
    try:
        file_stat = resolved.stat(follow_symlinks=False)
    except FileNotFoundError as exc:
        raise SanitizedPhotoUnavailable("missing") from exc
    if not stat.S_ISREG(file_stat.st_mode):
        raise SanitizedPhotoUnavailable("path_invalid")
    if file_stat.st_size <= 0 or file_stat.st_size > MAX_ENCRYPTED_ARTIFACT_BYTES:
        raise SanitizedPhotoUnavailable("size_invalid")
    return resolved


def get_sanitized_photo_bytes(
    db: Session,
    report_id: int,
    photo_id: str,
) -> SanitizedPhotoContent:
    """Load, decrypt, and verify one sanitized artifact through an RLS session."""

    try:
        normalized_photo_id = str(UUID(str(photo_id)))
    except (TypeError, ValueError, AttributeError) as exc:
        raise _unavailable("not_found", report_id, str(photo_id)) from exc

    row = db.execute(
        text("""
            SELECT photo_id::text AS photo_id,
                   report_id,
                   media_type,
                   image_width,
                   image_height,
                   sanitized_storage_path,
                   sanitized_file_size_bytes,
                   sanitized_sha256,
                   sanitized_encryption_iv,
                   sanitized_key_version,
                   sanitized_crypto_provider,
                   sanitized_kms_key_name,
                   exif_gps_status,
                   browser_gps_status,
                   gps_consensus,
                   exif_to_report_distance_m,
                   browser_to_report_distance_m,
                   photo_reported_distance_m,
                   exif_datetime_original,
                   exif_data_source
            FROM wims.report_photos
            WHERE report_id = :report_id
              AND photo_id = CAST(:photo_id AS uuid)
        """),
        {"report_id": report_id, "photo_id": normalized_photo_id},
    ).fetchone()
    if row is None:
        raise _unavailable("not_found", report_id, normalized_photo_id)

    media_type = str(row.media_type)
    magic = _ALLOWED_MIME_MAGIC.get(media_type)
    if magic is None:
        raise _unavailable("mime_invalid", report_id, normalized_photo_id)
    if not 0 < int(row.sanitized_file_size_bytes) <= REGISTERED_MAX_BYTES:
        raise _unavailable("size_invalid", report_id, normalized_photo_id)

    root = _get_storage_dir().resolve()
    try:
        path = _resolve_sanitized_path(str(row.sanitized_storage_path), root)
        ciphertext = _read_bounded_file(path, MAX_ENCRYPTED_ARTIFACT_BYTES)
    except SanitizedPhotoUnavailable as exc:
        raise _unavailable(exc.reason, report_id, normalized_photo_id) from exc

    try:
        provider = get_crypto_provider(
            {
                "crypto_provider": row.sanitized_crypto_provider,
                "kms_key_name": row.sanitized_kms_key_name,
            }
        )
        plaintext = provider.decrypt_bytes(
            row.sanitized_encryption_iv,
            ciphertext,
            AAD_SANITIZED.format(photo_id=normalized_photo_id).encode("utf-8"),
            int(row.sanitized_key_version),
        )
    except Exception as exc:
        raise _unavailable("decrypt_failed", report_id, normalized_photo_id) from exc

    if len(plaintext) != int(row.sanitized_file_size_bytes):
        raise _unavailable("size_invalid", report_id, normalized_photo_id)
    if not plaintext.startswith(magic):
        raise _unavailable("mime_invalid", report_id, normalized_photo_id)
    if not hashlib.sha256(plaintext).hexdigest() == str(row.sanitized_sha256).lower():
        raise _unavailable("integrity_failed", report_id, normalized_photo_id)

    return SanitizedPhotoContent(
        content=plaintext,
        media_type=media_type,
        image_width=int(row.image_width),
        image_height=int(row.image_height),
    )
