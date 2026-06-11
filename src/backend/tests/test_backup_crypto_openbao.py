"""Phase 7 #152 — OpenBao-backed backup encryption + legacy restore tests.

Verifies that backup_crypto.py:
- Defaults to env_aesgcm (legacy AES-256-GCM, no header)
- Writes WIMSBAO1 header when provider is openbao_transit
- Auto-detects format on decrypt (header → OpenBao, no header → legacy)
- Honors feature-flag precedence and OPENBAO_BACKUP_KEY_NAME
- Preserves existing function signatures and output path behavior

No live OpenBao required — uses mocked OpenBaoClient exclusively.
"""

from __future__ import annotations

import base64
import json
import secrets
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ── Import gate ───────────────────────────────────────────────────────────────

try:
    from utils.backup_crypto import (
        BACKUP_KEY_ENV,
        encrypt_backup,
        decrypt_backup,
        _resolve_backup_provider,
        _get_openbao_backup_key_name,
        _is_openbao_backup,
        _parse_openbao_header,
        _build_openbao_header,
        _HEADER_MAGIC,
        _BACKUP_CONTEXT,
        _encrypt_env_aes,
    )
except ImportError:
    pytest.fail("utils.backup_crypto not importable — implement Phase 7 first")


# ── Helpers ───────────────────────────────────────────────────────────────────

OPENBAO_PATCH_TARGET = "services.kms.openbao_client.OpenBaoClient"


def _valid_master_key_b64() -> str:
    """Return a valid base64-encoded 32-byte AES-256 key."""
    return base64.b64encode(secrets.token_bytes(32)).decode()


def _temp_dir(tmp_path: Path) -> Path:
    """Return a temp directory for test backup files."""
    d = tmp_path / "backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _write_sql_file(dir_: Path, name: str = "test.sql", content: bytes | None = None) -> Path:
    """Write a test .sql file and return its path."""
    p = dir_ / name
    p.write_bytes(content if content is not None else b"-- test sql dump\nSELECT 1;\n")
    return p


def _dummy_openbao_client() -> MagicMock:
    """Return a mocked OpenBaoClient that encrypts/decrypts predictably."""
    from services.kms.openbao_client import KmsCiphertext

    mock = MagicMock()
    # Return a predictable ciphertext with key_version=7
    mock.encrypt.return_value = KmsCiphertext(
        ciphertext="vault:v7:test-ciphertext",
        key_version=7,
    )
    # "Decrypt" by returning the original plaintext stored during mock setup
    mock.decrypt.return_value = b"mock-decrypt-output"
    return mock


# ════════════════════════════════════════════════════════════════════════════════
# Feature flag & provider resolution
# ════════════════════════════════════════════════════════════════════════════════


class TestProviderResolution:
    """Backup crypto provider resolution from env vars."""

    def test_default_no_env_vars_is_env_aesgcm(self, monkeypatch):
        monkeypatch.delenv("WIMS_BACKUP_CRYPTO_PROVIDER", raising=False)
        monkeypatch.delenv("WIMS_CRYPTO_PROVIDER", raising=False)
        assert _resolve_backup_provider() == "env_aesgcm"

    def test_wims_backup_crypto_provider_takes_precedence(self, monkeypatch):
        monkeypatch.setenv("WIMS_BACKUP_CRYPTO_PROVIDER", "openbao_transit")
        monkeypatch.setenv("WIMS_CRYPTO_PROVIDER", "env_aesgcm")
        assert _resolve_backup_provider() == "openbao_transit"

    def test_wims_crypto_provider_fallback(self, monkeypatch):
        monkeypatch.delenv("WIMS_BACKUP_CRYPTO_PROVIDER", raising=False)
        monkeypatch.setenv("WIMS_CRYPTO_PROVIDER", "openbao_transit")
        assert _resolve_backup_provider() == "openbao_transit"

    def test_backup_provider_empty_string_falls_back(self, monkeypatch):
        monkeypatch.setenv("WIMS_BACKUP_CRYPTO_PROVIDER", "")
        monkeypatch.setenv("WIMS_CRYPTO_PROVIDER", "openbao_transit")
        # empty string is falsy → fallback to WIMS_CRYPTO_PROVIDER
        assert _resolve_backup_provider() == "openbao_transit"

    def test_openbao_backup_key_name_default(self, monkeypatch):
        monkeypatch.delenv("OPENBAO_BACKUP_KEY_NAME", raising=False)
        assert _get_openbao_backup_key_name() == "wims-backup"

    def test_openbao_backup_key_name_custom(self, monkeypatch):
        monkeypatch.setenv("OPENBAO_BACKUP_KEY_NAME", "my-backup-key")
        assert _get_openbao_backup_key_name() == "my-backup-key"


