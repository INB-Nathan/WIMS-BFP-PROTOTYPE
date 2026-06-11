"""
Backup encryption with pluggable crypto providers.

Encrypted backup formats:

Legacy (env_aesgcm):
    [12-byte nonce][N-byte ciphertext+tag]  (raw concatenation)

OpenBao Transit (openbao_transit):
    WIMSBAO1\n
    {"provider":"openbao_transit","key_name":"wims-backup","created_at":"...","ciphertext_version":N}\n
    <OpenBao Transit ciphertext as UTF-8 bytes>

File extension: .sql.enc (both providers)

Provider precedence:
    1. WIMS_BACKUP_CRYPTO_PROVIDER env var
    2. WIMS_CRYPTO_PROVIDER env var
    3. Default: env_aesgcm
"""

from __future__ import annotations

import base64
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BACKUP_KEY_ENV = "WIMS_MASTER_KEY"
BACKUP_NONCE_BYTES = 12

# WIMSBAO1 header magic for OpenBao-encrypted backups
_HEADER_MAGIC = b"WIMSBAO1\n"
# Context/AAD for OpenBao Transit backup encryption
_BACKUP_CONTEXT = b"wims-backup"

logger = logging.getLogger("wims.backup_crypto")


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_backup_key() -> bytes:
    raw = os.environ.get(BACKUP_KEY_ENV)
    if not raw:
        raise RuntimeError(f"Required env var {BACKUP_KEY_ENV!r} is not set")
    try:
        key_bytes = base64.b64decode(raw)
    except Exception as e:
        raise RuntimeError(f"{BACKUP_KEY_ENV!r} is not valid base64: {e}")
    if len(key_bytes) != 32:
        raise RuntimeError(f"{BACKUP_KEY_ENV!r} must be 32 bytes for AES-256")
    return key_bytes


def _resolve_backup_provider() -> str:
    """Return the active backup crypto provider name.

    Precedence:
        1. WIMS_BACKUP_CRYPTO_PROVIDER
        2. WIMS_CRYPTO_PROVIDER
        3. Default: "env_aesgcm"
    """
    return (
        os.environ.get("WIMS_BACKUP_CRYPTO_PROVIDER")
        or os.environ.get("WIMS_CRYPTO_PROVIDER")
        or "env_aesgcm"
    )


def _get_openbao_backup_key_name() -> str:
    return os.environ.get("OPENBAO_BACKUP_KEY_NAME", "wims-backup")


def _is_openbao_backup(data: bytes) -> bool:
    """Detect whether backup data starts with the WIMSBAO1 header."""
    return data[: len(_HEADER_MAGIC)] == _HEADER_MAGIC


def _parse_openbao_header(data: bytes) -> tuple[dict, bytes]:
    """Split WIMSBAO1 header from ciphertext body.

    Returns (metadata_dict, ciphertext_body_bytes).
    Raises RuntimeError on malformed or missing header.
    """
    if not _is_openbao_backup(data):
        raise RuntimeError("Not an OpenBao backup (missing WIMSBAO1 header)")

    # Split: WIMSBAO1\n<json_line>\n<ciphertext...>
    first_nl = data.index(b"\n")  # after WIMSBAO1
    second_nl = data.index(b"\n", first_nl + 1)  # after JSON line

    metadata_bytes = data[first_nl + 1 : second_nl]
    ciphertext_body = data[second_nl + 1 :]

    try:
        metadata = json.loads(metadata_bytes.decode("utf-8"))
    except Exception as e:
        raise RuntimeError(f"Failed to parse WIMSBAO1 metadata JSON: {e}") from e

    # Validate required fields
    required = ("provider", "key_name", "created_at", "ciphertext_version")
    for field in required:
        if field not in metadata:
            raise RuntimeError(f"WIMSBAO1 metadata missing required field: {field!r}")

    if metadata.get("provider") != "openbao_transit":
        raise RuntimeError(f"WIMSBAO1 metadata has unknown provider: {metadata.get('provider')!r}")

    return metadata, ciphertext_body


def _build_openbao_header(key_name: str, ciphertext_version: int) -> bytes:
    """Build the WIMSBAO1 header for a new OpenBao-encrypted backup.

    Does NOT include plaintext, raw keys, tokens, or secrets.
    """
    metadata = {
        "provider": "openbao_transit",
        "key_name": key_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "ciphertext_version": ciphertext_version,
    }
    return _HEADER_MAGIC + json.dumps(metadata).encode("utf-8") + b"\n"


# ── Public API ────────────────────────────────────────────────────────────────


