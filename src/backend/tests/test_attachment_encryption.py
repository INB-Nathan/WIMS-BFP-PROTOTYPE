"""M6a: Attachment encryption at rest — unit + route tests.

Tests cover:
  - SecurityProvider.encrypt_bytes / decrypt_bytes (pure unit, no HTTP)
  - Upload route: encrypted-at-rest, IV stored, hash on plaintext, key_version, 413
  - Serve route: roundtrip, legacy raw serve, tampered ct → 500, wrong nonce → 500,
                 404 on missing row/file, CIVILIAN_REPORTER blocked, analyst allowed
"""

import base64
import hashlib
import os
import secrets
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from auth import get_current_wims_user, get_db_with_rls
from main import app
from utils.crypto import SecurityProvider, SecurityProviderError

# ── helpers ───────────────────────────────────────────────────────────────────


def _fresh_key_b64() -> str:
    return base64.b64encode(secrets.token_bytes(32)).decode()


def _encoder_user():
    return {
        "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-encoder",
        "username": "encoder",
        "role": "REGIONAL_ENCODER",
        "assigned_region_id": 13,
    }


def _analyst_user():
    return {
        "user_id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-analyst",
        "username": "analyst",
        "role": "NATIONAL_ANALYST",
    }


def _civilian_user():
    return {
        "user_id": "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-civilian",
        "username": "civilian",
        "role": "CIVILIAN_REPORTER",
    }


def _admin_user():
    return {
        "user_id": "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-admin",
        "username": "admin",
        "role": "SYSTEM_ADMIN",
    }


def _validator_user():
    return {
        "user_id": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-validator",
        "username": "validator",
        "role": "NATIONAL_VALIDATOR",
        "assigned_region_id": 13,
    }


def _sp(monkeypatch) -> SecurityProvider:
    """Fresh SecurityProvider with a random test key."""
    monkeypatch.setenv("WIMS_MASTER_KEY", _fresh_key_b64())
    return SecurityProvider()


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def tmp_storage(tmp_path, monkeypatch):
    monkeypatch.setenv("WIMS_ATTACHMENT_STORAGE_DIR", str(tmp_path))
    return tmp_path


# ── upload DB mock helpers ─────────────────────────────────────────────────────


def _upload_db(attachment_id=42, incident_exists=True):
    """Mock DB for the upload route (2 execute calls: SELECT incident, INSERT)."""
    mock_db = MagicMock()
    call_count = 0

    def _side_effect(query, params=None):
        nonlocal call_count
        call_count += 1
        result = MagicMock()
        sql = str(query)
        if "fire_incidents" in sql:
            result.fetchone.return_value = (1,) if incident_exists else None
        elif "incident_attachments" in sql:
            result.fetchone.return_value = (attachment_id,)
        else:
            result.fetchone.return_value = None
        return result

    mock_db.execute.side_effect = _side_effect
    return mock_db


def _get_insert_params(mock_db) -> dict:
    """Extract the params dict from the INSERT execute call."""
    for call in mock_db.execute.call_args_list:
        args = call[0]
        if args and "INSERT" in str(args[0]) and "incident_attachments" in str(args[0]):
            return args[1]
    raise AssertionError("No incident_attachments INSERT call found in mock_db")


# ════════════════════════════════════════════════════════════════════════════════
# Unit: SecurityProvider.encrypt_bytes / decrypt_bytes
# ════════════════════════════════════════════════════════════════════════════════


