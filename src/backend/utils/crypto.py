"""
SecurityProvider — AES-256-GCM encrypted PII blob for incident_sensitive_details.

PII fields encrypted as a single JSON blob:
    caller_name, caller_number, owner_name, occupant_name

Policy:
    - WIMS_MASTER_KEY loaded from env as base64-encoded 32-byte key (version 1).
    - Additional keys WIMS_MASTER_KEY_V2, WIMS_MASTER_KEY_V3, … for rotation.
    - WIMS_KEY_CURRENT_VERSION selects which key new encryptions use (default "1").
    - Nonce: 12 bytes (RFC 5116), generated fresh per encrypt_json call.
    - AAD: "incident_id:{incident_id}" bound to the specific record.
    - Plaintext JSON serialized deterministically: json.dumps(..., sort_keys=True, separators=(",", ":")).
    - ciphertext stored as base64(ct_b64); nonce stored as base64(nonce_b64).
    - PII columns in DB are set to NULL for new writes; only the blob is authoritative.
"""

from __future__ import annotations

import base64
import json
import os
from typing import Tuple

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class SecurityProviderError(Exception):
    """Raised on any crypto failure — missing key, decode error, auth failure."""

    pass


class SecurityProvider:
    """
    Versioned AES-256-GCM keyring for WIMS-BFP PII encryption.

    Environment:
        WIMS_MASTER_KEY              base64-encoded 32-byte AES-256 key (version 1, required).
        WIMS_MASTER_KEY_V2           base64-encoded 32-byte key for version 2 (optional).
        WIMS_MASTER_KEY_V3           … and so on, scanned up to V100 (gaps skipped).
        WIMS_KEY_CURRENT_VERSION     integer; selects which key new encryptions use (default "1").
    """

    KEY_ENV = "WIMS_MASTER_KEY"
    NONCE_BYTES = 12  # RFC 5116
    PROVIDER = "env_aesgcm"

    def __init__(self) -> None:
        self._keyring: dict[int, AESGCM] = {}

        # v1 is always WIMS_MASTER_KEY — required
        raw_v1 = os.environ.get(self.KEY_ENV)
        if not raw_v1:
            raise SecurityProviderError(
                f"Required env var {self.KEY_ENV!r} is not set. "
                "Set it to a base64-encoded 32-byte key."
            )
        self._keyring[1] = self._load_key(self.KEY_ENV, raw_v1)

        # V2, V3, … up to V100.  Gaps in the sequence are allowed (e.g. V2
        # missing, V3 present).  The scan stops after 5 consecutive missing
        # versions to bound startup time.
        missing = 0
        version = 2
        while missing < 5 and version <= 100:
            env_name = f"WIMS_MASTER_KEY_V{version}"
            raw = os.environ.get(env_name)
            if raw:
                self._keyring[version] = self._load_key(env_name, raw)
                missing = 0
            else:
                missing += 1
            version += 1

        # Determine which version new encryptions use
        cv_raw = os.environ.get("WIMS_KEY_CURRENT_VERSION", "1")
        try:
            cv = int(cv_raw)
        except ValueError:
            raise SecurityProviderError(
                f"WIMS_KEY_CURRENT_VERSION={cv_raw!r} is not a valid integer"
            )
        if cv not in self._keyring:
            raise SecurityProviderError(
                f"WIMS_KEY_CURRENT_VERSION={cv} does not match any loaded key "
                f"(available versions: {sorted(self._keyring)})"
            )
        self._current_version = cv

    # -------------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _load_key(env_name: str, raw: str) -> AESGCM:
        try:
            key_bytes = base64.b64decode(raw)
        except Exception as e:
            raise SecurityProviderError(f"{env_name!r} is not valid base64: {e}")
        if len(key_bytes) != 32:
            raise SecurityProviderError(
                f"{env_name!r} must decode to exactly 32 bytes for AES-256; "
                f"got {len(key_bytes)} bytes. "
                'Generate one with: python -c "import secrets,base64; '
                'print(base64.b64encode(secrets.token_bytes(32)).decode())"'
            )
        return AESGCM(key_bytes)

    # -------------------------------------------------------------------------
    # Properties
    # -------------------------------------------------------------------------

    @property
    def current_version(self) -> int:
        return self._current_version

    @property
    def _aesgcm(self) -> AESGCM:
        """Active AESGCM instance for the current key version."""
        return self._keyring[self._current_version]

    # ── Provider metadata (Phase 3 #152) ──────────────────────────────────

    @property
    def crypto_provider(self) -> str:
        return self.PROVIDER

    @property
    def kms_key_name(self) -> str | None:
        return None

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    def encrypt_bytes(self, data: bytes, aad: bytes) -> Tuple[str, bytes]:
        """Encrypt raw bytes using AES-256-GCM with the current key version.

        Returns (nonce_b64, ciphertext_bytes).  Store nonce_b64 in the DB
        (encryption_iv column) and ciphertext_bytes raw on disk.  AAD must be
        reproduced identically at decrypt time.

        Raises:
            SecurityProviderError: on encryption failure.
        """
        nonce = os.urandom(self.NONCE_BYTES)
        try:
            ciphertext = self._aesgcm.encrypt(nonce, data, aad)
        except Exception as e:
            raise SecurityProviderError(f"AES-256-GCM encryption failed: {e}") from e
        nonce_b64 = base64.b64encode(nonce).decode("ascii")
        return nonce_b64, ciphertext

    def decrypt_bytes(
        self,
        nonce_b64: str,
        ct_bytes: bytes,
        aad: bytes,
        key_version: int = 1,
    ) -> bytes:
        """Decrypt raw bytes encrypted with encrypt_bytes.

        Args:
            nonce_b64:    Base64-encoded 12-byte nonce (encryption_iv column).
            ct_bytes:     Raw ciphertext bytes read from disk.
            aad:          Must match the AAD used at encryption time.
            key_version:  Key version that encrypted this file (default 1).

        Returns:
            Original plaintext bytes.

        Raises:
            SecurityProviderError: on missing key version, bad nonce, or
                                   authentication failure (wrong key / tampered).
        """
        if key_version not in self._keyring:
            raise SecurityProviderError(
                f"key_version={key_version} is not loaded in keyring "
                f"(available: {sorted(self._keyring)})"
            )
        aesgcm = self._keyring[key_version]
        try:
            nonce = base64.b64decode(nonce_b64)
        except Exception as e:
            raise SecurityProviderError(f"Failed to base64-decode nonce: {e}") from e
        if len(nonce) != self.NONCE_BYTES:
            raise SecurityProviderError(f"nonce must be {self.NONCE_BYTES} bytes, got {len(nonce)}")
        try:
            return aesgcm.decrypt(nonce, ct_bytes, aad)
        except Exception as e:
            raise SecurityProviderError(
                f"AES-256-GCM authentication failed with key_version={key_version} — "
                f"wrong key version, tampered ciphertext, or mismatched AAD. Detail: {e}"
            ) from e

    def encrypt_json(
        self,
        pii_dict: dict,
        aad: bytes,
    ) -> Tuple[str, str]:
        """
        Encrypt a PII dict using AES-256-GCM with the current key version.

        Args:
            pii_dict:  Plaintext dict with PII keys (caller_name, caller_number, …).
            aad:       Additional Authenticated Data bound to the record.
                       Must be ``f"incident_id:{incident_id}".encode("utf-8")``.

        Returns:
            (nonce_b64, ct_b64) — both as URL-safe base64 strings.
            The caller should also persist ``self.current_version`` as ``key_version``.

        Raises:
            SecurityProviderError: on encoding or encryption failure.
        """
        try:
            plaintext = json.dumps(
                pii_dict,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        except Exception as e:
            raise SecurityProviderError(f"Failed to serialise PII dict to JSON: {e}") from e

        nonce = os.urandom(self.NONCE_BYTES)

        try:
            # AESGCM.encrypt returns ciphertext + tag (both included in the returned bytes)
            ciphertext = self._aesgcm.encrypt(nonce, plaintext, aad)
        except Exception as e:
            raise SecurityProviderError(f"AES-256-GCM encryption failed: {e}") from e

        try:
            nonce_b64 = base64.b64encode(nonce).decode("ascii")
            ct_b64 = base64.b64encode(ciphertext).decode("ascii")
        except Exception as e:
            raise SecurityProviderError(f"Failed to base64-encode ciphertext: {e}") from e

        return nonce_b64, ct_b64

    def decrypt_json(
        self,
        nonce_b64: str,
        ct_b64: str,
        aad: bytes,
        key_version: int = 1,
    ) -> dict:
        """
        Decrypt a PII blob.

        Args:
            nonce_b64:    Base64-encoded 12-byte nonce.
            ct_b64:       Base64-encoded ciphertext (+16-byte auth tag).
            aad:          Must match the AAD used at encryption time.
            key_version:  Version of the key that encrypted this blob (default 1).

        Returns:
            The original ``pii_dict`` (Python dict).

        Raises:
            SecurityProviderError: on missing key version, base64 decode failure,
                                   or authentication failure.
        """
        if key_version not in self._keyring:
            raise SecurityProviderError(
                f"key_version={key_version} is not loaded in keyring "
                f"(available: {sorted(self._keyring)})"
            )
        aesgcm = self._keyring[key_version]

        try:
            nonce = base64.b64decode(nonce_b64)
        except Exception as e:
            raise SecurityProviderError(f"Failed to base64-decode nonce: {e}") from e

        if len(nonce) != self.NONCE_BYTES:
            raise SecurityProviderError(f"nonce must be {self.NONCE_BYTES} bytes, got {len(nonce)}")

        try:
            ciphertext = base64.b64decode(ct_b64)
        except Exception as e:
            raise SecurityProviderError(f"Failed to base64-decode ciphertext: {e}") from e

        try:
            plaintext = aesgcm.decrypt(nonce, ciphertext, aad)
        except Exception as e:
            # Cryptography library raises InvalidTag on auth failure
            raise SecurityProviderError(
                f"AES-256-GCM authentication failed with key_version={key_version} — "
                f"wrong key version, tampered ciphertext, or mismatched AAD. Detail: {e}"
            ) from e

        try:
            return json.loads(plaintext.decode("utf-8"))
        except Exception as e:
            raise SecurityProviderError(f"Decrypted payload is not valid UTF-8 JSON: {e}") from e
