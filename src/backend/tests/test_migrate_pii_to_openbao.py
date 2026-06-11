"""Phase 5 #152 — Migration tooling tests.

Tests for ``scripts/migrate_pii_to_openbao.py`` without a live OpenBao instance.
Uses fakes and mocks exclusively.
"""

from __future__ import annotations

import base64
import secrets
from unittest.mock import MagicMock, patch

import pytest


# ── Helpers ───────────────────────────────────────────────────────────────────


def _valid_master_key() -> str:
    """Return a valid base64-encoded 32-byte AES-256 key."""
    return base64.b64encode(secrets.token_bytes(32)).decode()


def _fake_legacy_sp() -> MagicMock:
    """Fake SecurityProvider that decrypts a known PII dict."""
    sp = MagicMock()
    sp.decrypt_json.return_value = {
        "caller_name": "Juan Dela Cruz",
        "caller_number": "09171234567",
        "owner_name": "Owner",
        "occupant_name": "Occupant",
    }
    sp.crypto_provider = "env_aesgcm"
    sp.kms_key_name = None
    return sp


def _fake_kms_sp() -> MagicMock:
    """Fake KmsSecurityProvider that returns fixed ciphertext."""
    ksp = MagicMock()
    ksp.encrypt_json.return_value = ("OPENBAO_TRANSIT", "vault:v1:migrated-ct")
    ksp.crypto_provider = "openbao_transit"
    ksp.kms_key_name = "wims-incident-pii"
    ksp.current_version = 5
    return ksp


def _fake_kms_sp_no_version() -> MagicMock:
    """Fake KmsSecurityProvider with default current_version=1."""
    ksp = MagicMock()
    ksp.encrypt_json.return_value = ("OPENBAO_TRANSIT", "vault:v1:migrated-ct")
    ksp.crypto_provider = "openbao_transit"
    ksp.kms_key_name = "wims-incident-pii"
    ksp.current_version = 1
    return ksp


# ── Fake Row ──────────────────────────────────────────────────────────────────


class _FakeRow:
    """Simulate a SQLAlchemy Row with attribute access."""

    def __init__(
        self,
        incident_id: int,
        pii_blob_enc: str | None = None,
        encryption_iv: str | None = None,
        crypto_provider: str | None = None,
    ):
        self.incident_id = incident_id
        self.pii_blob_enc = pii_blob_enc
        self.encryption_iv = encryption_iv
        self.crypto_provider = crypto_provider

    def __repr__(self):
        return f"FakeRow(id={self.incident_id}, provider={self.crypto_provider})"


# ── DB mock helpers ───────────────────────────────────────────────────────────


def _make_db_mock(
    rows: list[_FakeRow] | None = None,
    has_key_version: bool = False,
    count_result: int | None = None,
    _state: dict | None = None,
) -> MagicMock:
    """Create a fake DB session mock with captured execute calls.

    The optional ``_state`` dict tracks call counts to allow different
    responses on successive SELECT calls (first call returns rows,
    subsequent calls return empty to terminate the batch loop).
    """
    if _state is None:
        _state = {"select_calls": 0}

    db = MagicMock()
    captured_calls: list[tuple[str, dict]] = []

    def _execute_side_effect(sql_obj, params=None):
        sql_text = str(sql_obj)
        captured_calls.append((sql_text, params or {}))

        # information_schema query
        if "information_schema.columns" in sql_text and "key_version" in sql_text:
            fake_result = MagicMock()
            fake_result.scalar.return_value = has_key_version
            return fake_result

        # COUNT query (dry run)
        if "COUNT(*)" in sql_text:
            fake_result = MagicMock()
            fake_result.scalar.return_value = (
                count_result if count_result is not None else len(rows or [])
            )
            return fake_result

        # SELECT query (migration) — first call returns rows, then empty.
        # Respects batch_limit if present in params so limit tests work.
        if "SELECT incident_id" in sql_text:
            fake_result = MagicMock()
            if _state["select_calls"] == 0:
                result_rows = list(rows or [])
                batch_limit = (params or {}).get("batch_limit")
                if batch_limit is not None and batch_limit < len(result_rows):
                    result_rows = result_rows[:batch_limit]
                fake_result.fetchall.return_value = result_rows
            else:
                fake_result.fetchall.return_value = []
            _state["select_calls"] += 1
            return fake_result

        # UPDATE query
        if "UPDATE wims.incident_sensitive_details" in sql_text:
            fake_result = MagicMock()
            return fake_result

        # Default
        fake_result = MagicMock()
        fake_result.scalar.return_value = None
        fake_result.fetchall.return_value = []
        return fake_result

    db.execute.side_effect = _execute_side_effect
    db.captured_calls = captured_calls
    return db


