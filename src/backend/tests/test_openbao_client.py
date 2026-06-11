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


# ── URL routing tests: sys calls bypass transit mount ────────────────────────


class TestOpenBaoClientRouting:
    """Verify that _url_for builds correct URLs for sys vs Transit paths.

    Regression guard for: health endpoint accidentally routed through
    /v1/transit/sys/health instead of /v1/sys/health.
    """

    # ── helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _client(monkeypatch, mount: str = "transit") -> OpenBaoClient:
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.fake-token")
        monkeypatch.setenv("OPENBAO_TRANSIT_MOUNT", mount)
        return OpenBaoClient()

    # ── health / sys paths ───────────────────────────────────────────────

    def test_health_url_uses_sys_prefix(self, monkeypatch):
        """health() → /v1/sys/health, NOT /v1/transit/sys/health."""
        client = self._client(monkeypatch)
        url = client._url_for("/sys/health")
        assert url == "http://openbao:8200/v1/sys/health"
        assert "/transit" not in url

    def test_sys_paths_bypass_mount(self, monkeypatch):
        """All /sys/* paths bypass the Transit mount prefix."""
        client = self._client(monkeypatch)
        assert client._url_for("/sys/seal-status") == "http://openbao:8200/v1/sys/seal-status"
        assert client._url_for("/sys/leader") == "http://openbao:8200/v1/sys/leader"
        assert client._url_for("/sys/metrics") == "http://openbao:8200/v1/sys/metrics"

    # ── Transit paths ────────────────────────────────────────────────────

    def test_encrypt_url_uses_mount_prefix(self, monkeypatch):
        """encrypt(key) → /v1/{mount}/encrypt/{key}."""
        client = self._client(monkeypatch)
        assert (
            client._url_for("encrypt/wims-incident-pii")
            == "http://openbao:8200/v1/transit/encrypt/wims-incident-pii"
        )

    def test_decrypt_url_uses_mount_prefix(self, monkeypatch):
        """decrypt(key) → /v1/{mount}/decrypt/{key}."""
        client = self._client(monkeypatch)
        assert (
            client._url_for("decrypt/wims-incident-pii")
            == "http://openbao:8200/v1/transit/decrypt/wims-incident-pii"
        )

    def test_rewrap_url_uses_mount_prefix(self, monkeypatch):
        """rewrap(key) → /v1/{mount}/rewrap/{key}."""
        client = self._client(monkeypatch)
        assert (
            client._url_for("rewrap/wims-incident-pii")
            == "http://openbao:8200/v1/transit/rewrap/wims-incident-pii"
        )

    def test_metadata_url_uses_mount_prefix(self, monkeypatch):
        """metadata / keys → /v1/{mount}/keys/{key}."""
        client = self._client(monkeypatch)
        assert (
            client._url_for("keys/wims-incident-pii")
            == "http://openbao:8200/v1/transit/keys/wims-incident-pii"
        )

    def test_rotate_url_uses_mount_prefix(self, monkeypatch):
        """rotate(key) → /v1/{mount}/keys/{key}/rotate."""
        client = self._client(monkeypatch)
        assert (
            client._url_for("keys/wims-incident-pii/rotate")
            == "http://openbao:8200/v1/transit/keys/wims-incident-pii/rotate"
        )

    # ── Custom mount ─────────────────────────────────────────────────────

    def test_custom_mount_respected(self, monkeypatch):
        """Non-default mount path is used in Transit URLs but sys bypasses it."""
        client = self._client(monkeypatch, mount="my-transit")
        assert client._url_for("encrypt/foo") == "http://openbao:8200/v1/my-transit/encrypt/foo"
        # sys paths still bypass
        assert client._url_for("/sys/health") == "http://openbao:8200/v1/sys/health"
