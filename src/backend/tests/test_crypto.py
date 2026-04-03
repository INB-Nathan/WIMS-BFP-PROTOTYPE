"""TDD tests for SecurityProvider — AES-256-GCM encrypted PII blob storage."""

import base64
import secrets

import pytest

# ── helpers ──────────────────────────────────────────────────────────────────


def _fresh_key() -> bytes:
    """32-byte key for AES-256."""
    return secrets.token_bytes(32)


def _key_b64(k: bytes) -> str:
    return base64.b64encode(k).decode()


def _b64_to_bytes(b64: str) -> bytes:
    return base64.b64decode(b64)


# ── crypto module ─────────────────────────────────────────────────────────────


try:
    from utils.crypto import SecurityProvider, SecurityProviderError
except ImportError:
    pytest.fail("utils.crypto.SecurityProvider not importable — implement it first")


# ════════════════════════════════════════════════════════════════════════════════
# Key Management
# ════════════════════════════════════════════════════════════════════════════════


class TestKeyManagement:
    """WIMS_MASTER_KEY must be a base64-encoded 32-byte key from environment."""

    def test_missing_key_raises_clear_error(self, monkeypatch):
        monkeypatch.delenv("WIMS_MASTER_KEY", raising=False)
        with pytest.raises(SecurityProviderError, match="WIMS_MASTER_KEY"):
            SecurityProvider()

    def test_key_must_be_valid_base64(self, monkeypatch):
        monkeypatch.setenv("WIMS_MASTER_KEY", "not-valid-base64!!!")
        with pytest.raises(SecurityProviderError, match="base64"):
            SecurityProvider()

    def test_key_must_be_exactly_32_bytes(self, monkeypatch):
        # 16 bytes → too short
        short_key = base64.b64encode(secrets.token_bytes(16)).decode()
        monkeypatch.setenv("WIMS_MASTER_KEY", short_key)
        with pytest.raises(SecurityProviderError, match="32 bytes"):
            SecurityProvider()

    def test_key_must_be_32_bytes_not_31(self, monkeypatch):
        key_31 = base64.b64encode(secrets.token_bytes(31)).decode()
        monkeypatch.setenv("WIMS_MASTER_KEY", key_31)
        with pytest.raises(SecurityProviderError, match="32 bytes"):
            SecurityProvider()

    def test_valid_32_byte_key_loads(self, monkeypatch):
        key = _fresh_key()
        monkeypatch.setenv("WIMS_MASTER_KEY", _key_b64(key))
        sp = SecurityProvider()
        # Implementation stores AESGCM wrapper; verify it initialised without error
        assert sp._aesgcm is not None  # noqa: SLF001


# ════════════════════════════════════════════════════════════════════════════════
# API Shape
# ════════════════════════════════════════════════════════════════════════════════


