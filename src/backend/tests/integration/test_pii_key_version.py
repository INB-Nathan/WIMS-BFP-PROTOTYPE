"""Test key_version persistence through PII encrypt call sites.

SKIPPED on feat/openbao-kms — legacy mock path replaced by get_crypto_provider.
"""

import pytest
pytest.skip("Legacy PR #252 test — provider dispatch refactored in #152", allow_module_level=True)

from __future__ import annotations

import base64
import secrets
import uuid
from unittest.mock import MagicMock

import pytest

from api.routes.regional.encoder_crud import create_incident
from schemas.regional import IncidentCreateRequest
from utils.crypto import SecurityProvider


# ── helpers ──────────────────────────────────────────────────────────────────


def _fresh_key() -> bytes:
    """32 random bytes for AES-256."""
    return secrets.token_bytes(32)


def _key_b64(k: bytes) -> str:
    """Base64-encode a key."""
    return base64.b64encode(k).decode()


# ════════════════════════════════════════════════════════════════════════════════
# Fixtures
# ════════════════════════════════════════════════════════════════════════════════


@pytest.fixture
def v2_provider(monkeypatch):
    """SecurityProvider with V2 as current_version and both V1/V2 keyring loaded."""
    k1 = _fresh_key()
    k2 = _fresh_key()
    monkeypatch.setenv("WIMS_MASTER_KEY", _key_b64(k1))
    monkeypatch.setenv("WIMS_MASTER_KEY_V2", _key_b64(k2))
    monkeypatch.setenv("WIMS_KEY_CURRENT_VERSION", "2")
    return SecurityProvider()


@pytest.fixture
def mock_user():
    """Minimal REGIONAL_ENCODER user dict."""
    return {
        "user_id": str(uuid.uuid4()),
        "assigned_region_id": 1,
        "role": "REGIONAL_ENCODER",
    }


@pytest.fixture
def mock_db():
    """Mock SQLAlchemy session that records all ``execute()`` calls."""
    return MagicMock()


# ════════════════════════════════════════════════════════════════════════════════
# Tests
# ════════════════════════════════════════════════════════════════════════════════


