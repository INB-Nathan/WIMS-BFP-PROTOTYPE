"""
SecurityProvider — AES-256-GCM encrypted PII blob for incident_sensitive_details.

PII fields encrypted as a single JSON blob:
    caller_name, caller_number, owner_name, occupant_name

Policy:
    - WIMS_MASTER_KEY loaded from env as base64-encoded 32-byte key.
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
    Thin wrapper around AES-256-GCM for WIMS-BFP PII encryption.

    Environment:
        WIMS_MASTER_KEY  base64-encoded 32-byte AES-256 key.
    """

    KEY_ENV = "WIMS_MASTER_KEY"
    NONCE_BYTES = 12  # RFC 5116

    def __init__(self) -> None:
        raw = os.environ.get(self.KEY_ENV)
        if not raw:
            raise SecurityProviderError(
                f"Required env var {self.KEY_ENV!r} is not set. "
                "Set it to a base64-encoded 32-byte key."
            )
        try:
            key_bytes = base64.b64decode(raw)
        except Exception as e:
            raise SecurityProviderError(f"{self.KEY_ENV!r} is not valid base64: {e}")

        if len(key_bytes) != 32:
            raise SecurityProviderError(
                f"{self.KEY_ENV!r} must decode to exactly 32 bytes for AES-256; "
                f"got {len(key_bytes)} bytes. "
                'Generate one with: python -c "import secrets,base64; '
                'print(base64.b64encode(secrets.token_bytes(32)).decode())"'
            )

        self._aesgcm = AESGCM(key_bytes)

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    def encrypt_json(
        self,
        pii_dict: dict,
        aad: bytes,
    ) -> Tuple[str, str]:
        """
        Encrypt a PII dict using AES-256-GCM.

        Args:
            pii_dict:  Plaintext dict with PII keys (caller_name, caller_number, …).
                       May contain empty strings — those are included as-is in the blob.
            aad:       Additional Authenticated Data bound to the record.
                       Must be ``f"incident_id:{incident_id}".encode("utf-8")``.

        Returns:
            (nonce_b64, ct_b64) — both as URL-safe base64 strings.

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
            raise SecurityProviderError(
                f"Failed to serialise PII dict to JSON: {e}"
            ) from e

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
            raise SecurityProviderError(
                f"Failed to base64-encode ciphertext: {e}"
            ) from e

        return nonce_b64, ct_b64

    def decrypt_json(
        self,
        nonce_b64: str,
        ct_b64: str,
        aad: bytes,
    ) -> dict:
        """
        Decrypt a PII blob.

        Args:
            nonce_b64:  Base64-encoded 12-byte nonce.
            ct_b64:     Base64-encoded ciphertext (+16-byte auth tag).
            aad:        Must match the AAD used at encryption time.

        Returns:
            The original ``pii_dict`` (Python dict).

        Raises:
            SecurityProviderError: on base64 decode failure or authentication failure.
        """
        try:
            nonce = base64.b64decode(nonce_b64)
        except Exception as e:
            raise SecurityProviderError(f"Failed to base64-decode nonce: {e}") from e

        if len(nonce) != self.NONCE_BYTES:
            raise SecurityProviderError(
                f"nonce must be {self.NONCE_BYTES} bytes, got {len(nonce)}"
            )

        try:
            ciphertext = base64.b64decode(ct_b64)
        except Exception as e:
            raise SecurityProviderError(
                f"Failed to base64-decode ciphertext: {e}"
            ) from e

        try:
            plaintext = self._aesgcm.decrypt(nonce, ciphertext, aad)
        except Exception as e:
            # Cryptography library raises InvalidTag on auth failure
            raise SecurityProviderError(
                "AES-256-GCM authentication failed — wrong key, tampered ciphertext, "
                f"or mismatched AAD. Detail: {e}"
            ) from e

        try:
            return json.loads(plaintext.decode("utf-8"))
        except Exception as e:
            raise SecurityProviderError(
                f"Decrypted payload is not valid UTF-8 JSON: {e}"
            ) from e
