"""Focused service contract tests for civilian report photos.

Covers:
- Exact variant AAD strings
- Terminal predicate (canonical, including REJECTED_* prefix)
- Default storage contract
- Ownership: UUID device_id conversion, invalid UUID -> 404
- Provider-construction failure -> cleanup + 500
- Reconcile unreferenced artifacts (referenced, unreferenced, symlinks, out-of-root)
- Stale temp file cleanup
"""

import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image

from services.report_photos import (
    AAD_METADATA,
    AAD_ORIGINAL,
    AAD_SANITIZED,
    DEFAULT_STORAGE_DIR,
    attach_registered_pending_photos,
    _encrypt_and_write,
    _encrypt_metadata_json,
    _read_upload,
    cleanup_stale_temp_files,
    is_terminal_status,
    upload_and_attach_photo,
    reconcile_unreferenced_photo_artifacts,
)


# ═══════════════════════════════════════════════════════════════════════════════
# AAD / terminal / storage contract
# ═══════════════════════════════════════════════════════════════════════════════


def test_exact_variant_aad_contract():
    photo_id = "12345678-1234-4234-8234-123456789abc"
    assert AAD_ORIGINAL.format(photo_id=photo_id) == f"civilian-photo:{photo_id}:original:v1"
    assert AAD_SANITIZED.format(photo_id=photo_id) == f"civilian-photo:{photo_id}:sanitized:v1"
    assert AAD_METADATA.format(photo_id=photo_id) == f"civilian-photo:{photo_id}:metadata:v1"


def test_terminal_predicate_is_canonical():
    assert is_terminal_status("ACTIONED")
    assert is_terminal_status("REJECTED_DUPLICATE")
    assert is_terminal_status("REJECTED_FUTURE")
    assert not is_terminal_status("PENDING")
    assert not is_terminal_status("UNDER_REVIEW")
    assert not is_terminal_status("LINKED")
    assert is_terminal_status("REJECTED_BOGUS")
    assert is_terminal_status("REJECTED_INSUFFICIENT")
    assert is_terminal_status("REJECTED_TIMEOUT")


def test_default_storage_contract_is_server_rooted():
    assert Path(DEFAULT_STORAGE_DIR).name == "civilian-photos"


# ═══════════════════════════════════════════════════════════════════════════════
# Device ID conversion
# ═══════════════════════════════════════════════════════════════════════════════


def test_valid_uuid_device_id():
    """A valid UUID string must convert cleanly."""
    valid = str(uuid.uuid4())
    # This doesn't test the full function - just validates that the
    # UUID conversion in upload_and_attach_photo would accept it.
    # The actual conversion is inside the service function.
    assert uuid.UUID(valid)


def test_invalid_uuid_device_id_raises():
    """An invalid UUID string must raise ValueError (which becomes 404)."""
    with pytest.raises(ValueError):
        uuid.UUID("not-a-uuid-at-all")


def test_empty_string_device_id_raises():
    """Empty string must fail UUID conversion."""
    with pytest.raises(ValueError):
        uuid.UUID("")


def test_invalid_device_id_is_neutral_404_before_database_use():
    """Existing arbitrary device values fail closed without a DB cast error."""
    with pytest.raises(HTTPException) as exc_info:
        upload_and_attach_photo(
            db=object(),
            report_id=1,
            file=object(),
            device_id="legacy-device-token",
            browser_gps_lat=None,
            browser_gps_lon=None,
            browser_gps_accuracy=None,
            browser_gps_captured_at=None,
            registered_user=None,
        )
    assert exc_info.value.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# Provider-construction failure
# ═══════════════════════════════════════════════════════════════════════════════


def test_encrypt_metadata_json_provider_failure_raises_httpexception():
    """Provider construction failure inside _encrypt_metadata_json must
    become HTTPException(500) so the caller's cleanup path runs."""
    with patch("services.report_photos.get_crypto_provider") as mock:
        mock.side_effect = RuntimeError("KMS unavailable")

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            _encrypt_metadata_json(
                {"test": "data"},
                "civilian-photo:{photo_id}:metadata:v1",
                str(uuid.uuid4()),
            )
        assert exc_info.value.status_code == 500


def test_upload_provider_construction_failure_cleans_renamed_artifacts(monkeypatch):
    """Provider construction failure for metadata removes earlier final files."""

    class FakeProvider:
        crypto_provider = "env_aesgcm"
        current_version = 1
        kms_key_name = "test"

        def encrypt_bytes(self, plaintext, aad):
            return "nonce", b"ciphertext"

    calls = iter((FakeProvider(), FakeProvider(), RuntimeError("KMS unavailable")))
    monkeypatch.setattr("services.report_photos.get_crypto_provider", lambda: next(calls))

    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp)
        monkeypatch.setenv("CIVILIAN_PHOTO_STORAGE_DIR", str(storage_dir))
        image = Image.new("RGB", (8, 4), (20, 40, 60))
        payload = BytesIO()
        image.save(payload, format="JPEG")
        payload.seek(0)
        upload = UploadFile(
            filename="evidence.jpg",
            file=payload,
            headers={"content-type": "image/jpeg"},
        )

        with pytest.raises(HTTPException) as exc_info:
            upload_and_attach_photo(
                db=object(),
                report_id=1,
                file=upload,
                device_id=str(uuid.uuid4()),
                browser_gps_lat=None,
                browser_gps_lon=None,
                browser_gps_accuracy=None,
                browser_gps_captured_at=None,
                registered_user=None,
            )
        assert exc_info.value.status_code == 500
        assert list(storage_dir.iterdir()) == []