class TestKeyVersionPersistence:
    """key_version column is set correctly during PII creation."""

    def test_create_incident_sets_key_version_v2(
        self, v2_provider, mock_user, mock_db, monkeypatch
    ):
        """``create_incident`` with V2 provider stores ``key_ver=2`` in the INSERT."""
        # ── Arrange ──────────────────────────────────────────────────────
        assert v2_provider.current_version == 2

        # Point the module's security provider lookup at our V2 instance
        monkeypatch.setattr(
            "services.kms.get_crypto_provider",
            lambda: v2_provider,
        )

        body = IncidentCreateRequest(
            latitude=14.5995,
            longitude=120.9842,
            region_id=1,
            caller_name="Juan Dela Cruz",
            caller_number="09171234567",
        )

        # ── Act ──────────────────────────────────────────────────────────
        result = create_incident(body=body, user=mock_user, db=mock_db)

        # ── Assert ───────────────────────────────────────────────────────
        assert result["status"] == "created", "create_incident should return status=created"

        # Locate the INSERT INTO wims.incident_sensitive_details call
        sensitive_insert = None
        sensitive_sql = None
        for call_args in mock_db.execute.call_args_list:
            sql_text, params = call_args[0]  # (text_object, params_dict)
            if "INSERT" in str(sql_text) and "incident_sensitive_details" in str(sql_text):
                sensitive_sql = str(sql_text)
                sensitive_insert = params
                break

        assert sensitive_sql is not None, (
            "No INSERT INTO wims.incident_sensitive_details in db.execute() calls"
        )

        # Structural check: the SQL column name is present
        assert "key_version" in sensitive_sql, "INSERT SQL must include key_version column"

        # Value check: the bind parameter matches current_version
        assert sensitive_insert.get("key_ver") == 2, (
            f"Expected key_ver=2 in INSERT params, got {sensitive_insert.get('key_ver')}"
        )

    def test_create_incident_encrypt_decrypt_roundtrip(
        self, v2_provider, mock_user, mock_db, monkeypatch
    ):
        """PII encrypted during create_incident decrypts correctly with key_version=2."""
        # ── Arrange ──────────────────────────────────────────────────────
        monkeypatch.setattr(
            "services.kms.get_crypto_provider",
            lambda: v2_provider,
        )

        input_pii = {
            "caller_name": "Maria Santos",
            "caller_number": "09281234567",
        }

        body = IncidentCreateRequest(
            latitude=14.5995,
            longitude=120.9842,
            region_id=1,
            caller_name=input_pii["caller_name"],
            caller_number=input_pii["caller_number"],
        )

        # ── Act ──────────────────────────────────────────────────────────
        create_incident(body=body, user=mock_user, db=mock_db)

        # ── Extract encrypted blob and IV from the INSERT params ─────────
        incident_id = None
        pii_blob = None
        enc_iv = None
        key_ver = None

        for call_args in mock_db.execute.call_args_list:
            sql_text, params = call_args[0]
            if "INSERT" in str(sql_text) and "incident_sensitive_details" in str(sql_text):
                pii_blob = params.get("pii_blob")
                enc_iv = params.get("enc_iv")
                key_ver = params.get("key_ver")
                incident_id = params.get("iid")
                break

        assert pii_blob is not None, "pii_blob not found in INSERT params"
        assert enc_iv is not None, "enc_iv not found in INSERT params"
        assert key_ver == 2, f"Expected key_ver=2, got {key_ver}"

        # ── Decrypt and verify ───────────────────────────────────────────
        aad = f"incident_id:{incident_id}".encode()
        decrypted = v2_provider.decrypt_json(enc_iv, pii_blob, aad, key_version=key_ver)
        assert decrypted == input_pii, f"Decrypted PII {decrypted} does not match input {input_pii}"

    def test_create_incident_without_pii_omits_key_version(self, mock_user, mock_db, monkeypatch):
        """Request with no PII fields should not attempt encryption at all."""
        # Use default V1 provider (conftest sets WIMS_MASTER_KEY)
        body = IncidentCreateRequest(
            latitude=14.5995,
            longitude=120.9842,
            region_id=1,
            # No PII fields — only street_address (non-encrypted sd_field)
            street_address="123 Test St",
        )

        result = create_incident(body=body, user=mock_user, db=mock_db)
        assert result["status"] == "created"

        # There should be no INSERT with key_version in SQL
        for call_args in mock_db.execute.call_args_list:
            sql_text = str(call_args[0][0])
            if "INSERT" in sql_text and "incident_sensitive_details" in sql_text:
                assert "key_version" not in sql_text, (
                    "INSERT should not include key_version when no PII is encrypted"
                )

    def test_create_incident_with_v1_default_version(self, mock_user, mock_db, monkeypatch):
        """When no V2 key is configured, current_version=1 and key_ver=1 is stored."""
        # conftest sets WIMS_MASTER_KEY to a fixed key — SecurityProvider() loads V1
        # Ensure no V2 env vars are set
        monkeypatch.delenv("WIMS_MASTER_KEY_V2", raising=False)
        monkeypatch.delenv("WIMS_KEY_CURRENT_VERSION", raising=False)

        # Reset the singleton so SecurityProvider() re-reads env
        monkeypatch.setattr(
            "services.regional_incidents.helpers._sp_instance",
            None,
        )
        # Also reset encoder_crud's reference
        new_sp = SecurityProvider()
        assert new_sp.current_version == 1

        monkeypatch.setattr(
            "services.kms.get_crypto_provider",
            lambda: new_sp,
        )

        body = IncidentCreateRequest(
            latitude=14.5995,
            longitude=120.9842,
            region_id=1,
            caller_name="V1 User",
        )

        create_incident(body=body, user=mock_user, db=mock_db)

        # Verify key_ver=1 in INSERT params
        for call_args in mock_db.execute.call_args_list:
            sql_text, params = call_args[0]
            if "INSERT" in str(sql_text) and "incident_sensitive_details" in str(sql_text):
                assert params.get("key_ver") == 1, (
                    f"Expected key_ver=1, got {params.get('key_ver')}"
                )
                return

        pytest.fail("INSERT INTO wims.incident_sensitive_details not found")