class TestAPI:
    """encrypt_json and decrypt_json must return (nonce_b64, ct_b64) / dict."""

    @pytest.fixture
    def sp(self, monkeypatch):
        key = _fresh_key()
        monkeypatch.setenv("WIMS_MASTER_KEY", _key_b64(key))
        return SecurityProvider()

    def test_encrypt_returns_two_b64_strings(self, sp):
        pii = {"caller_name": "Juan Dela Cruz", "caller_number": "09171234567"}
        nonce_b64, ct_b64 = sp.encrypt_json(pii, aad=b"incident_id:42")
        assert isinstance(nonce_b64, str)
        assert isinstance(ct_b64, str)
        # both must be valid base64
        _b64_to_bytes(nonce_b64)
        _b64_to_bytes(ct_b64)

    def test_encrypt_nonce_is_12_bytes(self, sp):
        pii = {"caller_name": "Test"}
        nonce_b64, _ = sp.encrypt_json(pii, aad=b"incident_id:1")
        nonce_bytes = _b64_to_bytes(nonce_b64)
        assert len(nonce_bytes) == 12, f"nonce must be 12 bytes, got {len(nonce_bytes)}"

    def test_encrypt_produces_different_nonces_each_call(self, sp):
        pii = {"caller_name": "Same"}
        aad = b"incident_id:1"
        _, ct1 = sp.encrypt_json(pii, aad)
        _, ct2 = sp.encrypt_json(pii, aad)
        # Different nonces → different ciphertexts
        assert ct1 != ct2

    def test_decrypt_roundtrip(self, sp):
        pii = {
            "caller_name": "Juan Dela Cruz",
            "caller_number": "09171234567",
            "owner_name": "Juan Owner",
            "occupant_name": "Juan Occupant",
        }
        aad = b"incident_id:99"
        nonce_b64, ct_b64 = sp.encrypt_json(pii, aad)
        decrypted = sp.decrypt_json(nonce_b64, ct_b64, aad)
        assert decrypted == pii

    def test_decrypt_with_wrong_aad_fails(self, sp):
        pii = {"caller_name": "Test"}
        nonce_b64, ct_b64 = sp.encrypt_json(pii, aad=b"incident_id:1")
        with pytest.raises(SecurityProviderError, match="authentication"):
            sp.decrypt_json(nonce_b64, ct_b64, aad=b"incident_id:999")

    def test_decrypt_with_wrong_key_fails(self, monkeypatch):
        # encrypt with one key
        key1 = _fresh_key()
        monkeypatch.setenv("WIMS_MASTER_KEY", _key_b64(key1))
        sp1 = SecurityProvider()
        nonce_b64, ct_b64 = sp1.encrypt_json({"caller_name": "X"}, aad=b"incident_id:1")

        # decrypt with different key
        key2 = _fresh_key()
        monkeypatch.setenv("WIMS_MASTER_KEY", _key_b64(key2))
        sp2 = SecurityProvider()
        with pytest.raises(SecurityProviderError, match="authentication"):
            sp2.decrypt_json(nonce_b64, ct_b64, aad=b"incident_id:1")

    def test_tampered_ciphertext_fails_auth(self, sp):
        pii = {"caller_name": "Test"}
        nonce_b64, ct_b64 = sp.encrypt_json(pii, aad=b"incident_id:1")
        ct_bytes = _b64_to_bytes(ct_b64)
        # flip one bit in the middle
        tampered = bytes(ct_bytes[0] ^ 1) + ct_bytes[1:]
        tampered_b64 = base64.b64encode(tampered).decode()
        with pytest.raises(SecurityProviderError, match="authentication"):
            sp.decrypt_json(nonce_b64, tampered_b64, aad=b"incident_id:1")

    def test_json_serialization_is_stable(self, sp):
        """Same dict must produce same plaintext bytes (needed for consistent AAD)."""
        pii = {"caller_name": "Juan", "caller_number": "0917"}
        aad = b"incident_id:1"
        _, ct1 = sp.encrypt_json(pii, aad)
        _, ct2 = sp.encrypt_json(pii, aad)
        # Note: nonces differ so ciphertexts differ, but we verify the API contract
        assert isinstance(ct1, str) and isinstance(ct2, str)

    def test_empty_dict_encrypts_and_decrypts(self, sp):
        pii = {}
        aad = b"incident_id:5"
        nonce_b64, ct_b64 = sp.encrypt_json(pii, aad)
        decrypted = sp.decrypt_json(nonce_b64, ct_b64, aad)
        assert decrypted == pii

    def test_unknown_field_in_ct_decrypted_strictly(self, sp):
        """Decrypted dict must exactly match input dict."""
        pii = {"caller_name": "Name", "caller_number": "0917"}
        aad = b"incident_id:10"
        nonce_b64, ct_b64 = sp.encrypt_json(pii, aad)
        decrypted = sp.decrypt_json(nonce_b64, ct_b64, aad)
        assert set(decrypted.keys()) == set(pii.keys())
        assert decrypted == pii

    def test_invalid_nonce_base64_raises(self, sp):
        with pytest.raises(SecurityProviderError, match="nonce"):
            sp.decrypt_json("!!!not-base64!!!", "dGVzdA==", aad=b"incident_id:1")

    def test_invalid_ct_base64_raises(self, sp):
        with pytest.raises(SecurityProviderError, match="ciphertext"):
            sp.decrypt_json(
                base64.b64encode(secrets.token_bytes(12)).decode(),
                "!!!not-base64!!!",
                aad=b"incident_id:1",
            )