def encrypt_backup(input_path: Path, output_path: Path | None = None) -> Path:
    """
    Encrypt a backup file and write to output_path.

    Provider is resolved at call time via WIMS_BACKUP_CRYPTO_PROVIDER /
    WIMS_CRYPTO_PROVIDER. Default is env_aesgcm (legacy AES-256-GCM).

    Args:
        input_path:  Path to the raw (unencrypted) backup .sql file.
        output_path: Optional output path. Defaults to input_path.with_suffix('.sql.enc').
                     If output_path equals input_path (in-place), the raw file is replaced.

    Returns:
        Path to the encrypted .sql.enc file.
    """
    data = input_path.read_bytes()
    provider = _resolve_backup_provider()

    if provider == "openbao_transit":
        out_data = _encrypt_openbao(data)
    elif provider == "env_aesgcm":
        out_data = _encrypt_env_aes(data)
    else:
        raise RuntimeError(f"Unknown backup crypto provider: {provider!r}")

    out = output_path or input_path.with_suffix(".sql.enc")
    out.write_bytes(out_data)

    # Remove raw file after successful encryption (in-place replacement)
    if input_path.exists() and (output_path is None or output_path == input_path):
        input_path.unlink()
    elif output_path and output_path != input_path:
        input_path.unlink()

    return out


def decrypt_backup(encrypted_path: Path, output_path: Path | None = None) -> Path:
    """
    Decrypt an encrypted backup file.

    Auto-detects format:
    - WIMSBAO1 header → OpenBao Transit decrypt
    - Otherwise → legacy AES-256-GCM decrypt with WIMS_MASTER_KEY

    Args:
        encrypted_path: Path to the .sql.enc encrypted backup.
        output_path:    Optional output path. Defaults to encrypted_path.with_suffix('.sql').
                        If output_path equals encrypted_path (in-place), the .enc file is replaced.

    Returns:
        Path to the decrypted .sql file.
    """
    data = encrypted_path.read_bytes()

    if _is_openbao_backup(data):
        plaintext = _decrypt_openbao(data)
    else:
        plaintext = _decrypt_env_aes(data)

    out = output_path or encrypted_path.with_suffix(".sql")

    if output_path and output_path != encrypted_path:
        # Write to temp then replace to avoid partial writes
        tmp = encrypted_path.with_suffix(".sql.tmp")
        tmp.write_bytes(plaintext)
        tmp.replace(output_path)
        encrypted_path.unlink()
    else:
        # In-place: write to .sql directly
        out.write_bytes(plaintext)
        encrypted_path.unlink()

    return out


# ── Internal: env_aesgcm (legacy) ────────────────────────────────────────────


def _encrypt_env_aes(data: bytes) -> bytes:
    """Encrypt data with legacy AES-256-GCM (WIMS_MASTER_KEY)."""
    key = _get_backup_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(BACKUP_NONCE_BYTES)
    ciphertext = aesgcm.encrypt(nonce, data, None)  # no AAD for legacy backups
    return nonce + ciphertext


def _decrypt_env_aes(data: bytes) -> bytes:
    """Decrypt legacy AES-256-GCM encrypted data."""
    key = _get_backup_key()
    aesgcm = AESGCM(key)

    if len(data) < BACKUP_NONCE_BYTES:
        raise RuntimeError("Encrypted backup file too short to contain nonce")

    nonce = data[:BACKUP_NONCE_BYTES]
    ciphertext = data[BACKUP_NONCE_BYTES:]

    try:
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    except Exception as e:
        raise RuntimeError(f"Decryption failed (wrong key or tampered file): {e}")

    return plaintext


# ── Internal: openbao_transit ────────────────────────────────────────────────


def _encrypt_openbao(data: bytes) -> bytes:
    """Encrypt data with OpenBao Transit.

    Never logs plaintext, raw keys, tokens, or ciphertext body.
    """
    from services.kms.openbao_client import OpenBaoClient

    key_name = _get_openbao_backup_key_name()
    client = OpenBaoClient()
    result = client.encrypt(key_name, data, _BACKUP_CONTEXT)

    header = _build_openbao_header(key_name, result.key_version)
    return header + result.ciphertext.encode("utf-8")


def _decrypt_openbao(data: bytes) -> bytes:
    """Decrypt WIMSBAO1-format OpenBao Transit backup.

    Never logs plaintext or raw ciphertext body.
    """
    from services.kms.openbao_client import OpenBaoClient

    metadata, ciphertext_body = _parse_openbao_header(data)
    key_name = metadata["key_name"]
    ciphertext_str = ciphertext_body.decode("utf-8")

    client = OpenBaoClient()
    return client.decrypt(key_name, ciphertext_str, _BACKUP_CONTEXT)