# ── Import gate ───────────────────────────────────────────────────────────────


try:
    from scripts.migrate_pii_to_openbao import (
        run,
        _has_key_version_column,
        _parse_args,
        main,
    )
except ImportError as exc:
    pytest.fail(f"migrate_pii_to_openbao not importable: {exc}")


# ════════════════════════════════════════════════════════════════════════════════
# Test 1: dry-run does not execute UPDATE/commit, counts candidate rows
# ════════════════════════════════════════════════════════════════════════════════


class TestDryRun:
    """``--dry-run`` must scan candidates without executing any UPDATE or commit."""

    def test_dry_run_counts_candidates_no_update(self, monkeypatch):
        """Dry-run counts rows but never issues UPDATE or commit."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        db = _make_db_mock(
            rows=[_FakeRow(1, "blob1", "iv1", None)],
            count_result=5,
        )
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        args = _parse_args(["--dry-run"])
        stats = run(db, sp, ksp, args)

        assert stats["dry_run"] == 1
        assert stats["total_scanned"] == 5
        assert stats["migrated"] == 0
        assert stats["errors"] == 0

        # Verify no UPDATEs were issued
        update_calls = [(sql, params) for sql, params in db.captured_calls if "UPDATE" in sql]
        assert len(update_calls) == 0, f"Dry-run must not issue UPDATEs, got {len(update_calls)}"

        # Verify db.commit() was not called
        db.commit.assert_not_called()

    def test_dry_run_zero_candidates(self, monkeypatch):
        """Dry-run with zero candidate rows still works."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        db = _make_db_mock(rows=[], count_result=0)
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        args = _parse_args(["--dry-run"])
        stats = run(db, sp, ksp, args)

        assert stats["total_scanned"] == 0
        assert stats["migrated"] == 0
        db.commit.assert_not_called()


# ════════════════════════════════════════════════════════════════════════════════
# Test 2: successful migration decrypts legacy plaintext and updates OpenBao metadata
# ════════════════════════════════════════════════════════════════════════════════


