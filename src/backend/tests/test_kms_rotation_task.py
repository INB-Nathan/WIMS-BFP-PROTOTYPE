"""Phase 6 #152 — KMS key rotation task tests.

Tests for ``tasks/kms_rotation.py``.
No live OpenBao. Uses fakes and mocks exclusively.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

# ── Helpers ───────────────────────────────────────────────────────────────────


def _kms_health_mock() -> MagicMock:
    h = MagicMock()
    h.initialized = True
    h.version = "2.2.0"
    return h


def _kms_metadata_mock(
    key_name: str = "wims-incident-pii",
    latest_version: int = 1,
) -> MagicMock:
    md = MagicMock()
    md.name = key_name
    md.latest_version = latest_version
    md.min_decryptable_version = 1
    md.keys = {}
    return md


def _kms_ciphertext_mock(ciphertext: str = "vault:v2:fake-ct", key_version: int = 2) -> MagicMock:
    ct = MagicMock()
    ct.ciphertext = ciphertext
    ct.key_version = key_version
    return ct


def _fake_kms_provider(
    key_name: str = "wims-incident-pii",
    latest_version: int = 1,
    rewrap_result: tuple[str, int] | None = None,
    rotate_to: int = 2,
) -> MagicMock:
    """Create a fake KmsSecurityProvider backed by a fake OpenBaoClient."""
    ksp = MagicMock()
    ksp.kms_key_name = key_name

    client = MagicMock()
    client.metadata.return_value = _kms_metadata_mock(key_name, latest_version)
    if rewrap_result is not None:
        client.rewrap.return_value = _kms_ciphertext_mock(
            ciphertext=rewrap_result[0], key_version=rewrap_result[1]
        )
    else:
        client.rewrap.return_value = _kms_ciphertext_mock()

    new_md = _kms_metadata_mock(key_name, rotate_to)
    client.rotate.return_value = new_md

    ksp._client = client
    return ksp


# ── Fake Row ──────────────────────────────────────────────────────────────────


class _FakeRow:
    def __init__(
        self,
        incident_id: int,
        pii_blob_enc: str = "vault:v1:old-ct",
        key_version: int | None = None,
    ):
        self.incident_id = incident_id
        self.pii_blob_enc = pii_blob_enc
        self.key_version = key_version

    def __repr__(self):
        return f"FakeRow(id={self.incident_id}, kv={self.key_version})"


# ── Import gate ───────────────────────────────────────────────────────────────


try:
    from tasks.kms_rotation import (
        ensure_pii_key_rotation,
        is_rotation_due,
        start_rotation_run,
        rewrap_openbao_rows,
        mark_rotation_success,
        mark_rotation_failure,
    )
except ImportError as exc:
    pytest.fail(f"kms_rotation not importable: {exc}")


# ════════════════════════════════════════════════════════════════════════════════
# Test 1: is_rotation_due — threshold logic
# ════════════════════════════════════════════════════════════════════════════════


class TestIsRotationDue:
    """``is_rotation_due`` returns correct boolean for various timestamps."""

    def test_due_when_no_prior_success(self):
        """Never rotated → due immediately."""
        assert is_rotation_due(None) is True

    def test_not_due_before_90_days(self):
        """A rotation 30 days ago is not due."""
        now = datetime(2026, 6, 11, 12, 0, 0, tzinfo=timezone.utc)
        last = now - timedelta(days=30)
        assert is_rotation_due(last, now=now) is False

    def test_due_at_exactly_90_days(self):
        """A rotation exactly 90 days ago is due."""
        now = datetime(2026, 6, 11, 12, 0, 0, tzinfo=timezone.utc)
        last = now - timedelta(days=90)
        assert is_rotation_due(last, now=now) is True

    def test_due_after_90_days(self):
        """A rotation 91 days ago is due."""
        now = datetime(2026, 6, 11, 12, 0, 0, tzinfo=timezone.utc)
        last = now - timedelta(days=91)
        assert is_rotation_due(last, now=now) is True

    def test_respects_custom_interval(self):
        """interval_days=30 → due at 30 days."""
        now = datetime(2026, 6, 11, 12, 0, 0, tzinfo=timezone.utc)
        last = now - timedelta(days=29)
        assert is_rotation_due(last, interval_days=30, now=now) is False
        last = now - timedelta(days=30)
        assert is_rotation_due(last, interval_days=30, now=now) is True


# ════════════════════════════════════════════════════════════════════════════════
# Test 2: Active RUNNING row prevents duplicate run
# ════════════════════════════════════════════════════════════════════════════════


class TestSingleRunGuard:
    """Only one rotation run may be active at a time."""

    def test_active_running_row_skips_rotation(self, monkeypatch):
        """When a RUNNING row exists, ensure_pii_key_rotation no-ops."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.setenv("OPENBAO_PII_KEY_NAME", "wims-incident-pii")

        db = MagicMock()

        # active RUNNING row returned
        fake_active_row = MagicMock()
        fake_active_row.run_id = "00000000-0000-0000-0000-00000000dead"
        db.execute.return_value.fetchone.return_value = fake_active_row
        db.execute.return_value.fetchall.return_value = []

        with patch("tasks.kms_rotation._AdminSessionLocal", return_value=db):
            result = ensure_pii_key_rotation()

        assert result["rotated"] is False
        assert result["run_id"] is None
        assert "active RUNNING run" in result["reason"]


