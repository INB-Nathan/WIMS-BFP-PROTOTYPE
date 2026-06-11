"""Unit tests for get_crypto_provider dispatch and KmsSecurityProvider.

Phase 3 of #152: verify provider selection logic and client call shaping
without requiring a live OpenBao instance.
"""

import base64
import json
import secrets
from unittest.mock import MagicMock

import pytest


# ── Import gates ──────────────────────────────────────────────────────────────

try:
    from services.kms import get_crypto_provider
    from services.kms.openbao_client import (
        KmsSecurityProvider,
        OpenBaoClientError,
        OpenBaoClient,
        KmsCiphertext,
    )
    from utils.crypto import SecurityProvider
except ImportError:
    pytest.fail("services.kms not importable — ensure Phase 2 client exists")


# ── Helpers ───────────────────────────────────────────────────────────────────


def _valid_master_key() -> str:
    """Return a valid base64-encoded 32-byte AES-256 key."""
    return base64.b64encode(secrets.token_bytes(32)).decode()


def _dummy_openbao_client() -> MagicMock:
    """Return a mocked OpenBaoClient suitable for unit tests."""
    mock = MagicMock(spec=OpenBaoClient)
    mock.encrypt.return_value = KmsCiphertext(
        ciphertext="vault:v1:abc123",
        key_version=3,
    )
    mock.decrypt.return_value = json.dumps(
        {"caller_name": "Juan", "caller_number": "0917"},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return mock


# ════════════════════════════════════════════════════════════════════════════════
# get_crypto_provider dispatch
# ════════════════════════════════════════════════════════════════════════════════


class TestGetCryptoProvider:
    """Provider selection must respect row metadata first, then env, with
    sensible defaults that keep legacy env_aesgcm behaviour unchanged."""

    def test_no_row_no_env_var_returns_env_aesgcm(self, monkeypatch):
        """Default without any configuration is env_aesgcm."""
        monkeypatch.delenv("WIMS_CRYPTO_PROVIDER", raising=False)
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())
        provider = get_crypto_provider()
        assert isinstance(provider, SecurityProvider)
        assert provider.crypto_provider == "env_aesgcm"

    def test_env_openbao_transit_returns_kms(self, monkeypatch):
        """WIMS_CRYPTO_PROVIDER=openbao_transit → KmsSecurityProvider."""
        monkeypatch.setenv("WIMS_CRYPTO_PROVIDER", "openbao_transit")
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        provider = get_crypto_provider()
        assert isinstance(provider, KmsSecurityProvider)
        assert provider.crypto_provider == "openbao_transit"

    def test_row_openbao_transit_overrides_env(self, monkeypatch):
        """Row crypto_provider='openbao_transit' wins even when env says env_aesgcm."""
        monkeypatch.setenv("WIMS_CRYPTO_PROVIDER", "env_aesgcm")
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        provider = get_crypto_provider({"crypto_provider": "openbao_transit"})
        assert isinstance(provider, KmsSecurityProvider)

    def test_row_env_aesgcm_returns_env_aesgcm(self, monkeypatch):
        """Explicit env_aesgcm row → SecurityProvider."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())
        provider = get_crypto_provider({"crypto_provider": "env_aesgcm"})
        assert isinstance(provider, SecurityProvider)
        assert provider.crypto_provider == "env_aesgcm"

    def test_row_none_crypto_provider_falls_back_to_env(self, monkeypatch):
        """Row with crypto_provider=None → env fallback."""
        monkeypatch.setenv("WIMS_CRYPTO_PROVIDER", "env_aesgcm")
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())
        provider = get_crypto_provider({"crypto_provider": None})
        assert isinstance(provider, SecurityProvider)

    def test_unknown_env_provider_raises(self, monkeypatch):
        """Bogus WIMS_CRYPTO_PROVIDER must raise a clear error."""
        monkeypatch.setenv("WIMS_CRYPTO_PROVIDER", "bogus_hsm")
        monkeypatch.setenv("WIMS_MASTER_KEY", "AAAA" + "A" * 40 + "==")
        with pytest.raises(OpenBaoClientError, match="bogus_hsm"):
            get_crypto_provider()

    def test_unknown_row_provider_raises(self, monkeypatch):
        """Bogus row crypto_provider must raise a clear error."""
        monkeypatch.setenv("WIMS_MASTER_KEY", "AAAA" + "A" * 40 + "==")
        with pytest.raises(OpenBaoClientError, match="bogus_hsm"):
            get_crypto_provider({"crypto_provider": "bogus_hsm"})


# ════════════════════════════════════════════════════════════════════════════════
# KmsSecurityProvider contract
# ════════════════════════════════════════════════════════════════════════════════


class TestKmsSecurityProvider:
    """KmsSecurityProvider must present encrypt_json/decrypt_json matching
    SecurityProvider's tuple/dict return shape, while delegating to
    OpenBaoClient internally."""

    def test_encrypt_json_returns_sentinel_nonce_and_ciphertext(self, monkeypatch):
        """encrypt_json returns (NONCE_SENTINEL, ciphertext) shaped like
        SecurityProvider's (nonce_b64, ct_b64)."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        mock_client = _dummy_openbao_client()
        ksp = KmsSecurityProvider(client=mock_client)

        nonce, ct = ksp.encrypt_json(
            {"caller_name": "Test"},
            b"incident_id:42",
        )

        assert nonce == ksp.NONCE_SENTINEL
        assert ct == "vault:v1:abc123"
        mock_client.encrypt.assert_called_once()
        # key_name must be the env default or explicit
        args, kwargs = mock_client.encrypt.call_args
        assert args[0] == ksp.kms_key_name

    def test_encrypt_json_serializes_json_deterministically(self, monkeypatch):
        """Plaintext is json.dumps(..., sort_keys=True, separators) bytes."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        mock_client = _dummy_openbao_client()
        ksp = KmsSecurityProvider(client=mock_client)

        pii = {"caller_name": "Juan", "owner_name": "Owner"}
        ksp.encrypt_json(pii, b"incident_id:1")

        args, _ = mock_client.encrypt.call_args
        plaintext_sent = args[1]  # second positional arg is plaintext bytes
        # reconstruct: should be same shape as SecurityProvider uses
        expected = json.dumps(pii, sort_keys=True, separators=(",", ":")).encode("utf-8")
        assert plaintext_sent == expected

    def test_decrypt_json_ignores_nonce_returns_dict(self, monkeypatch):
        """decrypt_json ignores nonce value and returns parsed dict."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        mock_client = _dummy_openbao_client()
        ksp = KmsSecurityProvider(client=mock_client)

        result = ksp.decrypt_json(
            nonce_b64="SHOULD_BE_IGNORED",
            ct_b64="vault:v1:abc123",
            aad=b"incident_id:42",
        )

        assert isinstance(result, dict)
        assert result == {"caller_name": "Juan", "caller_number": "0917"}
        mock_client.decrypt.assert_called_once()

    def test_decrypt_json_accepts_none_nonce(self, monkeypatch):
        """decrypt_json handles None nonce gracefully (OpenBao rows have NULL iv)."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        mock_client = _dummy_openbao_client()
        ksp = KmsSecurityProvider(client=mock_client)

        result = ksp.decrypt_json(
            nonce_b64=None,
            ct_b64="vault:v1:abc123",
            aad=b"incident_id:42",
        )

        assert isinstance(result, dict)

    def test_current_version_tracked_after_encrypt(self, monkeypatch):
        """current_version is updated from KmsCiphertext.key_version after encrypt."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        mock_client = _dummy_openbao_client()
        ksp = KmsSecurityProvider(client=mock_client)

        assert ksp.current_version == 1  # default
        ksp.encrypt_json({"caller_name": "Test"}, b"incident_id:1")
        assert ksp.current_version == 3  # from mock's KmsCiphertext.key_version

    def test_key_name_env_precedence(self, monkeypatch):
        """OPENBAO_PII_KEY_NAME takes precedence over OPENBAO_TRANSIT_KEY_NAME."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.setenv("OPENBAO_PII_KEY_NAME", "pii-key")
        monkeypatch.setenv("OPENBAO_TRANSIT_KEY_NAME", "transit-key")

        ksp = KmsSecurityProvider(client=_dummy_openbao_client())
        assert ksp.kms_key_name == "pii-key"

    def test_key_name_fallback_to_transit_key(self, monkeypatch):
        """Without OPENBAO_PII_KEY_NAME, OPENBAO_TRANSIT_KEY_NAME is used."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.delenv("OPENBAO_PII_KEY_NAME", raising=False)
        monkeypatch.setenv("OPENBAO_TRANSIT_KEY_NAME", "transit-key")

        ksp = KmsSecurityProvider(client=_dummy_openbao_client())
        assert ksp.kms_key_name == "transit-key"

    def test_key_name_default(self, monkeypatch):
        """When neither env var is set, default to wims-incident-pii."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.delenv("OPENBAO_PII_KEY_NAME", raising=False)
        monkeypatch.delenv("OPENBAO_TRANSIT_KEY_NAME", raising=False)

        ksp = KmsSecurityProvider(client=_dummy_openbao_client())
        assert ksp.kms_key_name == "wims-incident-pii"

    def test_encrypt_passes_aad_as_context(self, monkeypatch):
        """AAD bytes are passed as context to OpenBao encrypt."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        mock_client = _dummy_openbao_client()
        ksp = KmsSecurityProvider(client=mock_client)

        aad = b"incident_id:99"
        ksp.encrypt_json({"caller_name": "Test"}, aad)

        # aad is passed as third positional arg (context)
        args, _ = mock_client.encrypt.call_args
        assert args[2] == aad

    def test_decrypt_passes_aad_as_context(self, monkeypatch):
        """AAD bytes are passed as context to OpenBao decrypt."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        mock_client = _dummy_openbao_client()
        ksp = KmsSecurityProvider(client=mock_client)

        aad = b"incident_id:99"
        ksp.decrypt_json(None, "vault:v1:abc123", aad)

        # aad is passed as third positional arg (context)
        args, _ = mock_client.decrypt.call_args
        assert args[2] == aad

    def test_crypto_provider_property(self, monkeypatch):
        """crypto_provider returns 'openbao_transit'."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        ksp = KmsSecurityProvider(client=_dummy_openbao_client())
        assert ksp.crypto_provider == "openbao_transit"
        assert ksp.PROVIDER == "openbao_transit"

    def test_encrypt_error_becomes_openbao_client_error(self, monkeypatch):
        """OpenBao encrypt errors are mapped to OpenBaoClientError."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        mock_client = MagicMock(spec=OpenBaoClient)
        mock_client.encrypt.side_effect = OpenBaoClientError("encrypt failed")
        ksp = KmsSecurityProvider(client=mock_client)

        with pytest.raises(OpenBaoClientError, match="encrypt failed"):
            ksp.encrypt_json({"caller_name": "Test"}, b"incident_id:1")

    def test_decrypt_error_becomes_openbao_client_error(self, monkeypatch):
        """OpenBao decrypt errors are mapped to OpenBaoClientError."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        mock_client = MagicMock(spec=OpenBaoClient)
        mock_client.decrypt.side_effect = OpenBaoClientError("decrypt failed")
        ksp = KmsSecurityProvider(client=mock_client)

        with pytest.raises(OpenBaoClientError, match="decrypt failed"):
            ksp.decrypt_json(None, "vault:v1:abc123", b"incident_id:1")


# ════════════════════════════════════════════════════════════════════════════════
# SecurityProvider backward compatibility
# ════════════════════════════════════════════════════════════════════════════════


class TestSecurityProviderMetadata:
    """SecurityProvider must expose crypto_provider/kms_key_name for
    provider-agnostic write paths."""

    def test_crypto_provider_is_env_aesgcm(self, monkeypatch):
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())
        sp = SecurityProvider()
        assert sp.crypto_provider == "env_aesgcm"

    def test_kms_key_name_is_none(self, monkeypatch):
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())
        sp = SecurityProvider()
        assert sp.kms_key_name is None