class TestSuccessfulMigration:
    """Migration must decrypt env-AES blobs and re-encrypt via OpenBao."""

    def test_single_row_migration_updates_openbao_metadata(self, monkeypatch):
        """A legacy row gets decrypted, re-encrypted, and updated with OpenBao metadata."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        db = _make_db_mock(
            rows=[_FakeRow(42, "legacy-blob", "legacy-iv", None)],
            has_key_version=False,
        )
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        args = _parse_args(["--batch-size", "10"])
        stats = run(db, sp, ksp, args)

        # Verify decryption was called with correct AAD
        sp.decrypt_json.assert_called_once_with("legacy-iv", "legacy-blob", b"incident_id:42")

        # Verify re-encryption was called with correct AAD
        ksp.encrypt_json.assert_called_once()
        call_args, _ = ksp.encrypt_json.call_args
        assert call_args[1] == b"incident_id:42"

        # Verify UPDATE was issued
        update_calls = [
            (sql, params)
            for sql, params in db.captured_calls
            if "UPDATE wims.incident_sensitive_details" in sql
        ]
        assert len(update_calls) >= 1

        sql, params = update_calls[-1]
        assert params.get("blob") == "vault:v1:migrated-ct"
        assert params.get("crypto_provider") == "openbao_transit"
        assert params.get("kms_key_name") == "wims-incident-pii"
        assert "encryption_iv = NULL" in sql
        assert "key_version" not in sql  # no column detected

        assert stats["migrated"] == 1
        assert stats["errors"] == 0

    def test_multiple_rows_migrated_in_batches(self, monkeypatch):
        """Multiple rows in a batch all get migrated."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        # 3 rows, batch size 2 — mock returns all 3 at once
        # so all are processed in one loop iteration
        rows = [
            _FakeRow(1, "blob1", "iv1", None),
            _FakeRow(2, "blob2", "iv2", "env_aesgcm"),
            _FakeRow(3, "blob3", "iv3", None),
        ]
        db = _make_db_mock(rows=rows, has_key_version=False)
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        args = _parse_args(["--batch-size", "2"])
        stats = run(db, sp, ksp, args)

        # With batch_limit=2, mock returns 2 rows (realistic LIMIT simulation)
        assert stats["migrated"] == 2
        assert stats["errors"] == 0
        assert sp.decrypt_json.call_count == 2
        assert ksp.encrypt_json.call_count == 2
        # At least one commit must have happened
        assert db.commit.call_count >= 1
        # The SELECT query used the correct batch LIMIT parameter
        select_calls = [
            (sql, params) for sql, params in db.captured_calls if "SELECT incident_id" in sql
        ]
        assert len(select_calls) >= 1
        _, params = select_calls[0]
        assert params.get("batch_limit") == 2


# ════════════════════════════════════════════════════════════════════════════════
# Test 3: rows already openbao_transit are skipped
# ════════════════════════════════════════════════════════════════════════════════


class TestIdempotentSkip:
    """Rows with ``crypto_provider='openbao_transit'`` must be skipped."""

    def test_openbao_row_is_skipped(self, monkeypatch):
        """Already migrated row increments already_openbao counter, not migrated."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        rows = [
            _FakeRow(1, "blob1", "iv1", None),
            _FakeRow(2, "blob2", None, "openbao_transit"),  # already done
            _FakeRow(3, "blob3", "iv3", "env_aesgcm"),
        ]
        db = _make_db_mock(rows=rows, has_key_version=False)
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        args = _parse_args(["--batch-size", "10"])
        stats = run(db, sp, ksp, args)

        assert stats["already_openbao"] == 1
        assert stats["migrated"] == 2
        # row 2 should never be decrypted or encrypted
        assert sp.decrypt_json.call_count == 2
        assert ksp.encrypt_json.call_count == 2

    def test_all_rows_already_openbao(self, monkeypatch):
        """All rows already migrated — zero new migrations, zero errors."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        rows = [
            _FakeRow(10, "blob", None, "openbao_transit"),
            _FakeRow(20, "blob", None, "openbao_transit"),
        ]
        db = _make_db_mock(rows=rows, has_key_version=False)
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        args = _parse_args(["--batch-size", "10"])
        stats = run(db, sp, ksp, args)

        assert stats["already_openbao"] == 2
        assert stats["migrated"] == 0
        assert sp.decrypt_json.call_count == 0
        assert ksp.encrypt_json.call_count == 0


# ════════════════════════════════════════════════════════════════════════════════
# Test 4: decryption failure isolates row and continues to next
# ════════════════════════════════════════════════════════════════════════════════