# ════════════════════════════════════════════════════════════════════════════════
# Legacy env_aesgcm encrypt/decrypt
# ════════════════════════════════════════════════════════════════════════════════


class TestLegacyEnvAesEncryptDecrypt:
    """Default env_aesgcm encryption writes legacy format (no WIMSBAO1 header)."""

    def test_default_encryption_writes_legacy_format(self, monkeypatch, tmp_path):
        """When no provider env is set, encryption produces legacy nonce+ciphertext."""
        monkeypatch.setenv(BACKUP_KEY_ENV, _valid_master_key_b64())
        d = _temp_dir(tmp_path)
        sql = _write_sql_file(d, "original.sql", b"test-backup-payload-42")

        enc = encrypt_backup(sql)

        assert enc.suffix == ".enc"
        data = enc.read_bytes()
        assert not _is_openbao_backup(data), "legacy format must not have WIMSBAO1 header"
        assert len(data) >= 12 + 16, "must have at least nonce + auth tag"

    def test_legacy_roundtrip(self, monkeypatch, tmp_path):
        """Encrypt then decrypt in legacy mode returns original plaintext."""
        monkeypatch.setenv(BACKUP_KEY_ENV, _valid_master_key_b64())
        d = _temp_dir(tmp_path)
        original = b"roundtrip-legacy-payload\nline2\nline3\n"
        sql = _write_sql_file(d, "backup.sql", original)

        enc = encrypt_backup(sql)
        assert not sql.exists()  # raw .sql unlinked after encryption

        dec = decrypt_backup(enc)
        assert dec.suffix == ".sql"
        assert dec.read_bytes() == original

    def test_legacy_output_path_explicit(self, monkeypatch, tmp_path):
        """encrypt_backup with explicit output_path writes there."""
        monkeypatch.setenv(BACKUP_KEY_ENV, _valid_master_key_b64())
        d = _temp_dir(tmp_path)
        sql = _write_sql_file(d, "input.sql", b"explicit-output-test")
        out = d / "custom.enc"

        result = encrypt_backup(sql, output_path=out)
        assert result == out
        assert out.exists()
        assert sql.exists() is False  # input deleted

    def test_legacy_decrypt_output_path_explicit(self, monkeypatch, tmp_path):
        """decrypt_backup with explicit output_path writes there."""
        monkeypatch.setenv(BACKUP_KEY_ENV, _valid_master_key_b64())
        d = _temp_dir(tmp_path)
        original = b"decrypt-explicit-path"
        sql = _write_sql_file(d, "src.sql", original)
        enc = encrypt_backup(sql)
        out = d / "restored.sql"

        result = decrypt_backup(enc, output_path=out)
        assert result == out
        assert out.read_bytes() == original
        assert enc.exists() is False  # .enc deleted

    def test_too_short_legacy_file_raises(self, monkeypatch, tmp_path):
        """Decrypting a file shorter than nonce bytes raises clear error."""
        monkeypatch.setenv(BACKUP_KEY_ENV, _valid_master_key_b64())
        d = _temp_dir(tmp_path)
        short = d / "short.enc"
        short.write_bytes(b"tiny")

        with pytest.raises(RuntimeError, match="too short"):
            decrypt_backup(short)

    def test_tampered_legacy_file_raises(self, monkeypatch, tmp_path):
        """Decrypting a tampered legacy file raises authentication error."""
        monkeypatch.setenv(BACKUP_KEY_ENV, _valid_master_key_b64())
        d = _temp_dir(tmp_path)
        sql = _write_sql_file(d, "tamper.sql", b"will-be-tampered")
        enc = encrypt_backup(sql)

        data = bytearray(enc.read_bytes())
        # Flip a bit in the middle of ciphertext
        mid = len(data) // 2
        data[mid] ^= 0x01
        enc.write_bytes(bytes(data))

        with pytest.raises(RuntimeError, match="Decryption failed|authentication"):
            decrypt_backup(enc)


