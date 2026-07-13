"""Focused contracts for registered and capability-bound pending-photo upload."""

from __future__ import annotations

import tempfile
import uuid
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile

from services import report_photos
from services.anonymous_sessions import ValidatedAnonymousCapability
from services.report_photos import upload_pending_photo


class _Result:
    def __init__(self, value=None):
        self.value = value

    def scalar(self):
        return self.value


class _DB:
    def __init__(self, *, insert_value=None, fail_insert=False, pending_count=0, duplicate=False):
        self.statements = []
        self.commits = 0
        self.rollbacks = 0
        self.insert_value = insert_value or str(uuid.uuid4())
        self.fail_insert = fail_insert
        self.pending_count = pending_count
        self.duplicate = duplicate

    def execute(self, statement, params=None):
        sql = str(statement)
        self.statements.append((sql, params))
        if "client_photo_id =" in sql:
            return _Result(1 if self.duplicate else None)
        if "COUNT(*)" in sql:
            return _Result(self.pending_count)
        if "INSERT INTO wims.report_photos" in sql:
            if self.fail_insert:
                raise RuntimeError("database unavailable")
            return _Result(self.insert_value)
        return _Result(None)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def _upload() -> UploadFile:
    return UploadFile(
        filename="evidence.jpg",
        file=BytesIO(b"\xff\xd8\xffencrypted-test-image"),
        headers={"content-type": "image/jpeg"},
    )


_audit_calls: list[dict] = []


def _patch_pipeline(monkeypatch, storage_dir: Path):
    monkeypatch.setattr(report_photos, "check_magic_bytes", lambda *_args: None)
    monkeypatch.setattr(
        report_photos,
        "extract_exif",
        lambda _content: SimpleNamespace(
            gps=None,
            gps_present=False,
            datetime_original=None,
            offset_time=None,
            make=None,
            model=None,
            orientation=None,
        ),
    )
    monkeypatch.setattr(
        report_photos,
        "sanitize_image",
        lambda _content, _mime: SimpleNamespace(data=b"sanitized", width=4, height=3),
    )
    monkeypatch.setattr(
        report_photos,
        "compute_gps_consensus",
        lambda *_args: "unavailable",
    )
    counter = iter(("orig.bin", "sanitized.bin"))

    def write_artifact(_photo_id, _plaintext, _aad, _root, _suffix):
        path = storage_dir / next(counter)
        path.write_bytes(b"ciphertext")
        meta = {
            "encryption_iv": "nonce",
            "key_version": 1,
            "crypto_provider": "env_aesgcm",
            "kms_key_name": "test",
        }
        return str(path), "nonce", meta

    monkeypatch.setattr(report_photos, "_encrypt_and_write", write_artifact)
    monkeypatch.setattr(
        report_photos,
        "_encrypt_metadata_json",
        lambda *_args: (
            "encrypted-metadata",
            {
                "encryption_iv": "nonce",
                "key_version": 1,
                "crypto_provider": "env_aesgcm",
                "kms_key_name": "test",
            },
        ),
    )
    _audit_calls.clear()

    def _record_audit(**kwargs):
        _audit_calls.append(kwargs)

    monkeypatch.setattr(report_photos, "log_system_audit", _record_audit)


def test_registered_pending_upload_sets_owner_and_null_attachment(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp)
        monkeypatch.setenv("CIVILIAN_PHOTO_STORAGE_DIR", str(storage_dir))
        _patch_pipeline(monkeypatch, storage_dir)
        db = _DB()
        user_id = uuid.uuid4()

        response = upload_pending_photo(
            db=db,
            file=_upload(),
            registered_user={"user_id": user_id, "role": "CIVILIAN_REPORTER"},
            anonymous_session_id=None,
            client_photo_id=uuid.uuid4(),
        )

        assert response.report_id is None
        assert response.duplicate is False
        insert_sql, params = next(
            item for item in db.statements if "INSERT INTO wims.report_photos" in item[0]
        )
        assert "report_id, attached_at" in insert_sql
        assert "exif_gps_lat" not in insert_sql
        assert params["uploader_user_id"] == str(user_id)
        assert params["exif_data_source"] is None
        assert db.commits == 1
        assert db.rollbacks == 0
        assert len(_audit_calls) == 1
        assert _audit_calls[0]["action_type"] == "PHOTO_UPLOAD_PREUPLOAD"
        assert _audit_calls[0]["new_values"] == {"photo_id": str(response.photo_id)}


def test_pending_upload_requires_anonymous_capability():
    with pytest.raises(HTTPException) as exc_info:
        upload_pending_photo(
            db=object(),
            file=object(),
            registered_user=None,
            anonymous_session_id=uuid.uuid4(),
        )
    assert exc_info.value.status_code == 404