class TestEncryptDecryptBytes:
    def test_encrypt_returns_nonce_b64_and_raw_bytes(self, monkeypatch):
        sp = _sp(monkeypatch)
        data = b"hello world"
        nonce_b64, ct = sp.encrypt_bytes(data, b"aad")
        nonce = base64.b64decode(nonce_b64)
        assert len(nonce) == 12
        assert isinstance(ct, bytes)
        assert ct != data

    def test_roundtrip(self, monkeypatch):
        sp = _sp(monkeypatch)
        data = b"some file contents"
        aad = b"attachment:abc.jpg"
        nonce_b64, ct = sp.encrypt_bytes(data, aad)
        assert sp.decrypt_bytes(nonce_b64, ct, aad) == data

    def test_fresh_nonce_per_call(self, monkeypatch):
        sp = _sp(monkeypatch)
        data = b"same data"
        aad = b"same aad"
        n1, ct1 = sp.encrypt_bytes(data, aad)
        n2, ct2 = sp.encrypt_bytes(data, aad)
        assert n1 != n2
        assert ct1 != ct2

    def test_wrong_aad_fails(self, monkeypatch):
        sp = _sp(monkeypatch)
        nonce_b64, ct = sp.encrypt_bytes(b"file", b"correct-aad")
        with pytest.raises(SecurityProviderError, match="authentication failed"):
            sp.decrypt_bytes(nonce_b64, ct, b"wrong-aad")

    def test_tampered_ciphertext_fails(self, monkeypatch):
        sp = _sp(monkeypatch)
        aad = b"aad"
        nonce_b64, ct = sp.encrypt_bytes(b"file", aad)
        tampered = bytearray(ct)
        tampered[5] ^= 0xFF
        with pytest.raises(SecurityProviderError, match="authentication failed"):
            sp.decrypt_bytes(nonce_b64, bytes(tampered), aad)

    def test_wrong_key_fails(self, monkeypatch):
        sp1 = _sp(monkeypatch)
        data = b"file"
        aad = b"aad"
        nonce_b64, ct = sp1.encrypt_bytes(data, aad)
        monkeypatch.setenv("WIMS_MASTER_KEY", _fresh_key_b64())
        sp2 = SecurityProvider()
        with pytest.raises(SecurityProviderError, match="authentication failed"):
            sp2.decrypt_bytes(nonce_b64, ct, aad)

    def test_invalid_key_version_raises(self, monkeypatch):
        sp = _sp(monkeypatch)
        nonce_b64, ct = sp.encrypt_bytes(b"file", b"aad")
        with pytest.raises(SecurityProviderError, match="key_version"):
            sp.decrypt_bytes(nonce_b64, ct, b"aad", key_version=99)

    def test_encrypt_bytes_and_encrypt_json_use_independent_paths(self, monkeypatch):
        """encrypt_bytes must not affect and be unaffected by encrypt_json."""
        sp = _sp(monkeypatch)
        pii = {"caller_name": "Alice"}
        aad_pii = b"incident_id:1"
        nonce_j, ct_j = sp.encrypt_json(pii, aad_pii)
        decrypted_pii = sp.decrypt_json(nonce_j, ct_j, aad_pii)
        assert decrypted_pii == pii

        data = b"raw file bytes"
        nonce_b, ct_b = sp.encrypt_bytes(data, b"attachment:x.jpg")
        assert sp.decrypt_bytes(nonce_b, ct_b, b"attachment:x.jpg") == data


# ════════════════════════════════════════════════════════════════════════════════
# Upload route
# ════════════════════════════════════════════════════════════════════════════════


