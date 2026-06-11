"""
Phase 8 #152 — Live OpenBao KMS integration tests.

Validates real OpenBao Transit operations (health, encrypt/decrypt,
rewrap, backup roundtrip). All tests skip cleanly with a clear message
when OpenBao is unavailable, unconfigured, or unreachable.

No hard dependency on Docker or a running OpenBao instance.
Never logs plaintext, ciphertext, nonces, keys, tokens, or secrets.

Run:
    cd src/backend
    OPENBAO_ADDR=http://openbao:8200 OPENBAO_TOKEN=s.xxx \
    python -m pytest tests/integration/test_openbao_kms_live.py -v --tb=short
"""

from __future__ import annotations

import base64
import os
import secrets

import pytest

# ── Skip logic: detect live OpenBao availability ──────────────────────────────

_live_reason: str | None = None


def _check_openbao_live() -> bool:
    """Return True if OpenBao is configured and reachable.

    Sets the module-level ``_live_reason`` for skip messages.
    """
    global _live_reason

    addr = os.environ.get("OPENBAO_ADDR", "").strip()
    if not addr:
        _live_reason = "OPENBAO_ADDR is not set — live OpenBao tests require configuration"
        return False

    token = os.environ.get("OPENBAO_TOKEN", "")
    role_id = os.environ.get("OPENBAO_ROLE_ID", "")
    secret_id = os.environ.get("OPENBAO_SECRET_ID", "")
    if not token and not (role_id and secret_id):
        _live_reason = (
            "No OpenBao auth configured — set OPENBAO_TOKEN or OPENBAO_ROLE_ID + OPENBAO_SECRET_ID"
        )
        return False

    # Test connectivity
    try:
        import httpx
    except ImportError:
        _live_reason = "httpx not installed — cannot probe OpenBao health"
        return False

    try:
        headers = {}
        if token:
            headers["X-Vault-Token"] = token

        url = addr.rstrip("/") + "/v1/sys/health"
        r = httpx.get(url, headers=headers, timeout=2.0)
        # Accept any non-5xx response (sealed = 503, but initialized)
        if r.status_code >= 500:
            data = (
                r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            )
            if data.get("initialized") is True and data.get("sealed") is True:
                _live_reason = "OpenBao is sealed — unseal it first, then re-run tests"
            else:
                _live_reason = (
                    f"OpenBao health endpoint returned {r.status_code} "
                    f"(unexpected for initialized/unsealed instance)"
                )
            return False
        return True
    except Exception as exc:
        _live_reason = f"OpenBao not reachable at {addr}: {exc}"
        return False


_OPENBAO_LIVE = _check_openbao_live()

requires_openbao_live = pytest.mark.skipif(
    not _OPENBAO_LIVE,
    reason=_live_reason or "OpenBao not available",
)


# ── Import gates ──────────────────────────────────────────────────────────────

try:
    from services.kms.openbao_client import (
        OpenBaoClient,
        OpenBaoClientError,
        KmsCiphertext,
        KmsHealth,
    )
except ImportError:
    pytest.fail("services.kms.openbao_client not importable — Phase 2 code missing")

try:
    from utils.backup_crypto import (
        encrypt_backup,
        decrypt_backup,
        _is_openbao_backup,
    )
except ImportError:
    pytest.fail("utils.backup_crypto not importable — Phase 7 code missing")


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_key_name() -> str:
    """Return the PII key name from env, matching KmsSecurityProvider logic."""
    return (
        os.environ.get("OPENBAO_PII_KEY_NAME")
        or os.environ.get("OPENBAO_TRANSIT_KEY_NAME")
        or "wims-incident-pii"
    )


def _get_backup_key_name() -> str:
    """Return the backup key name from env, matching backup_crypto logic."""
    return os.environ.get("OPENBAO_BACKUP_KEY_NAME", "wims-backup")


def _valid_master_key_b64() -> str:
    """Return a valid base64-encoded 32-byte AES-256 key for legacy fallback."""
    return base64.b64encode(secrets.token_bytes(32)).decode()


# ════════════════════════════════════════════════════════════════════════════════
# Test 1 — Health
# ════════════════════════════════════════════════════════════════════════════════


class TestOpenBaoHealthLive:
    """Verify OpenBao health endpoint returns expected initialized structure."""

    @requires_openbao_live
    def test_openbao_health_live(self):
        """Calls OpenBaoClient.health() and asserts initialized response structure."""
        client = OpenBaoClient()
        health = client.health()

        assert health is not None, "health() must return a KmsHealth struct"
        assert isinstance(health, KmsHealth), (
            f"health() must return KmsHealth, got {type(health).__name__}"
        )
        assert health.initialized is True, (
            "Expected OpenBao to be initialized (health.initialized should be True)"
        )
        assert isinstance(health.version, str) and len(health.version) > 0, (
            f"Expected version string, got {health.version!r}"
        )


# ════════════════════════════════════════════════════════════════════════════════
# Test 2 — Transit encrypt/decrypt roundtrip
# ════════════════════════════════════════════════════════════════════════════════