# ════════════════════════════════════════════════════════════════════════════════
# OpenBao Transit encrypt/decrypt
# ════════════════════════════════════════════════════════════════════════════════


class TestOpenBaoBackupEncryptDecrypt:
    """OpenBao Transit backup encryption with WIMSBAO1 header."""

    def _setup_openbao_env(self, monkeypatch):
        """Configure env for openbao_transit backup provider."""
        monkeypatch.setenv("WIMS_BACKUP_CRYPTO_PROVIDER", "openbao_transit")
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.setenv("OPENBAO_BACKUP_KEY_NAME", "wims-backup")

    def test_openbao_encryption_writes_header(self, monkeypatch, tmp_path):
        """OpenBao provider produces WIMSBAO1 header + metadata + ciphertext."""
        self._setup_openbao_env(monkeypatch)
        d = _temp_dir(tmp_path)
        sql = _write_sql_file(d, "bao.sql", b"openbao-backup-payload")

        mock_client = _dummy_openbao_client()
        with patch(OPENBAO_PATCH_TARGET, return_value=mock_client):
            enc = encrypt_backup(sql)

        assert enc.suffix == ".enc"
        data = enc.read_bytes()
        assert _is_openbao_backup(data), "must start with WIMSBAO1 header"

        metadata, ct_body = _parse_openbao_header(data)
        assert metadata["provider"] == "openbao_transit"
        assert metadata["key_name"] == "wims-backup"
        assert "created_at" in metadata
        assert metadata["ciphertext_version"] == 7  # from mock
        assert ct_body == b"vault:v7:test-ciphertext"  # ciphertext from mock

    def test_openbao_header_has_no_secrets(self, monkeypatch, tmp_path):
        """Header must not include plaintext, raw keys, tokens, or secrets."""
        self._setup_openbao_env(monkeypatch)
        d = _temp_dir(tmp_path)
        sql = _write_sql_file(d, "nosecrets.sql", b"secret-payload")

        mock_client = _dummy_openbao_client()
        with patch(OPENBAO_PATCH_TARGET, return_value=mock_client):
            enc = encrypt_backup(sql)

        data = enc.read_bytes()
        header_text = data.split(b"\n")[1].decode("utf-8")
        header = json.loads(header_text)

        # Header must not contain plaintext, tokens, raw keys
        for field in header:
            assert "token" not in field.lower(), (
                f"header must not contain token-like field: {field}"
            )
            assert field not in ("plaintext", "secret", "key", "password")

        assert "vault:v7:test-ciphertext" not in header_text, (
            "header metadata must not include ciphertext body"
        )

    def test_openbao_roundtrip(self, monkeypatch, tmp_path):
        """Encrypt with OpenBao → decrypt with OpenBao returns original plaintext."""
        self._setup_openbao_env(monkeypatch)
        d = _temp_dir(tmp_path)
        original = b"openbao-roundtrip-test-data\n\x00\xff\xfe\n"
        sql = _write_sql_file(d, "rt.sql", original)

        # encrypt: returns mock ciphertext
        mock_enc_client = _dummy_openbao_client()
        # decrypt: must return original bytes
        mock_dec_client = _dummy_openbao_client()
        mock_dec_client.decrypt.return_value = original

        with patch(
            OPENBAO_PATCH_TARGET,
            side_effect=[mock_enc_client, mock_dec_client],
        ):
            enc = encrypt_backup(sql)
            dec = decrypt_backup(enc)

        assert dec.read_bytes() == original
        assert enc.exists() is False  # deleted after decrypt
        assert mock_dec_client.decrypt.called
        call_args, _call_kwargs = mock_dec_client.decrypt.call_args
        assert call_args[0] == "wims-backup"  # key_name
        assert call_args[2] == _BACKUP_CONTEXT  # context

    def test_openbao_decrypt_detects_header(self, monkeypatch, tmp_path):
        """decrypt_backup detects WIMSBAO1 header and dispatches to OpenBao."""
        self._setup_openbao_env(monkeypatch)
        d = _temp_dir(tmp_path)
        original = b"detect-header-test"

        # Manually build an OpenBao backup
        enc = d / "manual.enc"
        header = _build_openbao_header("wims-backup", 3)
        enc.write_bytes(header + b"vault:v3:manual-ciphertext")

        mock_client = _dummy_openbao_client()
        mock_client.decrypt.return_value = original

        with patch(OPENBAO_PATCH_TARGET, return_value=mock_client):
            dec = decrypt_backup(enc)

        assert dec.read_bytes() == original
        mock_client.decrypt.assert_called_once_with(
            "wims-backup", "vault:v3:manual-ciphertext", _BACKUP_CONTEXT
        )

    def test_legacy_decrypt_still_works_no_header(self, monkeypatch, tmp_path):
        """Legacy AES-encrypted file without WIMSBAO1 header still decrypts."""
        monkeypatch.setenv(BACKUP_KEY_ENV, _valid_master_key_b64())
        d = _temp_dir(tmp_path)
        original = b"legacy-decrypt-still-works"

        # Create legacy encrypted file
        legacy_enc = _encrypt_env_aes(original)
        enc = d / "legacy.enc"
        enc.write_bytes(legacy_enc)

        assert not _is_openbao_backup(legacy_enc), "legacy must not have header"
        dec = decrypt_backup(enc)
        assert dec.read_bytes() == original

    def test_openbao_backup_key_name_honored(self, monkeypatch, tmp_path):
        """OPENBAO_BACKUP_KEY_NAME is passed to OpenBaoClient.encrypt."""
        monkeypatch.setenv("WIMS_BACKUP_CRYPTO_PROVIDER", "openbao_transit")
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.setenv("OPENBAO_BACKUP_KEY_NAME", "custom-backup-key")
        d = _temp_dir(tmp_path)
        sql = _write_sql_file(d, "keyname.sql", b"key-name-test")

        mock_client = _dummy_openbao_client()
        with patch(OPENBAO_PATCH_TARGET, return_value=mock_client):
            encrypt_backup(sql)

        mock_client.encrypt.assert_called_once()
        args, _ = mock_client.encrypt.call_args
        assert args[0] == "custom-backup-key", "must use OPENBAO_BACKUP_KEY_NAME"

    def test_invalid_header_metadata_missing_fields(self, tmp_path):
        """Missing required fields in WIMSBAO1 metadata raises clear error."""
        bad_header = _HEADER_MAGIC + b'{"provider":"openbao_transit"}\n' + b"ct"

        with pytest.raises(RuntimeError, match="missing required field"):
            _parse_openbao_header(bad_header)

    def test_invalid_header_unknown_provider(self, tmp_path):
        """WIMSBAO1 metadata with unknown provider raises clear error."""
        meta = {
            "provider": "bogus_provider",
            "key_name": "x",
            "created_at": "2026-01-01T00:00:00Z",
            "ciphertext_version": 1,
        }
        bad_header = _HEADER_MAGIC + json.dumps(meta).encode() + b"\nct"

        with pytest.raises(RuntimeError, match="unknown provider"):
            _parse_openbao_header(bad_header)