class TestErrorIsolation:
    """One bad row must not halt the entire migration batch."""

    def test_decryption_failure_increments_errors_continues(self, monkeypatch):
        """A row that fails decrypt is skipped; subsequent rows still migrate."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        sp = _fake_legacy_sp()

        # Row 2 fails decryption
        def _decrypt_side_effect(nonce, ct, aad):
            if ct == "bad-blob":
                raise ValueError("simulated decrypt failure")
            return {"caller_name": "Test", "caller_number": "123"}

        sp.decrypt_json.side_effect = _decrypt_side_effect

        rows = [
            _FakeRow(1, "good-blob", "iv1", None),
            _FakeRow(2, "bad-blob", "iv2", None),
            _FakeRow(3, "good-blob2", "iv3", "env_aesgcm"),
        ]
        db = _make_db_mock(rows=rows, has_key_version=False)
        ksp = _fake_kms_sp()

        args = _parse_args(["--batch-size", "10"])
        stats = run(db, sp, ksp, args)

        assert stats["migrated"] == 2
        assert stats["errors"] == 1
        # Row 2 never reaches encrypt
        assert ksp.encrypt_json.call_count == 2

    def test_encrypt_failure_increments_errors_continues(self, monkeypatch):
        """A row that fails encrypt is skipped; subsequent rows still migrate."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        # Row 2 fails encryption
        def _encrypt_side_effect(pii_dict, aad):
            if pii_dict.get("caller_name") == "Fail Me":
                raise RuntimeError("simulated encrypt failure")
            return ("OPENBAO_TRANSIT", "vault:v1:ok")

        ksp.encrypt_json.side_effect = _encrypt_side_effect

        # Set different plaintexts for different rows
        def _decrypt_side_effect(nonce, ct, aad):
            if ct == "blob2":
                return {"caller_name": "Fail Me"}
            return {"caller_name": "Test"}

        sp.decrypt_json.side_effect = _decrypt_side_effect

        rows = [
            _FakeRow(1, "blob1", "iv1", None),
            _FakeRow(2, "blob2", "iv2", None),
            _FakeRow(3, "blob3", "iv3", None),
        ]
        db = _make_db_mock(rows=rows, has_key_version=False)

        args = _parse_args(["--batch-size", "10"])
        stats = run(db, sp, ksp, args)

        assert stats["migrated"] == 2
        assert stats["errors"] == 1

    def test_update_failure_increments_errors_continues(self, monkeypatch):
        """A row whose UPDATE fails is counted as error; next rows proceed."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        db = _make_db_mock(
            rows=[
                _FakeRow(1, "blob1", "iv1", None),
                _FakeRow(2, "blob2", "iv2", None),
            ],
            has_key_version=False,
        )

        # Make UPDATE fail for incident_id=2 by replacing execute
        # Save the current side_effect and build a wrapping one
        _base_side_effect = db.execute.side_effect

        def _wrapping_side_effect(sql_obj, params=None):
            sql_text = str(sql_obj)
            if "UPDATE wims.incident_sensitive_details" in sql_text:
                if params and params.get("iid") == 2:
                    raise RuntimeError("simulated DB error")
            return _base_side_effect(sql_obj, params)

        db.execute.side_effect = _wrapping_side_effect

        args = _parse_args(["--batch-size", "10"])
        stats = run(db, sp, ksp, args)

        assert stats["migrated"] >= 1  # row 1 should succeed
        assert stats["errors"] >= 1  # row 2 should be an error


# ════════════════════════════════════════════════════════════════════════════════
# Test 5: --incident-id, --resume-after, --limit affect SELECT behavior
# ════════════════════════════════════════════════════════════════════════════════


class TestCliFlags:
    """CLI flags must change query parameters, not just stats."""

    def test_incident_id_flag_adds_where_clause(self, monkeypatch):
        """--incident-id 42 → WHERE ... AND incident_id = 42."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        db = _make_db_mock(
            rows=[_FakeRow(42, "blob", "iv", None)],
            has_key_version=False,
        )
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        args = _parse_args(["--incident-id", "42"])
        run(db, sp, ksp, args)

        # The SELECT query must contain "incident_id = :incident_id"
        select_calls = [
            (sql, params) for sql, params in db.captured_calls if "SELECT incident_id" in sql
        ]
        assert len(select_calls) >= 1
        sql, params = select_calls[0]
        assert "incident_id = :incident_id" in sql
        assert params.get("incident_id") == 42

    def test_resume_after_flag_adds_cursor(self, monkeypatch):
        """--resume-after 50 → WHERE ... AND incident_id > :cursor with cursor=50."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        db = _make_db_mock(
            rows=[_FakeRow(51, "blob", "iv", None)],
            has_key_version=False,
        )
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        args = _parse_args(["--resume-after", "50"])
        run(db, sp, ksp, args)

        select_calls = [
            (sql, params) for sql, params in db.captured_calls if "SELECT incident_id" in sql
        ]
        assert len(select_calls) >= 1
        sql, params = select_calls[0]
        assert "incident_id > :cursor" in sql
        assert params.get("cursor") == 50

    def test_limit_caps_total_processed(self, monkeypatch):
        """--limit 2 with 5 candidate rows processes at most 2."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        rows = [_FakeRow(i, f"blob{i}", f"iv{i}", None) for i in range(1, 6)]
        db = _make_db_mock(rows=rows[:3], has_key_version=False)  # first batch
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        args = _parse_args(["--limit", "2", "--batch-size", "3"])
        stats = run(db, sp, ksp, args)

        # With limit=2, batch-size=3, the first batch LIMIT should be 2
        select_calls = [
            (sql, params) for sql, params in db.captured_calls if "SELECT incident_id" in sql
        ]
        assert len(select_calls) >= 1
        _, params = select_calls[0]
        assert params.get("batch_limit") == 2

        # Mock respects batch_limit, so at most 2 rows processed
        assert stats["migrated"] == 2