class TestOpenBaoTransitEncryptDecryptLive:
    """Roundtrip plaintext through OpenBao Transit encrypt → decrypt."""

    @requires_openbao_live
    def test_openbao_transit_encrypt_decrypt_live(self):
        """Encrypt plaintext, decrypt it, assert identity."""
        client = OpenBaoClient()
        key_name = _get_key_name()
        plaintext = b"integration-test-payload-42"
        context = b"integration-test"

        # Encrypt
        result = client.encrypt(key_name, plaintext, context)
        assert isinstance(result, KmsCiphertext), (
            f"encrypt must return KmsCiphertext, got {type(result).__name__}"
        )
        assert len(result.ciphertext) > 0, "ciphertext must not be empty"
        assert result.key_version >= 1, f"key_version must be >= 1, got {result.key_version}"

        # Decrypt
        decrypted = client.decrypt(key_name, result.ciphertext, context)
        assert isinstance(decrypted, bytes), (
            f"decrypt must return bytes, got {type(decrypted).__name__}"
        )
        assert decrypted == plaintext, (
            f"Roundtrip mismatch: expected {plaintext!r}, got {decrypted!r}"
        )

    @requires_openbao_live
    def test_decrypt_wrong_context_fails_live(self):
        """Wrong AAD context must cause decrypt to fail."""
        client = OpenBaoClient()
        key_name = _get_key_name()
        plaintext = b"context-guard-test"
        correct_context = b"integration-test"

        result = client.encrypt(key_name, plaintext, correct_context)
        wrong_context = b"integration-test-evil"

        with pytest.raises(OpenBaoClientError):
            client.decrypt(key_name, result.ciphertext, wrong_context)


# ════════════════════════════════════════════════════════════════════════════════
# Test 3 — Rewrap
# ════════════════════════════════════════════════════════════════════════════════


class TestOpenBaoTransitRewrapLive:
    """Verify rewrap changes the ciphertext but preserves plaintext."""

    @requires_openbao_live
    def test_openbao_transit_rewrap_live(self):
        """Encrypt → rewrap → decrypt; assert ciphertext changed, plaintext preserved."""
        client = OpenBaoClient()
        key_name = _get_key_name()
        plaintext = b"rewrap-integration-test-data"
        context = b"integration-test"

        # Encrypt
        original_ct = client.encrypt(key_name, plaintext, context)
        assert original_ct.key_version >= 1

        # Rewrap
        rewrapped_ct = client.rewrap(key_name, original_ct.ciphertext, context)
        assert isinstance(rewrapped_ct, KmsCiphertext), (
            f"rewrap must return KmsCiphertext, got {type(rewrapped_ct).__name__}"
        )
        assert len(rewrapped_ct.ciphertext) > 0, "rewrapped ciphertext must not be empty"

        # Ciphertext should change (different key version or re-randomized)
        assert rewrapped_ct.ciphertext != original_ct.ciphertext, (
            "rewrap must produce a different ciphertext value"
        )

        # Key version should be >= original (rewrap to latest)
        assert rewrapped_ct.key_version >= original_ct.key_version, (
            f"rewrapped key_version {rewrapped_ct.key_version} "
            f"must be >= original {original_ct.key_version}"
        )

        # Decrypt rewrapped ciphertext
        decrypted = client.decrypt(key_name, rewrapped_ct.ciphertext, context)
        assert decrypted == plaintext, (
            f"Rewrap roundtrip mismatch: expected {plaintext!r}, got {decrypted!r}"
        )


# ════════════════════════════════════════════════════════════════════════════════
# Test 4 — Backup crypto roundtrip
# ════════════════════════════════════════════════════════════════════════════════


class TestOpenBaoBackupCryptoLiveRoundtrip:
    """End-to-end backup encrypt/decrypt roundtrip via OpenBao Transit."""

    @requires_openbao_live
    def test_openbao_backup_crypto_live_roundtrip(self, tmp_path):
        """Encrypt a temp .sql file, decrypt it, verify roundtrip."""
        # Ensure backup provider is set to openbao_transit
        monkeypatch = pytest.MonkeyPatch()
        monkeypatch.setenv("WIMS_BACKUP_CRYPTO_PROVIDER", "openbao_transit")
        monkeypatch.setenv("OPENBAO_ADDR", os.environ["OPENBAO_ADDR"])
        monkeypatch.setenv("OPENBAO_TOKEN", os.environ.get("OPENBAO_TOKEN", ""))
        # Also set OPENBAO_TIMEOUT_SECONDS for faster test
        monkeypatch.setenv("OPENBAO_TIMEOUT_SECONDS", "5.0")

        # Ensure WIMS_MASTER_KEY is not required (we use openbao_transit)
        monkeypatch.delenv("WIMS_MASTER_KEY", raising=False)

        try:
            d = tmp_path / "backups"
            d.mkdir(parents=True, exist_ok=True)

            original = b"live-backup-roundtrip-test\n" * 100  # non-trivial payload

            sql_path = d / "test_live_backup.sql"
            sql_path.write_bytes(original)

            # Encrypt
            enc_path = encrypt_backup(sql_path)
            assert enc_path.suffix == ".enc", f"Expected .enc suffix, got {enc_path.suffix}"
            assert enc_path.exists(), "Encrypted backup file must exist"
            assert not sql_path.exists(), "Original .sql must be removed after encryption"

            # Verify WIMSBAO1 header
            data = enc_path.read_bytes()
            assert _is_openbao_backup(data), "Encrypted backup must start with WIMSBAO1 header"

            # Decrypt
            dec_path = decrypt_backup(enc_path)
            assert dec_path.exists(), "Decrypted backup file must exist"
            assert not enc_path.exists(), "Encrypted .enc must be removed after decryption"

            # Verify roundtrip
            decrypted_data = dec_path.read_bytes()
            assert decrypted_data == original, (
                f"Backup roundtrip mismatch: "
                f"expected {len(original)} bytes, got {len(decrypted_data)} bytes"
            )
        finally:
            monkeypatch.undo()
