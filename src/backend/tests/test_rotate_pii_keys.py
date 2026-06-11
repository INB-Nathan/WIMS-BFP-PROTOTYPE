"""Tests for rotate_pii_keys.py — PII key rotation script."""

import base64
import logging
import secrets
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


# ── Helpers ──────────────────────────────────────────────────────────────────


def _fresh_key() -> bytes:
    return secrets.token_bytes(32)


def _key_b64(k: bytes) -> str:
    return base64.b64encode(k).decode()


def _make_row(incident_id, pii_blob_enc, encryption_iv, key_version):
    return SimpleNamespace(
        incident_id=incident_id,
        pii_blob_enc=pii_blob_enc,
        encryption_iv=encryption_iv,
        key_version=key_version,
    )


def _encrypt_v1_row(sp, incident_id, pii_dict):
    """Encrypt a PII dict with v1 key and return a SimpleNamespace row."""
    aad = f"incident_id:{incident_id}".encode("utf-8")
    nonce_b64, ct_b64 = sp.encrypt_json(pii_dict, aad)
    return _make_row(incident_id, ct_b64, nonce_b64, 1)


def _encrypt_v2_row(sp, incident_id, pii_dict):
    """Encrypt a PII dict with v2 key (switch _current_version) and return a SimpleNamespace row."""
    orig = sp._current_version
    sp._current_version = 2
    try:
        aad = f"incident_id:{incident_id}".encode("utf-8")
        nonce_b64, ct_b64 = sp.encrypt_json(pii_dict, aad)
    finally:
        sp._current_version = orig
    return _make_row(incident_id, ct_b64, nonce_b64, 2)


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def env_with_keys(monkeypatch):
    """Set up v1 and v2 keys in the environment, current=v1."""
    k1 = _fresh_key()
    k2 = _fresh_key()
    monkeypatch.setenv("WIMS_MASTER_KEY", _key_b64(k1))
    monkeypatch.setenv("WIMS_MASTER_KEY_V2", _key_b64(k2))
    monkeypatch.setenv("WIMS_KEY_CURRENT_VERSION", "1")
    monkeypatch.setenv("DATABASE_URL", "postgresql://mock@localhost/mock")
    return k1, k2


@pytest.fixture
def mock_db():
    """Mock create_engine and Session to avoid needing a real database."""
    with patch("scripts.rotate_pii_keys.create_engine") as mock_ce:
        with patch("scripts.rotate_pii_keys.Session") as mock_session_cls:
            mock_engine = MagicMock()
            mock_ce.return_value = mock_engine
            mock_session = MagicMock()
            mock_session_cls.return_value.__enter__.return_value = mock_session

            # Default: no rows returned
            mock_result = MagicMock()
            mock_result.yield_per.return_value = []
            mock_session.execute.return_value = mock_result

            yield mock_session


@pytest.fixture
def sp(env_with_keys):
    """SecurityProvider with v1 and v2 keys loaded (current=v1)."""
    from utils.crypto import SecurityProvider

    return SecurityProvider()


# ════════════════════════════════════════════════════════════════════════════════
# Dry-run
# ════════════════════════════════════════════════════════════════════════════════


class TestDryRun:
    """--dry-run flag must not modify the database."""

    def test_dry_run_does_not_write(self, sp, mock_db):
        from scripts.rotate_pii_keys import rotate

        rows = [
            _encrypt_v1_row(sp, 1, {"caller_name": "Alice"}),
            _encrypt_v1_row(sp, 2, {"caller_name": "Bob"}),
        ]
        mock_db.execute.return_value.yield_per.return_value = rows

        stats = rotate(dry_run=True, target_version=2, batch_size=100)

        assert stats["dry_run"] is True
        assert stats["rotated"] == 2
        assert stats["errors"] == 0
        assert stats["total"] == 2
        mock_db.commit.assert_not_called()

    def test_dry_run_logs_candidates(self, sp, mock_db, caplog):
        from scripts.rotate_pii_keys import rotate

        caplog.set_level(logging.INFO)
        row = _encrypt_v1_row(sp, 99, {"caller_name": "Test"})
        mock_db.execute.return_value.yield_per.return_value = [row]

        rotate(dry_run=True, target_version=2, batch_size=100)

        assert any("DRY RUN" in msg for msg in caplog.messages)
        assert any("incident_id=99" in msg for msg in caplog.messages)

    def test_dry_run_empty_table_is_noop(self, sp, mock_db):
        from scripts.rotate_pii_keys import rotate

        mock_db.execute.return_value.yield_per.return_value = []

        stats = rotate(dry_run=True, target_version=2, batch_size=100)

        assert stats["total"] == 0
        assert stats["rotated"] == 0
        assert stats["errors"] == 0
        mock_db.commit.assert_not_called()