class TestUploadAttachment:
    def test_on_disk_bytes_are_not_plaintext(self, client, tmp_storage):
        """Bytes written to disk must differ from the original plaintext."""
        plaintext = b"this is evidence photo data"
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: _upload_db()

        from io import BytesIO

        resp = client.post(
            "/api/incidents/1/attachments",
            files={"file": ("photo.jpg", BytesIO(plaintext), "image/jpeg")},
        )
        assert resp.status_code == 201
        written = list(tmp_storage.iterdir())
        assert len(written) == 1
        assert written[0].read_bytes() != plaintext

    def test_is_encrypted_true_and_iv_set(self, client, tmp_storage):
        """INSERT must include is_encrypted=true and a valid 12-byte nonce."""
        mock_db = _upload_db()
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        from io import BytesIO

        resp = client.post(
            "/api/incidents/1/attachments",
            files={"file": ("photo.jpg", BytesIO(b"evidence"), "image/jpeg")},
        )
        assert resp.status_code == 201
        params = _get_insert_params(mock_db)
        assert params["iv"] is not None
        assert len(base64.b64decode(params["iv"])) == 12

    def test_hash_is_sha256_of_plaintext(self, client, tmp_storage):
        """file_hash_sha256 must equal SHA-256 of the original plaintext."""
        plaintext = b"evidence photo"
        expected = hashlib.sha256(plaintext).hexdigest()
        mock_db = _upload_db()
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        from io import BytesIO

        resp = client.post(
            "/api/incidents/1/attachments",
            files={"file": ("photo.jpg", BytesIO(plaintext), "image/jpeg")},
        )
        assert resp.status_code == 201
        params = _get_insert_params(mock_db)
        assert params["hash"] == expected

    def test_key_version_stored(self, client, tmp_storage):
        """key_version must be a positive integer in the INSERT params."""
        mock_db = _upload_db()
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        from io import BytesIO

        resp = client.post(
            "/api/incidents/1/attachments",
            files={"file": ("test.bin", BytesIO(b"data"), "application/octet-stream")},
        )
        assert resp.status_code == 201
        params = _get_insert_params(mock_db)
        assert isinstance(params["kv"], int)
        assert params["kv"] >= 1

    def test_incident_not_found_returns_404(self, client, tmp_storage):
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: _upload_db(incident_exists=False)

        from io import BytesIO

        resp = client.post(
            "/api/incidents/999/attachments",
            files={"file": ("photo.jpg", BytesIO(b"data"), "image/jpeg")},
        )
        assert resp.status_code == 404

    def test_oversize_upload_rejected(self, client, tmp_storage, monkeypatch):
        """Files exceeding MAX_ATTACHMENT_BYTES must be rejected with 413."""
        import api.routes.incidents as incidents_mod

        monkeypatch.setattr(incidents_mod, "MAX_ATTACHMENT_BYTES", 100)
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: _upload_db()

        from io import BytesIO

        resp = client.post(
            "/api/incidents/1/attachments",
            files={"file": ("big.bin", BytesIO(b"x" * 200), "application/octet-stream")},
        )
        assert resp.status_code == 413

    def test_zero_byte_upload_accepted(self, client, tmp_storage):
        """0-byte empty file must be accepted (201) — AES-GCM handles empty plaintext."""
        mock_db = _upload_db()
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        from io import BytesIO

        resp = client.post(
            "/api/incidents/1/attachments",
            files={"file": ("empty.bin", BytesIO(b""), "application/octet-stream")},
        )
        assert resp.status_code == 201
        # Verify file was written to disk (encrypted, not plaintext)
        written = list(tmp_storage.iterdir())
        assert len(written) == 1
        # 0-byte plaintext encrypts to a non-empty ciphertext (auth tag)
        assert len(written[0].read_bytes()) > 0

    def test_exactly_at_max_bytes_accepted(self, client, tmp_storage, monkeypatch):
        """Upload exactly at MAX_ATTACHMENT_BYTES must be accepted (201)."""
        import api.routes.incidents as incidents_mod

        monkeypatch.setattr(incidents_mod, "MAX_ATTACHMENT_BYTES", 100)
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: _upload_db()

        from io import BytesIO

        resp = client.post(
            "/api/incidents/1/attachments",
            files={"file": ("exact.bin", BytesIO(b"x" * 100), "application/octet-stream")},
        )
        assert resp.status_code == 201
        # Verify file was written to disk and is encrypted (differs from plaintext)
        written = list(tmp_storage.iterdir())
        assert len(written) == 1
        assert written[0].read_bytes() != b"x" * 100


# ════════════════════════════════════════════════════════════════════════════════
# Serve route
# ════════════════════════════════════════════════════════════════════════════════


def _make_provider() -> SecurityProvider:
    """Return the running SecurityProvider (uses WIMS_MASTER_KEY from conftest)."""
    return SecurityProvider()


def _encrypt_for_test(plaintext: bytes, unique_filename: str) -> tuple[str, bytes]:
    sp = _make_provider()
    aad = f"attachment:{unique_filename}".encode()
    return sp.encrypt_bytes(plaintext, aad)


