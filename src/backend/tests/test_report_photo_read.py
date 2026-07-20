"""Security tests for sanitized-only civilian photo reads."""

from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from services.report_photo_read import SanitizedPhotoUnavailable, get_sanitized_photo_bytes
from services.report_photos import AAD_SANITIZED


PHOTO_ID = "12345678-1234-4234-8234-123456789abc"


def _row(path: Path, plaintext: bytes, **overrides):
    values = {
        "photo_id": PHOTO_ID,
        "report_id": 42,
        "media_type": "image/jpeg",
        "image_width": 12,
        "image_height": 8,
        "sanitized_storage_path": str(path),
        "sanitized_file_size_bytes": len(plaintext),
        "sanitized_sha256": hashlib.sha256(plaintext).hexdigest(),
        "sanitized_encryption_iv": "nonce",
        "sanitized_key_version": 1,
        "sanitized_crypto_provider": "env_aesgcm",
        "sanitized_kms_key_name": None,
        "exif_gps_status": "unavailable",
        "browser_gps_status": "unavailable",
        "gps_consensus": "unavailable",
        "exif_to_report_distance_m": None,
        "browser_to_report_distance_m": None,
        "photo_reported_distance_m": None,
        "exif_datetime_original": None,
        "exif_data_source": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _db(row):
    result = MagicMock()
    result.fetchone.return_value = row
    db = MagicMock()
    db.execute.return_value = result
    return db


def test_reads_and_verifies_only_sanitized_plaintext(tmp_path: Path) -> None:
    plaintext = b"\xff\xd8\xffsanitized-jpeg"
    path = tmp_path / "0123456789abcdef0123456789abcdef_sanitized.bin"
    path.write_bytes(b"ciphertext")
    provider = MagicMock()
    provider.decrypt_bytes.return_value = plaintext

    with (
        patch("services.report_photo_read._get_storage_dir", return_value=tmp_path),
        patch("services.report_photo_read.get_crypto_provider", return_value=provider),
    ):
        result = get_sanitized_photo_bytes(_db(_row(path, plaintext)), 42, PHOTO_ID)

    assert result.content == plaintext
    assert result.media_type == "image/jpeg"
    provider.decrypt_bytes.assert_called_once_with(
        "nonce",
        b"ciphertext",
        AAD_SANITIZED.format(photo_id=PHOTO_ID).encode("utf-8"),
        1,
    )


def test_rls_or_report_photo_mismatch_is_neutral() -> None:
    with pytest.raises(SanitizedPhotoUnavailable) as exc:
        get_sanitized_photo_bytes(_db(None), 42, PHOTO_ID)
    assert exc.value.reason == "not_found"


@pytest.mark.parametrize(
    ("mutate", "reason"),
    [
        (lambda row: setattr(row, "sanitized_sha256", "0" * 64), "integrity_failed"),
        (lambda row: setattr(row, "media_type", "text/plain"), "mime_invalid"),
        (lambda row: setattr(row, "sanitized_file_size_bytes", 99_999_999), "size_invalid"),
    ],
)
def test_rejects_invalid_integrity_mime_or_size(tmp_path: Path, mutate, reason: str) -> None:
    plaintext = b"\xff\xd8\xffsanitized-jpeg"
    path = tmp_path / "0123456789abcdef0123456789abcdef_sanitized.bin"
    path.write_bytes(b"ciphertext")
    row = _row(path, plaintext)
    mutate(row)
    provider = MagicMock()
    provider.decrypt_bytes.return_value = plaintext

    with (
        patch("services.report_photo_read._get_storage_dir", return_value=tmp_path),
        patch("services.report_photo_read.get_crypto_provider", return_value=provider),
        pytest.raises(SanitizedPhotoUnavailable) as exc,
    ):
        get_sanitized_photo_bytes(_db(row), 42, PHOTO_ID)
    assert exc.value.reason == reason


def test_rejects_missing_out_of_root_and_symlink_paths(tmp_path: Path) -> None:
    plaintext = b"\x89PNG\r\n\x1a\nsanitized"
    outside = tmp_path.parent / "0123456789abcdef0123456789abcdef_sanitized.bin"
    outside.write_bytes(b"ciphertext")

    try:
        with (
            patch("services.report_photo_read._get_storage_dir", return_value=tmp_path),
            pytest.raises(SanitizedPhotoUnavailable) as exc,
        ):
            get_sanitized_photo_bytes(
                _db(_row(outside, plaintext, media_type="image/png")), 42, PHOTO_ID
            )
        assert exc.value.reason == "path_invalid"

        missing = tmp_path / "fedcba9876543210fedcba9876543210_sanitized.bin"
        with (
            patch("services.report_photo_read._get_storage_dir", return_value=tmp_path),
            pytest.raises(SanitizedPhotoUnavailable) as exc,
        ):
            get_sanitized_photo_bytes(
                _db(_row(missing, plaintext, media_type="image/png")), 42, PHOTO_ID
            )
        assert exc.value.reason == "missing"

        target = tmp_path / "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_sanitized.bin"
        target.write_bytes(b"ciphertext")
        link = tmp_path / "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_sanitized.bin"
        link.symlink_to(target)
        with (
            patch("services.report_photo_read._get_storage_dir", return_value=tmp_path),
            pytest.raises(SanitizedPhotoUnavailable) as exc,
        ):
            get_sanitized_photo_bytes(
                _db(_row(link, plaintext, media_type="image/png")), 42, PHOTO_ID
            )
        assert exc.value.reason == "path_invalid"
    finally:
        outside.unlink(missing_ok=True)


def test_decryption_failure_never_reads_original(tmp_path: Path) -> None:
    plaintext = b"\xff\xd8\xffsanitized"
    path = tmp_path / "0123456789abcdef0123456789abcdef_sanitized.bin"
    path.write_bytes(b"ciphertext")
    provider = MagicMock()
    provider.decrypt_bytes.side_effect = RuntimeError("decrypt failed")
    db = _db(_row(path, plaintext))

    with (
        patch("services.report_photo_read._get_storage_dir", return_value=tmp_path),
        patch("services.report_photo_read.get_crypto_provider", return_value=provider),
        pytest.raises(SanitizedPhotoUnavailable) as exc,
    ):
        get_sanitized_photo_bytes(db, 42, PHOTO_ID)

    assert exc.value.reason == "decrypt_failed"
    sql = str(db.execute.call_args.args[0])
    assert "original_storage_path" not in sql