# ════════════════════════════════════════════════════════════════════════════════
# Idempotency
# ════════════════════════════════════════════════════════════════════════════════


class TestIdempotency:
    """Running against already-rotated rows must be a no-op."""

    def test_all_rows_already_at_target(self, sp, mock_db):
        from scripts.rotate_pii_keys import rotate

        rows = [_encrypt_v2_row(sp, i, {"caller_name": f"P{i}"}) for i in range(1, 4)]
        mock_db.execute.return_value.yield_per.return_value = rows

        stats = rotate(dry_run=False, target_version=2, batch_size=100)

        assert stats["already_current"] == 3
        assert stats["rotated"] == 0
        assert stats["errors"] == 0
        # commit is still called (no-op on read-only txn)
        mock_db.commit.assert_called_once()

    def test_mixed_versions_only_rotates_stale(self, sp, mock_db):
        from scripts.rotate_pii_keys import rotate

        rows = [
            _encrypt_v2_row(sp, 1, {"caller_name": "Current"}),
            _encrypt_v1_row(sp, 2, {"caller_name": "Stale"}),
        ]
        mock_db.execute.return_value.yield_per.return_value = rows

        stats = rotate(dry_run=False, target_version=2, batch_size=100)

        assert stats["already_current"] == 1
        assert stats["rotated"] == 1
        assert stats["errors"] == 0
        mock_db.commit.assert_called_once()


# ════════════════════════════════════════════════════════════════════════════════
# Batch flushing
# ════════════════════════════════════════════════════════════════════════════════


class TestBatchFlushing:
    """batch_size boundary must be respected."""

    def test_batch_size_boundary(self, sp, mock_db):
        from scripts.rotate_pii_keys import rotate

        # 25 rows with batch_size=10 → 2 full flushes of 10, then 5 trailing
        rows = [_encrypt_v1_row(sp, i, {"caller_name": f"P{i}"}) for i in range(1, 26)]
        mock_db.execute.return_value.yield_per.return_value = rows

        flush_sizes: list[int] = []

        def _track_flush(db, pending):
            flush_sizes.append(len(pending))

        with patch("scripts.rotate_pii_keys._flush", side_effect=_track_flush):
            stats = rotate(dry_run=False, target_version=2, batch_size=10)

        assert stats["rotated"] == 25
        assert flush_sizes == [10, 10, 5]

    def test_single_batch(self, sp, mock_db):
        """Fewer rows than batch_size should flush once at end."""
        from scripts.rotate_pii_keys import rotate

        rows = [_encrypt_v1_row(sp, i, {"caller_name": f"P{i}"}) for i in range(1, 4)]
        mock_db.execute.return_value.yield_per.return_value = rows

        flush_sizes: list[int] = []

        def _track_flush(db, pending):
            flush_sizes.append(len(pending))

        with patch("scripts.rotate_pii_keys._flush", side_effect=_track_flush):
            stats = rotate(dry_run=False, target_version=2, batch_size=100)

        assert stats["rotated"] == 3
        assert flush_sizes == [3]

    def test_exact_multiple_of_batch_size(self, sp, mock_db):
        """Exactly N*batch_size rows: no trailing flush needed."""
        from scripts.rotate_pii_keys import rotate

        rows = [_encrypt_v1_row(sp, i, {"caller_name": f"P{i}"}) for i in range(1, 21)]
        mock_db.execute.return_value.yield_per.return_value = rows

        flush_sizes: list[int] = []

        def _track_flush(db, pending):
            flush_sizes.append(len(pending))

        with patch("scripts.rotate_pii_keys._flush", side_effect=_track_flush):
            stats = rotate(dry_run=False, target_version=2, batch_size=10)

        assert stats["rotated"] == 20
        assert flush_sizes == [10, 10]