# ════════════════════════════════════════════════════════════════════════════════
# Header format parsing
# ════════════════════════════════════════════════════════════════════════════════


class TestHeaderParsing:
    """Unit tests for WIMSBAO1 header detection and parsing."""

    def test_is_openbao_backup_true(self):
        data = _HEADER_MAGIC + b"rest"
        assert _is_openbao_backup(data) is True

    def test_is_openbao_backup_false_legacy(self):
        data = b"\x00" * 20  # random bytes, no header
        assert _is_openbao_backup(data) is False

    def test_is_openbao_backup_false_empty(self):
        assert _is_openbao_backup(b"") is False

    def test_is_openbao_backup_false_wrong_magic(self):
        data = b"WIMSBAO2\n..."
        assert _is_openbao_backup(data) is False

    def test_parse_valid_header(self):
        meta = {
            "provider": "openbao_transit",
            "key_name": "wims-backup",
            "created_at": "2026-06-11T00:00:00Z",
            "ciphertext_version": 5,
        }
        data = _HEADER_MAGIC + json.dumps(meta).encode() + b"\nvault:v5:ct"
        parsed_meta, ct = _parse_openbao_header(data)
        assert parsed_meta == meta
        assert ct == b"vault:v5:ct"

    def test_parse_header_invalid_json(self):
        data = _HEADER_MAGIC + b"{not valid json}\nvault:v1:ct"
        with pytest.raises(RuntimeError, match="Failed to parse"):
            _parse_openbao_header(data)

    def test_build_openbao_header(self):
        hdr = _build_openbao_header("test-key", 3)
        assert hdr.startswith(_HEADER_MAGIC)

        meta, ct = _parse_openbao_header(hdr + b"dummy-ct")
        assert meta["provider"] == "openbao_transit"
        assert meta["key_name"] == "test-key"
        assert meta["ciphertext_version"] == 3
        assert "created_at" in meta

    def test_parse_header_not_openbao_data(self):
        with pytest.raises(RuntimeError, match="missing WIMSBAO1"):
            _parse_openbao_header(b"legacy-data-with-no-header")

    def test_parse_header_missing_each_required_field(self):
        """Each missing required field raises a clear error."""
        base_meta = {
            "provider": "openbao_transit",
            "key_name": "wims-backup",
            "created_at": "2026-06-11T00:00:00Z",
            "ciphertext_version": 5,
        }
        for drop in ("provider", "key_name", "created_at", "ciphertext_version"):
            bad = dict(base_meta)
            del bad[drop]
            data = _HEADER_MAGIC + json.dumps(bad).encode() + b"\nct"
            with pytest.raises(RuntimeError, match="missing required field"):
                _parse_openbao_header(data)