def test_anonymous_pending_upload_uses_capability_helper_and_null_owner_fields(
    monkeypatch,
):
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp)
        monkeypatch.setenv("CIVILIAN_PHOTO_STORAGE_DIR", str(storage_dir))
        _patch_pipeline(monkeypatch, storage_dir)
        capability = ValidatedAnonymousCapability(uuid.uuid4(), "a" * 64)
        seen = {}

        def insert(_db, received_capability, **params):
            seen["capability"] = received_capability
            seen["params"] = params
            return (
                uuid.UUID(params["photo_id"])
                if isinstance(params["photo_id"], str)
                else params["photo_id"],
                False,
                False,
            )

        monkeypatch.setattr(report_photos, "insert_anonymous_pending_photo", insert)
        response = upload_pending_photo(
            db=_DB(),
            file=_upload(),
            registered_user=None,
            anonymous_session_id=uuid.uuid4(),
            anonymous_capability=capability,
            client_photo_id=uuid.uuid4(),
        )

        assert response.duplicate is False
        assert seen["capability"] is capability
        assert seen["capability"].anonymous_session_id == capability.anonymous_session_id
        assert seen["params"]["photo_id"] is not None
        assert seen["params"]["client_photo_id"] is not None
        assert "uploader_user_id" not in seen["params"]
        assert "uploader_device_id" not in seen["params"]
        assert "anonymous_session_id" not in seen["params"]
        assert "report_id" not in seen["params"]
        assert "attached_at" not in seen["params"]


def test_anonymous_pending_duplicate_does_not_commit_or_audit(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp)
        monkeypatch.setenv("CIVILIAN_PHOTO_STORAGE_DIR", str(storage_dir))
        _patch_pipeline(monkeypatch, storage_dir)
        monkeypatch.setattr(
            report_photos,
            "insert_anonymous_pending_photo",
            lambda *_args, **_kwargs: (None, True, False),
        )
        db = _DB()
        response = upload_pending_photo(
            db=db,
            file=_upload(),
            registered_user=None,
            anonymous_session_id=None,
            anonymous_capability=ValidatedAnonymousCapability(uuid.uuid4(), "b" * 64),
        )

        assert response.duplicate is True
        assert db.commits == 0
        assert db.rollbacks == 1
        assert _audit_calls == []
        assert list(storage_dir.iterdir()) == []


def test_anonymous_pending_cap_cleans_artifacts(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp)
        monkeypatch.setenv("CIVILIAN_PHOTO_STORAGE_DIR", str(storage_dir))
        _patch_pipeline(monkeypatch, storage_dir)
        monkeypatch.setattr(
            report_photos,
            "insert_anonymous_pending_photo",
            lambda *_args, **_kwargs: (None, False, True),
        )
        db = _DB()
        with pytest.raises(HTTPException) as exc_info:
            upload_pending_photo(
                db=db,
                file=_upload(),
                registered_user=None,
                anonymous_session_id=None,
                anonymous_capability=ValidatedAnonymousCapability(uuid.uuid4(), "c" * 64),
            )

        assert exc_info.value.status_code == 409
        assert db.commits == 0
        assert db.rollbacks == 1
        assert _audit_calls == []
        assert list(storage_dir.iterdir()) == []


def test_pending_upload_invalid_file_fails_before_database(monkeypatch):
    db = _DB()
    with pytest.raises(HTTPException) as exc_info:
        upload_pending_photo(
            db=db,
            file=UploadFile(
                filename="evidence.txt",
                file=BytesIO(b"not an image"),
                headers={"content-type": "text/plain"},
            ),
            registered_user={"user_id": uuid.uuid4(), "role": "CIVILIAN_REPORTER"},
            anonymous_session_id=None,
        )
    assert exc_info.value.status_code in (400, 422)
    assert not any("INSERT INTO" in sql for sql, _params in db.statements)


def test_pending_duplicate_is_idempotent_and_does_not_commit(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp)
        monkeypatch.setenv("CIVILIAN_PHOTO_STORAGE_DIR", str(storage_dir))
        _patch_pipeline(monkeypatch, storage_dir)
        db = _DB(duplicate=True)

        response = upload_pending_photo(
            db=db,
            file=_upload(),
            registered_user={"user_id": uuid.uuid4(), "role": "CIVILIAN_REPORTER"},
            anonymous_session_id=None,
            client_photo_id=uuid.uuid4(),
        )

        assert response.duplicate is True
        assert response.photo_id is None
        assert db.commits == 0
        assert list(storage_dir.iterdir()) == []


def test_pending_db_failure_cleans_encrypted_artifacts(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        storage_dir = Path(tmp)
        monkeypatch.setenv("CIVILIAN_PHOTO_STORAGE_DIR", str(storage_dir))
        _patch_pipeline(monkeypatch, storage_dir)
        db = _DB(fail_insert=True)

        with pytest.raises(HTTPException) as exc_info:
            upload_pending_photo(
                db=db,
                file=_upload(),
                registered_user={"user_id": uuid.uuid4(), "role": "CIVILIAN_REPORTER"},
                anonymous_session_id=None,
            )

        assert exc_info.value.status_code == 500
        assert db.rollbacks == 1
        assert list(storage_dir.iterdir()) == []
