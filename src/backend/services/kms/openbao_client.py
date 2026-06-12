"""OpenBao Transit API client.

Thin httpx-based adapter wrapping the OpenBao /v1/transit/* endpoints.
Never stores raw keys in process memory.
"""

import base64
import dataclasses
import json
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("wims.kms")


# ── Exceptions ────────────────────────────────────────────────────────────────


class OpenBaoClientError(Exception):
    """Raised when an OpenBao API call fails or configuration is invalid."""

    def __init__(
        self, message: str, status_code: int | None = None, method: str | None = None
    ) -> None:
        self.status_code = status_code
        self.method = method
        super().__init__(message)


# ── Structured response types ─────────────────────────────────────────────────


@dataclasses.dataclass
class KmsHealth:
    initialized: bool
    version: str
    cluster_name: str | None = None


@dataclasses.dataclass
class KmsCiphertext:
    ciphertext: str
    key_version: int


@dataclasses.dataclass
class KmsKeyMetadata:
    name: str
    latest_version: int
    min_decryptable_version: int
    keys: dict[int, dict[str, Any]]


# ── Client ────────────────────────────────────────────────────────────────────


class OpenBaoClient:
    """HTTP client for OpenBao Transit secrets engine."""

    def __init__(self) -> None:
        raw_addr = os.environ.get("OPENBAO_ADDR")
        if not raw_addr:
            raise OpenBaoClientError(
                "OPENBAO_ADDR is not set — configure it or set OPENBAO_ADDR=http://openbao:8200 for defaults",
                method="__init__",
            )
        self._addr = raw_addr.rstrip("/")

        self._token = os.environ.get("OPENBAO_TOKEN", "")
        if not self._token:
            self._token = self._read_token_file(os.environ.get("OPENBAO_TOKEN_FILE", ""))
        self._role_id = os.environ.get("OPENBAO_ROLE_ID", "")
        self._secret_id = os.environ.get("OPENBAO_SECRET_ID", "")

        if not self._token and not (self._role_id and self._secret_id):
            raise OpenBaoClientError(
                "No auth method configured — set OPENBAO_TOKEN, OPENBAO_TOKEN_FILE, or OPENBAO_ROLE_ID + OPENBAO_SECRET_ID",
                method="__init__",
            )

        self._mount = os.environ.get("OPENBAO_TRANSIT_MOUNT", "transit").strip("/")
        raw_timeout = os.environ.get("OPENBAO_TIMEOUT_SECONDS", "2.0")
        try:
            self.timeout = float(raw_timeout)
        except ValueError:
            self.timeout = 2.0

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _read_token_file(path: str) -> str:
        """Read an OpenBao token from a Docker-mounted secret/token file."""
        if not path:
            return ""
        try:
            with open(path, encoding="utf-8") as token_file:
                return token_file.read().strip()
        except OSError as e:
            raise OpenBaoClientError(
                f"OPENBAO_TOKEN_FILE is set but cannot be read: {path}",
                method="__init__",
            ) from e

    @property
    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self._token:
            h["X-Vault-Token"] = self._token
        return h

    def _url_for(self, path: str) -> str:
        """Build the full API URL for a given path.

        Sys paths (e.g. ``/sys/health``) bypass the mount prefix so they
        never land under ``/v1/transit/sys/...``.  All other paths are
        assumed to be Transit operations and are routed under
        ``/v1/{mount}/...``.
        """
        if path.startswith("/sys/"):
            return f"{self._addr}/v1{path}"
        return f"{self._addr}/v1/{self._mount}/{path.lstrip('/')}"

    def _request(
        self, method: str, path: str, json_body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        url = self._url_for(path)
        try:
            with httpx.Client(timeout=self.timeout) as c:
                resp = c.request(method, url, headers=self._headers, json=json_body)
        except httpx.TimeoutException as e:
            raise OpenBaoClientError(
                f"OpenBao request timed out after {self.timeout}s: {method} {path}",
                method=method,
            ) from e
        except httpx.HTTPError as e:
            raise OpenBaoClientError(
                f"OpenBao request failed: {method} {path} — {e}",
                method=method,
            ) from e

        if resp.status_code >= 400:
            detail = resp.text[:200]
            raise OpenBaoClientError(
                f"OpenBao returned {resp.status_code} on {method} {path}: {detail}",
                status_code=resp.status_code,
                method=method,
            )

        return resp.json()

    # ── Public API ────────────────────────────────────────────────────────────

    def health(self) -> KmsHealth:
        """GET /sys/health — cluster health and seal state."""
        data = self._request("GET", "/sys/health")
        return KmsHealth(
            initialized=data.get("initialized", False),
            version=data.get("version", ""),
            cluster_name=data.get("cluster_name"),
        )

    def encrypt(
        self, key_name: str, plaintext: bytes, context: bytes | None = None
    ) -> KmsCiphertext:
        """Encrypt plaintext bytes with an OpenBao Transit key."""
        body: dict[str, Any] = {
            "plaintext": base64.b64encode(plaintext).decode("ascii"),
        }
        if context is not None:
            body["context"] = base64.b64encode(context).decode("ascii")
        data = self._request("POST", f"encrypt/{key_name}", json_body=body)
        ct_data = data["data"]
        return KmsCiphertext(
            ciphertext=ct_data["ciphertext"],
            key_version=ct_data.get("key_version", 1),
        )

    def decrypt(self, key_name: str, ciphertext: str, context: bytes | None = None) -> bytes:
        """Decrypt an OpenBao Transit ciphertext back to plaintext bytes."""
        body: dict[str, Any] = {"ciphertext": ciphertext}
        if context is not None:
            body["context"] = base64.b64encode(context).decode("ascii")
        data = self._request("POST", f"decrypt/{key_name}", json_body=body)
        raw = data["data"]["plaintext"]
        return base64.b64decode(raw)

    def rotate(self, key_name: str) -> KmsKeyMetadata:
        """Rotate the named Transit key — bumps latest version."""
        self._request("POST", f"keys/{key_name}/rotate")
        return self.metadata(key_name)

    def rewrap(self, key_name: str, ciphertext: str, context: bytes | None = None) -> KmsCiphertext:
        """Rewrap ciphertext to the latest key version without exposing plaintext."""
        body: dict[str, Any] = {"ciphertext": ciphertext}
        if context is not None:
            body["context"] = base64.b64encode(context).decode("ascii")
        data = self._request("POST", f"rewrap/{key_name}", json_body=body)
        ct_data = data["data"]
        return KmsCiphertext(
            ciphertext=ct_data["ciphertext"],
            key_version=ct_data.get("key_version", 1),
        )

    def metadata(self, key_name: str) -> KmsKeyMetadata:
        """Read key configuration and version metadata."""
        data = self._request("GET", f"keys/{key_name}")
        md = data["data"]
        keys_raw: dict = md.get("keys", {})
        keys_parsed: dict[int, dict[str, Any]] = {}
        for k, v in keys_raw.items():
            try:
                keys_parsed[int(k)] = v
            except (ValueError, TypeError):
                keys_parsed[k] = v  # type: ignore[arg-type]
        return KmsKeyMetadata(
            name=key_name,
            latest_version=md.get("latest_version", 1),
            min_decryptable_version=md.get("min_decryption_version", 1),
            keys=keys_parsed,
        )


# ── KmsSecurityProvider: compatibility wrapper for SecurityProvider call sites ─


class KmsSecurityProvider:
    """OpenBao-backed encryption provider with SecurityProvider-compatible API.

    Presents the same ``encrypt_json`` / ``decrypt_json`` surface as
    ``utils.crypto.SecurityProvider`` so existing write/read call sites can
    dispatch to OpenBao Transit without changing their encryption contract.

    Key name from env: ``OPENBAO_PII_KEY_NAME``, fallback
    ``OPENBAO_TRANSIT_KEY_NAME``, default ``wims-incident-pii``.
    """

    NONCE_SENTINEL = "OPENBAO_TRANSIT"
    PROVIDER = "openbao_transit"

    def __init__(self, client: OpenBaoClient | None = None) -> None:
        self._client = client or OpenBaoClient()
        self._key_name = (
            os.environ.get("OPENBAO_PII_KEY_NAME")
            or os.environ.get("OPENBAO_TRANSIT_KEY_NAME")
            or "wims-incident-pii"
        )
        self.current_version: int = 1

    # ── Provider metadata (Phase 3 #152) ──────────────────────────────────

    @property
    def crypto_provider(self) -> str:
        return self.PROVIDER

    @property
    def kms_key_name(self) -> str:
        return self._key_name

    # ── encrypt_bytes / decrypt_bytes ────────────────────────────────────

    def encrypt_bytes(self, data: bytes, aad: bytes) -> tuple[str, bytes]:
        """Encrypt raw bytes via OpenBao Transit.

        Returns ``(NONCE_SENTINEL, ciphertext_utf8_bytes)``.  The sentinel
        signals no separate nonce (Transit ciphertext is self-contained); the
        OpenBao ciphertext string is UTF-8 encoded so the caller can write it
        directly to disk as bytes.
        """
        try:
            result = self._client.encrypt(self._key_name, data, aad)
        except OpenBaoClientError:
            raise
        except Exception as exc:
            raise OpenBaoClientError(
                f"OpenBao encrypt_bytes failed for key={self._key_name}: {exc}"
            ) from exc
        self.current_version = result.key_version
        return (self.NONCE_SENTINEL, result.ciphertext.encode("utf-8"))

    def decrypt_bytes(
        self,
        nonce_b64: str | None,
        ct_bytes: bytes,
        aad: bytes,
        key_version: int = 1,
    ) -> bytes:
        """Decrypt bytes encrypted with encrypt_bytes.

        The nonce_b64 argument is ignored — OpenBao ciphertext is self-contained.
        """
        _ = nonce_b64
        _ = key_version
        try:
            ct_str = ct_bytes.decode("utf-8")
        except Exception as exc:
            raise OpenBaoClientError(f"Failed to decode ciphertext bytes as UTF-8: {exc}") from exc
        try:
            return self._client.decrypt(self._key_name, ct_str, aad)
        except OpenBaoClientError:
            raise
        except Exception as exc:
            raise OpenBaoClientError(
                f"OpenBao decrypt_bytes failed for key={self._key_name}: {exc}"
            ) from exc

    # ── encrypt_json / decrypt_json ───────────────────────────────────────

    def encrypt_json(
        self,
        pii_dict: dict,
        aad: bytes,
    ) -> tuple[str, str]:
        """Encrypt a PII dict via OpenBao Transit.

        Returns ``(NONCE_SENTINEL, ciphertext)`` — the sentinel signals
        callers that *no nonce* was used (Transit ciphertext is self-contained).
        """
        try:
            plaintext = json.dumps(
                pii_dict,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        except Exception as exc:
            raise OpenBaoClientError(f"Failed to serialise PII dict to JSON: {exc}") from exc

        try:
            result = self._client.encrypt(self._key_name, plaintext, aad)
        except OpenBaoClientError:
            raise
        except Exception as exc:
            raise OpenBaoClientError(
                f"OpenBao encrypt failed for key={self._key_name}: {exc}"
            ) from exc

        self.current_version = result.key_version
        return (self.NONCE_SENTINEL, result.ciphertext)

    def decrypt_json(
        self,
        nonce_b64: str | None,
        ct_b64: str,
        aad: bytes,
        key_version: int = 1,
    ) -> dict:
        """Decrypt an OpenBao Transit ciphertext back to a PII dict.

        The *nonce_b64* argument is ignored — Transit ciphertext is
        self-contained and does not need a separate nonce.
        """
        _ = nonce_b64  # explicitly unused
        _ = key_version

        try:
            plaintext = self._client.decrypt(self._key_name, ct_b64, aad)
        except OpenBaoClientError:
            raise
        except Exception as exc:
            raise OpenBaoClientError(
                f"OpenBao decrypt failed for key={self._key_name}: {exc}"
            ) from exc

        try:
            return json.loads(plaintext.decode("utf-8"))
        except Exception as exc:
            raise OpenBaoClientError(
                f"Decrypted OpenBao payload is not valid UTF-8 JSON: {exc}"
            ) from exc