# ════════════════════════════════════════════════════════════════════════════════
# Per-row error isolation
# ════════════════════════════════════════════════════════════════════════════════


class TestErrorIsolation:
    """A single decryption failure must skip that row and continue to the next."""

    def test_decryption_failure_skips_and_continues(self, sp, mock_db):
        from scripts.rotate_pii_keys import rotate

        rows = [
            _encrypt_v1_row(sp, 1, {"caller_name": "Good"}),
            # Bad row: invalid base64 ciphertext → decryption raises
            _make_row(2, "!!!invalid-base64!!!", "dGVzdA==", 1),
            _encrypt_v1_row(sp, 3, {"caller_name": "AlsoGood"}),
        ]
        mock_db.execute.return_value.yield_per.return_value = rows

        stats = rotate(dry_run=False, target_version=2, batch_size=100)

        assert stats["errors"] == 1
        assert stats["rotated"] == 2
        assert stats["total"] == 3

    def test_all_rows_fail(self, sp, mock_db):
        """When every row has bad data, errors count reflects total."""
        from scripts.rotate_pii_keys import rotate

        rows = [
            _make_row(1, "!!!bad!!!", "dGVzdA==", 1),
            _make_row(2, "!!!bad!!!", "dGVzdA==", 1),
        ]
        mock_db.execute.return_value.yield_per.return_value = rows

        stats = rotate(dry_run=False, target_version=2, batch_size=100)

        assert stats["errors"] == 2
        assert stats["rotated"] == 0


# ════════════════════════════════════════════════════════════════════════════════
# State restoration (Fix A)
# ════════════════════════════════════════════════════════════════════════════════


class TestStateRestoration:
    """_current_version must be restored after each row, even on errors."""

    def test_current_version_restored_after_success(self, sp, mock_db):
        from scripts.rotate_pii_keys import rotate

        row = _encrypt_v1_row(sp, 1, {"caller_name": "Alice"})
        mock_db.execute.return_value.yield_per.return_value = [row]

        assert sp._current_version == 1
        rotate(dry_run=False, target_version=2, batch_size=100)
        assert sp._current_version == 1, "version should be restored to original"

    def test_current_version_restored_after_reencrypt_error(
        self, env_with_keys, mock_db, monkeypatch
    ):
        from unittest.mock import MagicMock

        from utils.crypto import SecurityProviderError

        from scripts.rotate_pii_keys import rotate

        # Mock SecurityProvider to raise on encrypt_json
        mock_sp = MagicMock()
        mock_sp._current_version = 1
        mock_sp.current_version = 1
        mock_sp._keyring = {1: MagicMock(), 2: MagicMock()}
        mock_sp.decrypt_json.return_value = {"caller_name": "Test"}
        mock_sp.encrypt_json.side_effect = SecurityProviderError("mock encrypt failure")

        monkeypatch.setattr("scripts.rotate_pii_keys.SecurityProvider", lambda: mock_sp)

        row = _make_row(1, "dGVzdA==", "dGVzdA==", 1)
        mock_db.execute.return_value.yield_per.return_value = [row]

        stats = rotate(dry_run=False, target_version=2, batch_size=100)

        assert stats["errors"] == 1
        assert mock_sp._current_version == 1, "version should be restored after failure"

    def test_current_version_stable_across_multiple_rows(self, sp, mock_db):
        """Two rows: first rotates OK, verify version stays 1 after both."""
        from scripts.rotate_pii_keys import rotate

        rows = [
            _encrypt_v1_row(sp, 1, {"caller_name": "First"}),
            _encrypt_v1_row(sp, 2, {"caller_name": "Second"}),
        ]
        mock_db.execute.return_value.yield_per.return_value = rows

        assert sp._current_version == 1
        rotate(dry_run=False, target_version=2, batch_size=100)
        assert sp._current_version == 1, "version should still be 1 after processing multiple rows"