# ════════════════════════════════════════════════════════════════════════════════
# Unknown provider
# ════════════════════════════════════════════════════════════════════════════════


class TestUnknownProvider:
    """encrypt_backup raises on unknown provider."""

    def test_unknown_provider_raises(self, monkeypatch, tmp_path):
        monkeypatch.setenv("WIMS_BACKUP_CRYPTO_PROVIDER", "nonexistent_hsm")
        d = _temp_dir(tmp_path)
        sql = _write_sql_file(d, "bad.sql", b"test")

        with pytest.raises(RuntimeError, match="Unknown backup crypto provider"):
            encrypt_backup(sql)


# ════════════════════════════════════════════════════════════════════════════════
# Function signature preservation
# ════════════════════════════════════════════════════════════════════════════════


class TestSignaturePreservation:
    """encrypt_backup and decrypt_backup maintain their original signatures."""

    def test_encrypt_defaults_output_path(self, monkeypatch, tmp_path):
        """Default output_path = input_path.with_suffix('.sql.enc')."""
        monkeypatch.setenv(BACKUP_KEY_ENV, _valid_master_key_b64())
        d = _temp_dir(tmp_path)
        sql = _write_sql_file(d, "mydump.sql", b"sig-test")

        result = encrypt_backup(sql)
        assert result.name == "mydump.sql.enc"

    def test_decrypt_defaults_output_path(self, monkeypatch, tmp_path):
        """Default output_path = encrypted_path.with_suffix('.sql')."""
        monkeypatch.setenv(BACKUP_KEY_ENV, _valid_master_key_b64())
        d = _temp_dir(tmp_path)
        sql = _write_sql_file(d, "mydump.sql", b"dec-sig-test")
        enc = encrypt_backup(sql)

        result = decrypt_backup(enc)
        # .with_suffix(".sql") on "mydump.sql.enc" → "mydump.sql.sql"
        assert result.name == "mydump.sql.sql"

    def test_encrypt_returns_path(self, monkeypatch, tmp_path):
        """encrypt_backup returns a Path."""
        monkeypatch.setenv(BACKUP_KEY_ENV, _valid_master_key_b64())
        d = _temp_dir(tmp_path)
        sql = _write_sql_file(d, "p.sql", b"x")

        result = encrypt_backup(sql)
        assert isinstance(result, Path)

    def test_decrypt_returns_path(self, monkeypatch, tmp_path):
        """decrypt_backup returns a Path."""
        monkeypatch.setenv(BACKUP_KEY_ENV, _valid_master_key_b64())
        d = _temp_dir(tmp_path)
        sql = _write_sql_file(d, "p.sql", b"y")
        enc = encrypt_backup(sql)

        result = decrypt_backup(enc)
        assert isinstance(result, Path)