# ════════════════════════════════════════════════════════════════════════════════
# Test 3: Due run calls rotate and starts a run row
# ════════════════════════════════════════════════════════════════════════════════


class TestDueRotationStartsRun:
    """When rotation is due, the task rotates the key and records a run."""

    def test_due_rotation_calls_rotate_and_records_run(self, monkeypatch):
        """Task rotates key, records run, returns counters."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.setenv("OPENBAO_PII_KEY_NAME", "wims-incident-pii")

        db = MagicMock()
        db.execute.return_value.scalar.return_value = "00000000-0000-0000-0000-0000deadbeef"

        # No active RUNNING row (first call), no rows to rewrap
        def _execute_side_effect(sql_obj, params=None):
            sql_text = str(sql_obj)
            result = MagicMock()

            # First call: check RUNNING → None
            # Second call: last success → None
            # Third call: start_rotation_run → INSERT
            # Fourth+ calls: rewrap batches → no rows
            if "WHERE status = 'RUNNING'" in sql_text:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
                return result
            if "ORDER BY completed_at DESC" in sql_text:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
                return result
            if "INSERT INTO wims.kms_key_rotation_runs" in sql_text:
                result.scalar.return_value = "00000000-0000-0000-0000-0000deadbeef"
                result.fetchone.return_value = None
                return result
            if "information_schema.columns" in sql_text:
                result.scalar.return_value = False
                return result
            result.fetchone = lambda: None
            result.fetchall = lambda: []
            result.scalar = lambda: None
            return result

        db.execute.side_effect = _execute_side_effect

        with patch("tasks.kms_rotation._AdminSessionLocal", return_value=db):
            with patch(
                "tasks.kms_rotation.KmsSecurityProvider",
                return_value=_fake_kms_provider(),
            ):
                result = ensure_pii_key_rotation()

        assert result["rotated"] is True
        assert result["run_id"] is not None
        assert result["counters"] is not None
        assert result["counters"]["scanned"] == 0
        assert result["counters"]["rewrapped"] == 0


# ════════════════════════════════════════════════════════════════════════════════
# Test 4: rewrap updates eligible rows
# ════════════════════════════════════════════════════════════════════════════════


class TestRewrapOpenbaoRows:
    """``rewrap_openbao_rows`` rewraps eligible rows with new ciphertext."""

    def test_rewrap_updates_rows_with_new_ciphertext(self, monkeypatch):
        """Rows with key_version < target get rewrapped and updated."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.setenv("OPENBAO_PII_KEY_NAME", "wims-incident-pii")

        ksp = _fake_kms_provider(
            rewrap_result=("vault:v2:new-ct", 2),
            rotate_to=2,
        )

        db = MagicMock()
        captured_updates: list[dict] = []
        select_calls = 0

        def _execute_side_effect(sql_obj, params=None):
            nonlocal select_calls
            sql_text = str(sql_obj)
            result = MagicMock()

            if "information_schema.columns" in sql_text:
                result.scalar.return_value = False
                return result

            if "FROM wims.incident_sensitive_details" in sql_text:
                if select_calls == 0:
                    row = _FakeRow(incident_id=42, pii_blob_enc="vault:v1:old-ct")
                    result.fetchall.return_value = [row]
                else:
                    result.fetchall.return_value = []
                select_calls += 1
                return result

            if "UPDATE wims.incident_sensitive_details" in sql_text:
                captured_updates.append(params or {})
                result.rowcount = 1
                return result

            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = None
            return result

        db.execute.side_effect = _execute_side_effect

        stats = rewrap_openbao_rows(
            db,
            ksp,
            "00000000-0000-0000-0000-0000deadbeef",
            "wims-incident-pii",
            target_version=2,
            batch_size=10,
        )

        assert stats["scanned"] >= 1
        assert stats["rewrapped"] >= 1
        assert stats["failed"] == 0

        # Verify rewrap was called with correct args
        ksp._client.rewrap.assert_called_once_with(
            "wims-incident-pii",
            "vault:v1:old-ct",
            b"incident_id:42",
        )

        # Verify UPDATE was issued with new ciphertext
        assert len(captured_updates) >= 1
        assert captured_updates[0]["blob"] == "vault:v2:new-ct"

    def test_rewrap_skips_rows_already_at_target(self, monkeypatch):
        """Rows with key_version == target are skipped (not re-wrapped)."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.setenv("OPENBAO_PII_KEY_NAME", "wims-incident-pii")

        ksp = _fake_kms_provider()

        db = MagicMock()

        call_count = {"select": 0}

        def _execute_side_effect(sql_obj, params=None):
            sql_text = str(sql_obj)
            result = MagicMock()

            if "information_schema.columns" in sql_text:
                result.scalar.return_value = True  # key_version column EXISTS
                return result

            if "FROM wims.incident_sensitive_details" in sql_text:
                if call_count["select"] == 0:
                    # Row already at target version
                    row = _FakeRow(
                        incident_id=42,
                        pii_blob_enc="vault:v2:already-v2",
                        key_version=2,
                    )
                    result.fetchall.return_value = [row]
                else:
                    result.fetchall.return_value = []
                call_count["select"] += 1
                return result

            if "UPDATE wims.incident_sensitive_details" in sql_text:
                result.rowcount = 1
                return result

            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = None
            return result

        db.execute.side_effect = _execute_side_effect

        stats = rewrap_openbao_rows(
            db,
            ksp,
            "ignored-run-id",
            "wims-incident-pii",
            target_version=2,
            batch_size=10,
        )

        assert stats["scanned"] == 1
        assert stats["rewrapped"] == 0
        assert stats["skipped"] == 1
        # rewrap should never have been called
        ksp._client.rewrap.assert_not_called()


# ════════════════════════════════════════════════════════════════════════════════
# Test 5: Per-row rewrap error increments failure counter and continues
# ════════════════════════════════════════════════════════════════════════════════


class TestRewrapErrorIsolation:
    """One bad row must not halt the entire rewrap batch."""

    def test_rewrap_error_increments_failed_continues(self, monkeypatch):
        """When rewrap fails for one row, failed counter increments and loop continues."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.setenv("OPENBAO_PII_KEY_NAME", "wims-incident-pii")

        from services.kms.openbao_client import OpenBaoClientError

        ksp = _fake_kms_provider()

        def _rewrap_side_effect(key_name, ciphertext, context):
            if b"incident_id:42" in (context or b""):
                raise OpenBaoClientError("rewrap boom")
            return _kms_ciphertext_mock("vault:v2:ok", 2)

        ksp._client.rewrap.side_effect = _rewrap_side_effect

        db = MagicMock()
        call_count = {"select": 0}
        update_params_list: list[dict] = []

        def _execute_side_effect(sql_obj, params=None):
            sql_text = str(sql_obj)
            result = MagicMock()

            if "information_schema.columns" in sql_text:
                result.scalar.return_value = False
                return result

            if "FROM wims.incident_sensitive_details" in sql_text:
                if call_count["select"] == 0:
                    result.fetchall.return_value = [
                        _FakeRow(incident_id=42, pii_blob_enc="bad-ct"),
                        _FakeRow(incident_id=43, pii_blob_enc="good-ct"),
                    ]
                else:
                    result.fetchall.return_value = []
                call_count["select"] += 1
                return result

            if "UPDATE wims.incident_sensitive_details" in sql_text:
                update_params_list.append(params or {})
                result.rowcount = 1
                return result

            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = None
            return result

        db.execute.side_effect = _execute_side_effect

        stats = rewrap_openbao_rows(
            db,
            ksp,
            "ignored-run-id",
            "wims-incident-pii",
            target_version=2,
            batch_size=10,
        )

        assert stats["scanned"] == 2
        assert stats["rewrapped"] == 1  # only row 43 was updated
        assert stats["failed"] == 1  # row 42 failed
        assert len(update_params_list) == 1  # only one UPDATE issued
        assert update_params_list[0]["iid"] == 43

    def test_update_failure_increments_failed_continues(self, monkeypatch):
        """When UPDATE fails after successful rewrap, it counts as failure and continues."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.setenv("OPENBAO_PII_KEY_NAME", "wims-incident-pii")

        ksp = _fake_kms_provider()

        db = MagicMock()
        call_count = {"select": 0}

        def _execute_side_effect(sql_obj, params=None):
            sql_text = str(sql_obj)
            result = MagicMock()

            if "information_schema.columns" in sql_text:
                result.scalar.return_value = False
                return result

            if "FROM wims.incident_sensitive_details" in sql_text:
                if call_count["select"] == 0:
                    result.fetchall.return_value = [
                        _FakeRow(incident_id=42, pii_blob_enc="ct1"),
                        _FakeRow(incident_id=43, pii_blob_enc="ct2"),
                    ]
                else:
                    result.fetchall.return_value = []
                call_count["select"] += 1
                return result

            if "UPDATE wims.incident_sensitive_details" in sql_text:
                if params and params.get("iid") == 42:
                    raise RuntimeError("simulated DB error on update")
                result.rowcount = 1
                return result

            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = None
            return result

        db.execute.side_effect = _execute_side_effect

        stats = rewrap_openbao_rows(
            db,
            ksp,
            "ignored-run-id",
            "wims-incident-pii",
            target_version=2,
            batch_size=10,
        )

        assert stats["scanned"] == 2
        assert stats["rewrapped"] == 1  # only row 43
        assert stats["failed"] == 1  # row 42


# ════════════════════════════════════════════════════════════════════════════════
# Test 6: Successful run marked SUCCEEDED; failures marked FAILED
# ════════════════════════════════════════════════════════════════════════════════


class TestMarkSuccessFailure:
    """Run state transitions are correctly recorded."""

    def test_mark_rotation_success_updates_status(self):
        """Success sets status='SUCCEEDED' and updates counters."""
        db = MagicMock()
        run_id = "00000000-0000-0000-0000-0000deadcafe"
        mark_rotation_success(
            db, run_id, rows_scanned=10, rows_rewrapped=9, rows_skipped=1, rows_failed=0
        )

        # Verify UPDATE was called with correct params
        update_calls = [
            (args, kwargs)
            for args, kwargs in db.execute.call_args_list
            if "UPDATE wims.kms_key_rotation_runs" in str(args[0])
        ]
        assert len(update_calls) >= 1
        sql, params = update_calls[0][0]
        assert "SUCCEEDED" in str(sql)
        assert params["rows_scanned"] == 10
        assert params["rows_rewrapped"] == 9
        assert params["rows_skipped"] == 1
        assert params["rows_failed"] == 0

    def test_mark_rotation_failure_updates_status(self):
        """Failure sets status='FAILED' with error message."""
        db = MagicMock()
        run_id = "00000000-0000-0000-0000-0000deadcafe"
        mark_rotation_failure(
            db,
            run_id,
            rows_scanned=5,
            rows_rewrapped=3,
            rows_skipped=0,
            rows_failed=2,
            error_message="rewrap errors on 2 rows",
        )

        update_calls = [
            (args, kwargs)
            for args, kwargs in db.execute.call_args_list
            if "UPDATE wims.kms_key_rotation_runs" in str(args[0])
        ]
        assert len(update_calls) >= 1
        sql, params = update_calls[0][0]
        assert "FAILED" in str(sql)
        assert params["rows_failed"] == 2
        assert params["error_message"] == "rewrap errors on 2 rows"

    def test_full_task_flow_success_calls_mark_success(self, monkeypatch):
        """End-to-end successful flow marks SUCCEEDED."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.setenv("OPENBAO_PII_KEY_NAME", "wims-incident-pii")

        db = MagicMock()
        captured_updates: list[str] = []

        def _execute_side_effect(sql_obj, params=None):
            sql_text = str(sql_obj)
            result = MagicMock()

            # Track UPDATE status changes for run table
            if "UPDATE wims.kms_key_rotation_runs" in sql_text:
                captured_updates.append(sql_text)

            if "WHERE status = 'RUNNING'" in sql_text:
                result.fetchone.return_value = None
                return result

            if "ORDER BY completed_at DESC" in sql_text:
                result.fetchone.return_value = None
                return result

            if "INSERT INTO wims.kms_key_rotation_runs" in sql_text:
                result.scalar.return_value = "00000000-0000-0000-0000-0000beef0001"
                return result

            if "information_schema.columns" in sql_text:
                result.scalar.return_value = False
                return result

            if "FROM wims.incident_sensitive_details" in sql_text:
                result.fetchall.return_value = []
                return result

            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = None
            return result

        db.execute.side_effect = _execute_side_effect

        with patch("tasks.kms_rotation._AdminSessionLocal", return_value=db):
            with patch(
                "tasks.kms_rotation.KmsSecurityProvider",
                return_value=_fake_kms_provider(),
            ):
                result = ensure_pii_key_rotation()

        assert result["rotated"] is True

        # Check that a SUCCEEDED update was issued
        success_updates = [u for u in captured_updates if "SUCCEEDED" in u]
        assert len(success_updates) >= 1

    def test_rewrap_with_failures_marks_failed(self, monkeypatch):
        """When rewrap has row failures, run is marked FAILED."""
        monkeypatch.setenv("OPENBAO_ADDR", "http://openbao:8200")
        monkeypatch.setenv("OPENBAO_TOKEN", "s.test-token")
        monkeypatch.setenv("OPENBAO_PII_KEY_NAME", "wims-incident-pii")

        from services.kms.openbao_client import OpenBaoClientError

        ksp = _fake_kms_provider()
        ksp._client.rewrap.side_effect = OpenBaoClientError("rewrap fail")

        db = MagicMock()
        captured_updates: list[str] = []
        select_calls = 0

        def _execute_side_effect(sql_obj, params=None):
            nonlocal select_calls
            sql_text = str(sql_obj)
            result = MagicMock()

            if "UPDATE wims.kms_key_rotation_runs" in sql_text:
                captured_updates.append(sql_text)

            if "WHERE status = 'RUNNING'" in sql_text:
                result.fetchone.return_value = None
                return result

            if "ORDER BY completed_at DESC" in sql_text:
                result.fetchone.return_value = None
                return result

            if "INSERT INTO wims.kms_key_rotation_runs" in sql_text:
                result.scalar.return_value = "00000000-0000-0000-0000-0000beef0002"
                return result

            if "information_schema.columns" in sql_text:
                result.scalar.return_value = False
                return result

            if "FROM wims.incident_sensitive_details" in sql_text:
                if select_calls == 0:
                    result.fetchall.return_value = [
                        _FakeRow(incident_id=1, pii_blob_enc="ct1"),
                        _FakeRow(incident_id=2, pii_blob_enc="ct2"),
                    ]
                else:
                    result.fetchall.return_value = []
                select_calls += 1
                return result

            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = None
            return result

        db.execute.side_effect = _execute_side_effect

        with patch("tasks.kms_rotation._AdminSessionLocal", return_value=db):
            with patch("tasks.kms_rotation.KmsSecurityProvider", return_value=ksp):
                result = ensure_pii_key_rotation()

        assert result["rotated"] is True
        assert result["counters"]["failed"] >= 1

        # Check that a FAILED update was issued
        failed_updates = [u for u in captured_updates if "FAILED" in u]
        assert len(failed_updates) >= 1