# ════════════════════════════════════════════════════════════════════════════════
# Exit codes
# ════════════════════════════════════════════════════════════════════════════════


class TestExitCodes:
    """Exit code 1 when errors > 0, exit code 0 when all succeed."""

    def test_exit_code_1_when_errors(self, monkeypatch):
        monkeypatch.setattr("sys.argv", ["rotate_pii_keys.py", "--dry-run"])
        monkeypatch.setattr(
            "scripts.rotate_pii_keys.rotate",
            lambda **kw: {
                "errors": 1,
                "total": 5,
                "rotated": 0,
                "already_current": 4,
                "dry_run": True,
            },
        )
        import scripts.rotate_pii_keys

        with pytest.raises(SystemExit) as exc:
            scripts.rotate_pii_keys.main()
        assert exc.value.code == 1

    def test_exit_code_0_when_no_errors(self, monkeypatch):
        monkeypatch.setattr("sys.argv", ["rotate_pii_keys.py", "--dry-run"])
        monkeypatch.setattr(
            "scripts.rotate_pii_keys.rotate",
            lambda **kw: {
                "errors": 0,
                "total": 5,
                "rotated": 5,
                "already_current": 0,
                "dry_run": True,
            },
        )
        import scripts.rotate_pii_keys

        # Should not raise SystemExit
        scripts.rotate_pii_keys.main()


# ════════════════════════════════════════════════════════════════════════════════
# Edge cases
# ════════════════════════════════════════════════════════════════════════════════


class TestEdgeCases:
    """Empty table, single row, mixed versions."""

    def test_empty_table(self, sp, mock_db):
        from scripts.rotate_pii_keys import rotate

        mock_db.execute.return_value.yield_per.return_value = []

        stats = rotate(dry_run=False, target_version=2, batch_size=100)

        assert stats["total"] == 0
        assert stats["rotated"] == 0
        assert stats["errors"] == 0
        mock_db.commit.assert_called_once()

    def test_single_row(self, sp, mock_db):
        from scripts.rotate_pii_keys import rotate

        row = _encrypt_v1_row(sp, 42, {"caller_name": "Only"})
        mock_db.execute.return_value.yield_per.return_value = [row]

        stats = rotate(dry_run=False, target_version=2, batch_size=100)

        assert stats["total"] == 1
        assert stats["rotated"] == 1
        assert stats["errors"] == 0
        mock_db.commit.assert_called_once()

    def test_single_row_dry_run(self, sp, mock_db):
        from scripts.rotate_pii_keys import rotate

        row = _encrypt_v1_row(sp, 42, {"caller_name": "Only"})
        mock_db.execute.return_value.yield_per.return_value = [row]

        stats = rotate(dry_run=True, target_version=2, batch_size=100)

        assert stats["total"] == 1
        assert stats["rotated"] == 1
        assert stats["errors"] == 0
        mock_db.commit.assert_not_called()

    def test_mixed_versions_dry_run(self, sp, mock_db):
        from scripts.rotate_pii_keys import rotate

        rows = [
            _encrypt_v2_row(sp, 1, {"caller_name": "AlreadyV2"}),
            _encrypt_v1_row(sp, 2, {"caller_name": "NeedsRotation"}),
        ]
        mock_db.execute.return_value.yield_per.return_value = rows

        stats = rotate(dry_run=True, target_version=2, batch_size=100)

        assert stats["already_current"] == 1
        assert stats["rotated"] == 1
        assert stats["total"] == 2
        mock_db.commit.assert_not_called()