def test_encrypt_and_write_provider_failure_raises_httpexception():
    """Provider failure in _encrypt_and_write must raise HTTPException(500)."""
    from fastapi import HTTPException

    tmp_dir = Path(tempfile.mkdtemp())
    try:
        with patch("services.report_photos.get_crypto_provider") as mock:
            mock.side_effect = RuntimeError("KMS unavailable")

            with pytest.raises(HTTPException) as exc_info:
                _encrypt_and_write(
                    str(uuid.uuid4()),
                    b"test data",
                    AAD_ORIGINAL,
                    tmp_dir,
                    "original.bin",
                )
            assert exc_info.value.status_code == 500
    finally:
        import shutil

        shutil.rmtree(tmp_dir, ignore_errors=True)


# ═══════════════════════════════════════════════════════════════════════════════
# Reconcilation
# ═══════════════════════════════════════════════════════════════════════════════


def _create_artifact(storage_dir: Path, name: str, age_hours: float = 0) -> Path:
    """Create a file in storage_dir and set its mtime."""
    path = storage_dir / name
    path.write_bytes(b"test artifact content")
    if age_hours > 0:
        old_time = datetime.now(timezone.utc) - timedelta(hours=age_hours)
        os.utime(path, (old_time.timestamp(), old_time.timestamp()))
    return path


class MockRow:
    """Minimal mock for a DB row tuple with index access."""

    def __init__(self, orig, sanitized):
        self._data = [orig, sanitized]

    def __getitem__(self, idx):
        return self._data[idx]


class MockSession:
    """Minimal mock DB session that returns known paths."""

    def __init__(self, known_paths: list[tuple[str | None, str | None]]):
        self._paths = known_paths
        self.closed = False

    def execute(self, *args, **kwargs):
        class MockResult:
            def __init__(self, rows):
                self._rows = rows

            def fetchall(self):
                return self._rows

        return MockResult(self._paths)

    def close(self):
        self.closed = True


def test_reconcile_referenced_final_artifact():
    """A final artifact that IS referenced in DB must NOT be quarantined."""
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp).resolve()
        orig = _create_artifact(
            storage_dir, "0123456789abcdef0123456789abcdef_original.bin", age_hours=72
        )

        db = MockSession([(str(orig), None)])
        count = reconcile_unreferenced_photo_artifacts(db, storage_dir=storage_dir, grace_hours=1)
        assert count == 0
        assert orig.exists()  # file should still be there


def test_reconcile_unreferenced_final_artifact():
    """An unreferenced final artifact must be quarantined."""
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp).resolve()
        orig = _create_artifact(
            storage_dir, "0123456789abcdef0123456789abcdef_original.bin", age_hours=72
        )

        db = MockSession([])  # no known paths
        count = reconcile_unreferenced_photo_artifacts(db, storage_dir=storage_dir, grace_hours=1)
        assert count == 1
        assert not orig.exists()  # should be moved to quarantine
        quarantine_dir = storage_dir / "quarantine"
        assert (quarantine_dir / "0123456789abcdef0123456789abcdef_original.bin").exists()


def test_reconcile_referenced_sanitized_artifact():
    """A sanitized artifact that IS referenced must not be quarantined."""
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp).resolve()
        san = _create_artifact(
            storage_dir, "fedcba9876543210fedcba9876543210_sanitized.bin", age_hours=72
        )

        db = MockSession([(None, str(san))])
        count = reconcile_unreferenced_photo_artifacts(db, storage_dir=storage_dir, grace_hours=1)
        assert count == 0
        assert san.exists()


def test_reconcile_random_file_not_affected():
    """Files not matching the strict artifact pattern must be ignored."""
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp).resolve()
        f = _create_artifact(storage_dir, "random.txt", age_hours=72)

        db = MockSession([])
        count = reconcile_unreferenced_photo_artifacts(db, storage_dir=storage_dir, grace_hours=1)
        assert count == 0
        assert f.exists()  # random file untouched


def test_reconcile_symlink_not_followed():
    """Symbolic links must be excluded from reconciliation."""
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp).resolve()
        # Create a real target and a symlink
        real_target = storage_dir / "real_target.bin"
        real_target.write_bytes(b"test")
        symlink = storage_dir / "0123456789abcdef0123456789abcdef_original.bin"
        symlink.symlink_to(real_target)

        db = MockSession([])
        count = reconcile_unreferenced_photo_artifacts(db, storage_dir=storage_dir, grace_hours=1)
        assert count == 0  # symlink excluded
        assert symlink.exists()  # not touched
        assert real_target.exists()