# ════════════════════════════════════════════════════════════════════════════════
# Test 6: key_version column update gated on column detection
# ════════════════════════════════════════════════════════════════════════════════


class TestKeyVersionColumn:
    """key_version is updated only when the column exists in the schema."""

    def test_key_version_included_when_column_exists(self, monkeypatch):
        """When information_schema reports key_version column, UPDATE includes it."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        db = _make_db_mock(
            rows=[_FakeRow(1, "blob", "iv", None)],
            has_key_version=True,
        )
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()  # current_version = 5

        args = _parse_args(["--batch-size", "10"])
        stats = run(db, sp, ksp, args)

        assert stats["migrated"] == 1

        update_calls = [
            (sql, params)
            for sql, params in db.captured_calls
            if "UPDATE wims.incident_sensitive_details" in sql
        ]
        assert len(update_calls) >= 1
        sql, params = update_calls[-1]
        assert "key_version" in sql
        assert params.get("key_version") == 5

    def test_key_version_omitted_when_column_absent(self, monkeypatch):
        """When information_schema reports no key_version column, UPDATE excludes it."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        db = _make_db_mock(
            rows=[_FakeRow(1, "blob", "iv", None)],
            has_key_version=False,
        )
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp_no_version()

        args = _parse_args(["--batch-size", "10"])
        stats = run(db, sp, ksp, args)

        assert stats["migrated"] == 1

        update_calls = [
            (sql, params)
            for sql, params in db.captured_calls
            if "UPDATE wims.incident_sensitive_details" in sql
        ]
        assert len(update_calls) >= 1
        sql, params = update_calls[-1]
        assert "key_version" not in sql
        assert "key_version" not in params

    def test_key_version_default_one(self, monkeypatch):
        """KmsSecurityProvider starts with current_version=1 by default."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        db = _make_db_mock(
            rows=[_FakeRow(1, "blob", "iv", None)],
            has_key_version=True,
        )
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp_no_version()  # current_version = 1

        args = _parse_args(["--batch-size", "10"])
        run(db, sp, ksp, args)

        update_calls = [
            (sql, params)
            for sql, params in db.captured_calls
            if "UPDATE wims.incident_sensitive_details" in sql
        ]
        assert len(update_calls) >= 1
        _, params = update_calls[-1]
        assert params.get("key_version") == 1


# ════════════════════════════════════════════════════════════════════════════════
# Test 7: main exits 1 when errors > 0
# ════════════════════════════════════════════════════════════════════════════════


class TestMainExitCodes:
    """``main()`` must exit with code 1 when errors > 0, 0 otherwise."""

    def test_main_exits_zero_on_success(self, monkeypatch):
        """No errors → exit 0."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")

        db = _make_db_mock(
            rows=[_FakeRow(1, "blob", "iv", None)],
            has_key_version=False,
        )
        sp = _fake_legacy_sp()
        ksp = _fake_kms_sp()

        with patch("scripts.migrate_pii_to_openbao._AdminSessionLocal", return_value=db):
            with patch("scripts.migrate_pii_to_openbao.SecurityProvider", return_value=sp):
                with patch("scripts.migrate_pii_to_openbao.KmsSecurityProvider", return_value=ksp):
                    with pytest.raises(SystemExit) as exc_info:
                        main(["--batch-size", "10"])
                    assert exc_info.value.code == 0

    def test_main_exits_one_on_errors(self, monkeypatch):
        """Errors > 0 → exit 1."""
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")

        sp = _fake_legacy_sp()
        sp.decrypt_json.side_effect = ValueError("decrypt fail")

        db = _make_db_mock(
            rows=[_FakeRow(1, "blob", "iv", None)],
            has_key_version=False,
        )
        ksp = _fake_kms_sp()

        with patch("scripts.migrate_pii_to_openbao._AdminSessionLocal", return_value=db):
            with patch("scripts.migrate_pii_to_openbao.SecurityProvider", return_value=sp):
                with patch("scripts.migrate_pii_to_openbao.KmsSecurityProvider", return_value=ksp):
                    with pytest.raises(SystemExit) as exc_info:
                        main(["--batch-size", "10"])
                    assert exc_info.value.code == 1

    def test_main_exits_two_on_missing_env(self, monkeypatch):
        """Missing DATABASE_URL → exit 2."""
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("SQLALCHEMY_DATABASE_URL", raising=False)
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())

        with pytest.raises(SystemExit) as exc_info:
            main(["--dry-run"])
        assert exc_info.value.code == 2

    def test_main_exits_two_on_missing_master_key(self, monkeypatch):
        """Missing WIMS_MASTER_KEY → exit 2."""
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
        monkeypatch.delenv("WIMS_MASTER_KEY", raising=False)

        with pytest.raises(SystemExit) as exc_info:
            main(["--dry-run"])
        assert exc_info.value.code == 2

    def test_main_exits_two_on_missing_openbao_addr(self, monkeypatch):
        """Missing OPENBAO_ADDR → exit 2."""
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
        monkeypatch.setenv("WIMS_MASTER_KEY", _valid_master_key())
        monkeypatch.delenv("OPENBAO_ADDR", raising=False)

        with pytest.raises(SystemExit) as exc_info:
            main(["--dry-run"])
        assert exc_info.value.code == 2


# ════════════════════════════════════════════════════════════════════════════════
# Test: _has_key_version_column detection
# ════════════════════════════════════════════════════════════════════════════════


class TestKeyVersionDetection:
    """``_has_key_version_column`` correctly detects column presence."""

    def test_returns_true_when_column_exists(self):
        """information_schema returns true."""
        db = _make_db_mock(has_key_version=True)
        assert _has_key_version_column(db) is True

    def test_returns_false_when_column_absent(self):
        """information_schema returns false."""
        db = _make_db_mock(has_key_version=False)
        assert _has_key_version_column(db) is False

    def test_returns_false_when_scalar_is_none(self):
        """Edge case: scalar returns None."""
        db = MagicMock()
        fake_result = MagicMock()
        fake_result.scalar.return_value = None
        db.execute.return_value = fake_result
        assert _has_key_version_column(db) is False