def _serve_db(
    storage_path,
    *,
    is_encrypted=True,
    iv=None,
    key_version=1,
    mime="image/jpeg",
    file_name="photo.jpg",
    crypto_provider="env_aesgcm",
):
    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchone.return_value = (
        storage_path,
        iv,
        is_encrypted,
        key_version,
        mime,
        file_name,
        crypto_provider,
    )
    mock_db.execute.return_value = mock_result
    return mock_db


class TestServeAttachment:
    def test_download_roundtrip(self, client, tmp_storage):
        """Serve must return original plaintext from an encrypted file."""
        plaintext = b"original evidence photo bytes"
        uname = "abc123.jpg"
        spath = str(tmp_storage / uname)
        nonce_b64, ct = _encrypt_for_test(plaintext, uname)
        Path(spath).write_bytes(ct)

        mock_db = _serve_db(spath, is_encrypted=True, iv=nonce_b64)
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 200
        assert resp.content == plaintext

    def test_legacy_unencrypted_served_raw(self, client, tmp_storage):
        """is_encrypted=false must be served without any decrypt step."""
        plaintext = b"legacy plaintext attachment"
        spath = str(tmp_storage / "legacy.pdf")
        Path(spath).write_bytes(plaintext)

        mock_db = _serve_db(
            spath, is_encrypted=False, iv=None, mime="application/pdf", file_name="doc.pdf"
        )
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 200
        assert resp.content == plaintext

    def test_tampered_ciphertext_returns_500(self, client, tmp_storage):
        """Bit-flipped ciphertext must return 500 — not crash or leak data."""
        uname = "tampered.jpg"
        spath = str(tmp_storage / uname)
        nonce_b64, ct = _encrypt_for_test(b"evidence", uname)
        tampered = bytearray(ct)
        tampered[10] ^= 0xFF
        Path(spath).write_bytes(bytes(tampered))

        mock_db = _serve_db(spath, is_encrypted=True, iv=nonce_b64)
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 500
        assert "decryption failed" in resp.json()["detail"].lower()

    def test_wrong_nonce_returns_500(self, client, tmp_storage):
        """Mismatched IV in the DB must cause a 500 (auth tag failure)."""
        uname = "wrongiv.jpg"
        spath = str(tmp_storage / uname)
        _, ct = _encrypt_for_test(b"evidence", uname)
        Path(spath).write_bytes(ct)

        bad_nonce = base64.b64encode(os.urandom(12)).decode()
        mock_db = _serve_db(spath, is_encrypted=True, iv=bad_nonce)
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 500
        assert "decryption failed" in resp.json()["detail"].lower()

    def test_attachment_not_found_returns_404(self, client, tmp_storage):
        """Missing DB row must return 404 with handler-level detail (not router 404)."""
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchone.return_value = None
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/999")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Attachment not found"

    def test_missing_file_on_disk_returns_404(self, client, tmp_storage):
        """Row exists but file is gone from disk → 404 with handler-level detail."""
        mock_db = _serve_db("/nonexistent/path/file.jpg", is_encrypted=False, iv=None)
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Attachment file not found on disk"

    def test_civilian_cannot_download(self, client, tmp_storage):
        """CIVILIAN_REPORTER must be rejected with 403."""
        app.dependency_overrides[get_current_wims_user] = _civilian_user
        app.dependency_overrides[get_db_with_rls] = lambda: MagicMock()

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 403

    def test_analyst_can_download(self, client, tmp_storage):
        """NATIONAL_ANALYST must be able to download attachments."""
        plaintext = b"analyst data"
        uname = "analyst.jpg"
        spath = str(tmp_storage / uname)
        nonce_b64, ct = _encrypt_for_test(plaintext, uname)
        Path(spath).write_bytes(ct)

        mock_db = _serve_db(spath, is_encrypted=True, iv=nonce_b64)
        app.dependency_overrides[get_current_wims_user] = _analyst_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 200
        assert resp.content == plaintext

    def test_content_disposition_header_injection_blocked(self, client, tmp_storage):
        """Filename with CRLF, quotes, and control chars must not inject headers."""
        plaintext = b"safe content"
        spath = str(tmp_storage / "safe.bin")
        Path(spath).write_bytes(plaintext)

        # Crafted filename designed to inject a fake header via CRLF + quote escape
        malicious_name = 'test";\r\nX-Injected: evil\r\n.jpg'
        mock_db = _serve_db(
            spath,
            is_encrypted=False,
            iv=None,
            mime="application/octet-stream",
            file_name=malicious_name,
        )
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 200
        cd = resp.headers.get("content-disposition", "")
        # CRLF must be stripped (prevents header injection)
        assert "\r\n" not in cd
        # The header must still be well-formed
        assert cd.startswith("attachment; filename=")
        # Extract the inner filename value (between wrapping quotes)
        import re as _re

        m = _re.match(r'attachment; filename="(.+)"', cd)
        assert m is not None, f"unexpected CD header shape: {cd!r}"
        inner = m.group(1)
        # The malicious double-quote and CRLF must be sanitized out
        assert '"' not in inner, f"unescaped quote in filename value: {inner!r}"
        assert "\r" not in inner
        assert "\n" not in inner

    def test_serve_uses_stored_crypto_provider_env_aesgcm(self, client, tmp_storage):
        """When row has crypto_provider='env_aesgcm', serve must decrypt with SecurityProvider."""
        plaintext = b"provider dispatch test"
        uname = "dispatch_test.jpg"
        spath = str(tmp_storage / uname)
        nonce_b64, ct = _encrypt_for_test(plaintext, uname)
        Path(spath).write_bytes(ct)

        mock_db = _serve_db(spath, is_encrypted=True, iv=nonce_b64, crypto_provider="env_aesgcm")
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 200
        assert resp.content == plaintext

    def test_admin_can_download(self, client, tmp_storage):
        """SYSTEM_ADMIN must be able to download attachments."""
        plaintext = b"admin view data"
        uname = "admin_view.jpg"
        spath = str(tmp_storage / uname)
        nonce_b64, ct = _encrypt_for_test(plaintext, uname)
        Path(spath).write_bytes(ct)

        mock_db = _serve_db(spath, is_encrypted=True, iv=nonce_b64)
        app.dependency_overrides[get_current_wims_user] = _admin_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 200
        assert resp.content == plaintext

    def test_validator_can_download(self, client, tmp_storage):
        """NATIONAL_VALIDATOR must be able to download attachments."""
        plaintext = b"validator view data"
        uname = "validator_view.jpg"
        spath = str(tmp_storage / uname)
        nonce_b64, ct = _encrypt_for_test(plaintext, uname)
        Path(spath).write_bytes(ct)

        mock_db = _serve_db(spath, is_encrypted=True, iv=nonce_b64)
        app.dependency_overrides[get_current_wims_user] = _validator_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 200
        assert resp.content == plaintext

    def test_serve_includes_content_disposition_header(self, client, tmp_storage):
        """Serve must return Content-Disposition header with the stored filename."""
        plaintext = b"file for header test"
        uname = "header_test.jpg"
        spath = str(tmp_storage / uname)
        nonce_b64, ct = _encrypt_for_test(plaintext, uname)
        Path(spath).write_bytes(ct)

        mock_db = _serve_db(spath, is_encrypted=True, iv=nonce_b64, file_name="original_photo.jpg")
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 200
        cd = resp.headers.get("content-disposition", "")
        assert "original_photo.jpg" in cd
        assert cd.startswith("attachment; filename=")

    def test_serve_media_type_matches_stored_mime(self, client, tmp_storage):
        """Serve must return the stored mime_type as the response media_type."""
        plaintext = b"mime type test"
        uname = "mime_test.png"
        spath = str(tmp_storage / uname)
        nonce_b64, ct = _encrypt_for_test(plaintext, uname)
        Path(spath).write_bytes(ct)

        mock_db = _serve_db(spath, is_encrypted=True, iv=nonce_b64, mime="image/png")
        app.dependency_overrides[get_current_wims_user] = _encoder_user
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        resp = client.get("/api/incidents/1/attachments/42")
        assert resp.status_code == 200
        assert resp.headers.get("content-type", "").startswith("image/png")