def test_reconcile_out_of_root():
    """Files outside the storage root must not be processed."""
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp).resolve()
        # Create file outside storage dir
        outside = Path(tempfile.mkdtemp()) / "0123456789abcdef0123456789abcdef_original.bin"
        outside.write_text("outside")
        os.utime(
            outside,
            (
                datetime.now(timezone.utc).timestamp() - 3600 * 72,
                datetime.now(timezone.utc).timestamp() - 3600 * 72,
            ),
        )

        db = MockSession([])
        count = reconcile_unreferenced_photo_artifacts(db, storage_dir=storage_dir, grace_hours=1)
        assert count == 0  # out-of-root file not found

        import shutil

        shutil.rmtree(outside.parent, ignore_errors=True)


def test_reconcile_grace_age_enforced():
    """Files newer than grace period must not be quarantined."""
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp).resolve()
        recent = _create_artifact(
            storage_dir, "0123456789abcdef0123456789abcdef_original.bin", age_hours=0
        )  # brand new

        db = MockSession([])
        count = reconcile_unreferenced_photo_artifacts(db, storage_dir=storage_dir, grace_hours=48)
        assert count == 0  # too new, even though unreferenced
        assert recent.exists()


def test_reconcile_stale_temp_unaffected():
    """Stale *.tmp files must not be affected by reconciliation."""
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp).resolve()
        tmp_file = _create_artifact(storage_dir, "test.tmp", age_hours=72)

        db = MockSession([])
        count = reconcile_unreferenced_photo_artifacts(db, storage_dir=storage_dir, grace_hours=1)
        assert count == 0  # .tmp files don't match artifact pattern
        assert tmp_file.exists()


# ═══════════════════════════════════════════════════════════════════════════════
# Stale temp file cleanup
# ═══════════════════════════════════════════════════════════════════════════════


def test_cleanup_stale_temp_files():
    """Old .tmp files must be cleaned up; recent ones and non-.tmp must remain."""
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp).resolve()

        # Override env to point to our temp dir
        old_env = os.environ.get("CIVILIAN_PHOTO_STORAGE_DIR")
        os.environ["CIVILIAN_PHOTO_STORAGE_DIR"] = str(storage_dir)
        try:
            # Re-import the function to pick up the env override... actually
            # _get_storage_dir reads env each call, so it works.

            stale = _create_artifact(storage_dir, "stale.tmp", age_hours=2)
            recent = _create_artifact(storage_dir, "recent.tmp", age_hours=0)
            keep = _create_artifact(storage_dir, "important.bin", age_hours=2)

            count = cleanup_stale_temp_files(max_age_hours=1)
            assert count == 1  # only stale.tmp cleaned
            assert not stale.exists()
            assert recent.exists()
            assert keep.exists()
        finally:
            if old_env is not None:
                os.environ["CIVILIAN_PHOTO_STORAGE_DIR"] = old_env
            else:
                os.environ.pop("CIVILIAN_PHOTO_STORAGE_DIR", None)


# ═══════════════════════════════════════════════════════════════════════════════
# Read upload cap
# ═══════════════════════════════════════════════════════════════════════════════


def test_read_upload_under_cap():
    """Upload under cap must return all bytes."""
    from fastapi import UploadFile

    content = b"x" * 100
    uf = UploadFile(BytesIO(content))
    result = _read_upload(uf, max_bytes=200)
    assert result == content


def test_read_upload_over_cap():
    """Upload over cap must raise 413."""
    from fastapi import HTTPException, UploadFile

    content = b"x" * 200
    uf = UploadFile(BytesIO(content))
    with pytest.raises(HTTPException) as exc:
        _read_upload(uf, max_bytes=100)
    assert exc.value.status_code == 413


# ═══════════════════════════════════════════════════════════════════════════════
# Registered pending-photo attach adapter (Slice D)
# ═══════════════════════════════════════════════════════════════════════════════


def test_attach_registered_pending_photos_calls_helper_with_derived_identity():
    """The adapter must forward the server-derived user_id/report_id/photo_ids
    to wims.attach_registered_photos and return its boolean result."""
    from unittest.mock import MagicMock

    user_id = uuid.uuid4()
    report_id = 42
    photo_ids = [uuid.uuid4(), uuid.uuid4()]

    scalar = MagicMock()
    scalar.scalar_one_or_none.return_value = True
    db = MagicMock()
    db.execute.return_value = scalar

    ok = attach_registered_pending_photos(db, user_id, report_id, photo_ids)

    assert ok is True
    db.execute.assert_called_once()
    executed, params = db.execute.call_args.args
    assert "wims.attach_registered_photos" in str(executed)
    assert params["p_user_id"] == user_id
    assert params["p_report_id"] == report_id
    assert params["p_photo_ids"] == list(photo_ids)


def test_attach_registered_pending_photos_returns_helper_boolean():
    """FALSE/None from the helper must surface as a falsy bool, not raise."""
    from unittest.mock import MagicMock

    for helper_value in (False, None):
        scalar = MagicMock()
        scalar.scalar_one_or_none.return_value = helper_value
        db = MagicMock()
        db.execute.return_value = scalar

        assert attach_registered_pending_photos(db, uuid.uuid4(), 7, [uuid.uuid4()]) is False
