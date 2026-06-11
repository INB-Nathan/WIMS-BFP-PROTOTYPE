"""TDD reproduction test for OpenBao KMS client adapter.

Phase 2 of #152: isolate OpenBao Transit API calls behind a small adapter
so backend/celery never imports httpx/hvac directly.
"""

import os

import pytest

# ── Docker dependency check ───────────────────────────────────────────────────
_OPENBAO_AVAILABLE: bool = False
try:
    import httpx  # noqa: F811

    addr = os.environ.get("OPENBAO_ADDR", "")
    if addr:
        r = httpx.get(addr.rstrip("/") + "/sys/health", timeout=1.0)
        _OPENBAO_AVAILABLE = r.status_code < 500
except Exception:
    pass

requires_openbao = pytest.mark.skipif(
    not _OPENBAO_AVAILABLE,
    reason="OpenBao not available — requires Docker (docker compose up openbao)",
)

# ── Import gate ───────────────────────────────────────────────────────────────

try:
    from services.kms.openbao_client import (
        OpenBaoClient,
        OpenBaoClientError,
    )
except ImportError:
    pytest.fail(
        "services.kms.openbao_client not importable — implement it first "
        "(spec: docs/specs/openbao-kms-integration.md § 'Client methods')"
    )


# ── Test contract ────────────────────────────────────────────────────────────


class TestOpenBaoClientInterface:
    """
    The OpenBaoClient must expose the 6-method contract defined in the spec
    and read its configuration from environment variables, never hardcoded
    values.
    """

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _env(monkeypatch) -> dict[str, str]:
        """Set the minimum env vars needed to construct an OpenBaoClient."""
        vars_ = {
            "OPENBAO_ADDR": "http://openbao:8200",
            "OPENBAO_TOKEN": "s.fake-devtoken",
            "OPENBAO_TRANSIT_MOUNT": "transit",
            "OPENBAO_PII_KEY_NAME": "wims-incident-pii",
            "OPENBAO_BACKUP_KEY_NAME": "wims-backup",
            "OPENBAO_TIMEOUT_SECONDS": "2.0",
        }
        for k, v in vars_.items():
            monkeypatch.setenv(k, v)
        return vars_

    # ── construction ─────────────────────────────────────────────────────────

    def test_constructs_from_env_vars(self, monkeypatch):
        """Smoke: client builds without errors when all env vars are present."""
        self._env(monkeypatch)
        client = OpenBaoClient()
        assert client is not None

    def test_missing_addr_raises_clear_error(self, monkeypatch):
        """OPENBAO_ADDR required; fail early with a readable message."""
        self._env(monkeypatch)
        monkeypatch.delenv("OPENBAO_ADDR", raising=False)
        with pytest.raises(OpenBaoClientError, match="OPENBAO_ADDR"):
            OpenBaoClient()

    def test_missing_token_raises(self, monkeypatch):
        """Token or AppRole must be configured."""
        self._env(monkeypatch)
        monkeypatch.delenv("OPENBAO_TOKEN", raising=False)
        monkeypatch.delenv("OPENBAO_ROLE_ID", raising=False)
        with pytest.raises(OpenBaoClientError, match="token|auth"):
            OpenBaoClient()

    def test_timeout_defaults_to_2_seconds(self, monkeypatch):
        """Spec says default timeout = 2.0s unless OPENBAO_TIMEOUT_SECONDS set."""
        self._env(monkeypatch)
        monkeypatch.delenv("OPENBAO_TIMEOUT_SECONDS", raising=False)
        client = OpenBaoClient()
        assert client.timeout == 2.0

    def test_timeout_honors_env_override(self, monkeypatch):
        """Operator can raise the timeout for slow networks."""
        self._env(monkeypatch)
        monkeypatch.setenv("OPENBAO_TIMEOUT_SECONDS", "5.0")
        client = OpenBaoClient()
        assert client.timeout == 5.0

    # ── method presence ─────────────────────────────────────────────────────

    def test_exposes_six_method_contract(self, monkeypatch):
        """
        Verify public surface matches the spec doc:

            health() -> KmsHealth
            encrypt(key_name, plaintext, context) -> KmsCiphertext
            decrypt(key_name, ciphertext, context) -> bytes
            rotate(key_name) -> KeyMetadata
            rewrap(key_name, ciphertext, context) -> KmsCiphertext
            metadata(key_name) -> KeyMetadata
        """
        self._env(monkeypatch)
        client = OpenBaoClient()
        for method in ("health", "encrypt", "decrypt", "rotate", "rewrap", "metadata"):
            assert hasattr(client, method), (
                f"OpenBaoClient must expose {method}() — see spec § 'Client methods'"
            )
            assert callable(getattr(client, method)), f"{method} must be callable"

    # ── PII encrypt/decrypt contract ────────────────────────────────────────

    @requires_openbao
    def test_encrypt_decrypt_roundtrip_happy_path(self, monkeypatch):
        """Roundtrip encrypt → decrypt using wims-incident-pii key."""
        self._env(monkeypatch)
        client = OpenBaoClient()

        plaintext = b"test-incident-pii-payload"
        context = b"incident_id:42"

        ciphertext = client.encrypt(
            os.environ["OPENBAO_PII_KEY_NAME"],
            plaintext,
            context,
        )
        assert hasattr(ciphertext, "ciphertext")
        assert hasattr(ciphertext, "key_version")

        decrypted = client.decrypt(
            os.environ["OPENBAO_PII_KEY_NAME"],
            ciphertext.ciphertext,
            context,
        )
        assert decrypted == plaintext, "decrypted payload must match original plaintext"

    # ── context / AAD mismatch ──────────────────────────────────────────────

    @requires_openbao
    def test_decrypt_wrong_context_fails(self, monkeypatch):
        """Authentication context must match — wrong context = decrypt failure."""
        self._env(monkeypatch)
        client = OpenBaoClient()

        plaintext = b"sensitive-data"
        context = b"incident_id:1"

        ciphertext = client.encrypt(
            os.environ["OPENBAO_PII_KEY_NAME"],
            plaintext,
            context,
        )

        wrong_context = b"incident_id:999"
        with pytest.raises(OpenBaoClientError, match="context|auth|decrypt"):
            client.decrypt(
                os.environ["OPENBAO_PII_KEY_NAME"],
                ciphertext.ciphertext,
                wrong_context,
            )

    # ── health ──────────────────────────────────────────────────────────────

    @requires_openbao
    def test_health_returns_structured_response(self, monkeypatch):
        """health() must not be None; struct exposes initialized/sealed/standby."""
        self._env(monkeypatch)
        client = OpenBaoClient()
        health = client.health()
        assert health is not None