# ════════════════════════════════════════════════════════════════════════════════
# Test 7: start_rotation_run returns run_id
# ════════════════════════════════════════════════════════════════════════════════


class TestStartRotationRun:
    """``start_rotation_run`` inserts a RUNNING row and returns its UUID."""

    def test_start_run_returns_uuid(self):
        """Returns the uuid from the INSERT RETURNING clause."""
        db = MagicMock()
        db.execute.return_value.scalar.return_value = "00000000-0000-0000-0000-0000feedc0de"
        run_id = start_rotation_run(db, "wims-incident-pii", from_version=1, to_version=2)
        assert run_id == "00000000-0000-0000-0000-0000feedc0de"

        # Verify INSERT was called with correct params
        insert_calls = [
            args
            for args, _ in db.execute.call_args_list
            if "INSERT INTO wims.kms_key_rotation_runs" in str(args[0])
        ]
        assert len(insert_calls) >= 1
        sql, params = insert_calls[0]
        assert params["key_name"] == "wims-incident-pii"
        assert params["from_version"] == 1
        assert params["to_version"] == 2


# ════════════════════════════════════════════════════════════════════════════════
# Test 8: Celery beat entry present in celery_config.py
# ════════════════════════════════════════════════════════════════════════════════


class TestCeleryBeatEntry:
    """``celery_config.py`` must have the daily rotation schedule entry."""

    def test_beat_entry_exists(self):
        """Verify ensure-pii-key-rotation-daily is in beat_schedule."""
        from celery_config import celery_app

        schedule = celery_app.conf.beat_schedule or {}
        assert "ensure-pii-key-rotation-daily" in schedule, (
            "Expected 'ensure-pii-key-rotation-daily' in celery beat_schedule"
        )
        entry = schedule["ensure-pii-key-rotation-daily"]
        assert entry["task"] == "tasks.kms_rotation.ensure_pii_key_rotation"
        # schedule is a crontab — verify it has minute=30, hour=3
        sched_str = str(entry["schedule"])
        assert "30 3" in sched_str or "3 30" in sched_str, (
            f"Expected crontab for 03:30 UTC, got {sched_str}"
        )
