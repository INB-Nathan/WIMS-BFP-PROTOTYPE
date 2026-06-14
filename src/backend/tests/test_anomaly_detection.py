"""
TDD: M8 behavioral anomaly detection.

Tests call detector functions directly with mock DB sessions that return
synthetic audit rows — no running database required.

Coverage:
  - BULK_DELETE: 10 events → no flag; 11 events → HIGH anomaly; cross-boundary burst detected
  - OFF_HOURS: in-hours → no flag; off-hours → MEDIUM anomaly
  - PRIVILEGE_ESCALATION: any ROLE_CHANGE_TO_% → HIGH (broadened per GH #160)
  - RAPID_IP_SWITCH: 1 distinct IP → no flag; 2 distinct IPs → MEDIUM anomaly; cross-boundary detected
  - Dedup: second _write_anomaly call for same dedup_key → no insert, no threat-log
  - Dual-write: new anomaly → security_threat_logs row also inserted
  - Dedup counter: task returns dedup>0 when one write is new and one is dedup
  - Task failure: rollback + re-raise (security-adjacent task pattern)
"""

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest


from tasks.anomaly_detection import (
    _PII_EXPORT_ACTION,
    _SUSPICIOUS_QUERY_THRESHOLD,
    _detect_bulk_delete,
    _detect_off_hours,
    _detect_privilege_escalation,
    _detect_rapid_ip_switch,
    _detect_suspicious_query_pattern,
    _write_anomaly,
    detect_behavioral_anomalies,
)

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_USER_A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000001")
_USER_B = uuid.UUID("bbbbbbbb-0000-4000-8000-000000000002")
_NOW = datetime(2026, 6, 12, 14, 30, 0, tzinfo=timezone.utc)
_WINDOW_START = datetime(2026, 6, 12, 14, 30, 0, tzinfo=timezone.utc)


def _make_db(fetch_rows=None, fetchone_return=None):
    """Return a mock DB where execute(...).fetchall() returns fetch_rows
    and execute(...).fetchone() returns fetchone_return."""
    mock_result = MagicMock()
    mock_result.fetchall.return_value = fetch_rows or []
    mock_result.fetchone.return_value = fetchone_return
    mock_db = MagicMock()
    mock_db.execute.return_value = mock_result
    return mock_db


# ---------------------------------------------------------------------------
# BULK_DELETE
# ---------------------------------------------------------------------------


class TestBulkDeleteDetector:
    def test_no_flag_when_count_is_ten(self):
        """Exactly 10 events in a 5-min window → no anomaly (threshold is >10)."""
        db = _make_db(fetch_rows=[])  # SQL HAVING COUNT(*) > 10 filters this out
        result = _detect_bulk_delete(db)
        assert result == []

    def test_flag_when_count_exceeds_ten(self):
        """11 events in a 5-min window → HIGH BULK_DELETE anomaly."""
        db = _make_db(fetch_rows=[(_USER_A, _WINDOW_START, 11, "1.2.3.4")])
        result = _detect_bulk_delete(db)
        assert len(result) == 1
        a = result[0]
        assert a["anomaly_type"] == "BULK_DELETE"
        assert a["severity"] == "HIGH"
        assert a["subject_user_id"] == str(_USER_A)
        assert a["details"]["count"] == 11
        assert "BULK_DELETE:" in a["dedup_key"]
        assert str(_USER_A) in a["dedup_key"]
        assert a["source_ip"] == "1.2.3.4"

    def test_multiple_users_flagged(self):
        """Two users each with >10 deletes → two anomalies."""
        db = _make_db(
            fetch_rows=[
                (_USER_A, _WINDOW_START, 15, "1.2.3.4"),
                (_USER_B, _WINDOW_START, 12, "5.6.7.8"),
            ]
        )
        result = _detect_bulk_delete(db)
        assert len(result) == 2
        types = {r["anomaly_type"] for r in result}
        assert types == {"BULK_DELETE"}

    def test_cross_boundary_burst_detected(self):
        """6 events at 14:04 + 6 at 14:05 = 12 in sliding window → flagged.

        With fixed floor buckets the 14:05 events would land in a different
        5-min bucket (14:05–14:09) and only count 6, missing the burst.
        The sliding window correctly counts 12 for the 14:05 event.
        """
        window_2 = datetime(2026, 6, 12, 14, 5, 0, tzinfo=timezone.utc)
        # SQL returns one row per (user, window_start) via GROUP BY.
        # The 14:05 events trigger with count 12 and group into the 14:05 bucket.
        db = _make_db(fetch_rows=[(_USER_A, window_2, 12, "1.2.3.4")])
        result = _detect_bulk_delete(db)
        assert len(result) == 1
        assert result[0]["details"]["count"] == 12
        # dedup key encodes the floor of the triggering event (14:05)
        assert "202606121405" in result[0]["dedup_key"]


# ---------------------------------------------------------------------------
# OFF_HOURS
# ---------------------------------------------------------------------------


class TestOffHoursDetector:
    def _make_audit_row(self, audit_id, action_type, ip="1.2.3.4"):
        return (audit_id, _USER_A, action_type, ip, _NOW)

    def test_no_flag_when_no_rows(self):
        """No matching audit rows → no anomaly."""
        db = _make_db(fetch_rows=[])
        result = _detect_off_hours(db)
        assert result == []

    def test_pii_export_off_hours_flagged(self):
        """PII_EXPORT event returned from DB → MEDIUM OFF_HOURS anomaly."""
        db = _make_db(fetch_rows=[self._make_audit_row(42, "PII_EXPORT")])
        result = _detect_off_hours(db)
        assert len(result) == 1
        a = result[0]
        assert a["anomaly_type"] == "OFF_HOURS"
        assert a["severity"] == "MEDIUM"
        assert a["subject_user_id"] == str(_USER_A)
        assert a["details"]["action_type"] == "PII_EXPORT"
        assert a["details"]["audit_id"] == 42
        assert a["dedup_key"] == "OFF_HOURS:42"
        assert a["source_ip"] == "1.2.3.4"

    def test_role_change_to_admin_off_hours_flagged(self):
        """ROLE_CHANGE_TO_SYSTEM_ADMIN event → OFF_HOURS anomaly."""
        db = _make_db(fetch_rows=[self._make_audit_row(99, "ROLE_CHANGE_TO_SYSTEM_ADMIN")])
        result = _detect_off_hours(db)
        assert len(result) == 1
        assert result[0]["details"]["action_type"] == "ROLE_CHANGE_TO_SYSTEM_ADMIN"

    def test_each_audit_id_gets_own_dedup_key(self):
        """Two off-hours events → two distinct dedup keys."""
        db = _make_db(
            fetch_rows=[
                self._make_audit_row(10, "PII_EXPORT"),
                self._make_audit_row(11, "BACKUP_TRIGGERED"),
            ]
        )
        result = _detect_off_hours(db)
        assert len(result) == 2
        keys = {r["dedup_key"] for r in result}
        assert keys == {"OFF_HOURS:10", "OFF_HOURS:11"}

    def test_in_hours_not_flagged(self):
        """The SQL filter (HOUR<6 OR HOUR>=22) runs server-side;
        mock rows that reach the detector ARE anomalies regardless.
        This test proves empty fetch → no anomaly (in-hours produces no rows)."""
        db = _make_db(fetch_rows=[])
        result = _detect_off_hours(db)
        assert result == []


# ---------------------------------------------------------------------------
# PRIVILEGE_ESCALATION
# ---------------------------------------------------------------------------


class TestPrivilegeEscalationDetector:
    def _make_row(self, audit_id, action_type, ip="10.0.0.1"):
        return (audit_id, _USER_A, action_type, ip, _NOW)

    def test_no_flag_when_no_rows(self):
        db = _make_db(fetch_rows=[])
        result = _detect_privilege_escalation(db)
        assert result == []

    def test_system_admin_role_change_flagged(self):
        """ROLE_CHANGE_TO_SYSTEM_ADMIN → HIGH PRIVILEGE_ESCALATION."""
        db = _make_db(fetch_rows=[self._make_row(77, "ROLE_CHANGE_TO_SYSTEM_ADMIN")])
        result = _detect_privilege_escalation(db)
        assert len(result) == 1
        a = result[0]
        assert a["anomaly_type"] == "PRIVILEGE_ESCALATION"
        assert a["severity"] == "HIGH"
        assert a["subject_user_id"] == str(_USER_A)
        assert a["dedup_key"] == "PRIV_ESC:77"
        assert a["source_ip"] == "10.0.0.1"

    def test_analyst_role_change_flagged(self):
        """ROLE_CHANGE_TO_ANALYST → HIGH PRIVILEGE_ESCALATION (broadened per GH #160)."""
        db = _make_db(fetch_rows=[self._make_row(88, "ROLE_CHANGE_TO_ANALYST")])
        result = _detect_privilege_escalation(db)
        assert len(result) == 1
        a = result[0]
        assert a["anomaly_type"] == "PRIVILEGE_ESCALATION"
        assert a["severity"] == "HIGH"
        assert a["details"]["action_type"] == "ROLE_CHANGE_TO_ANALYST"

    def test_dedup_key_uses_audit_id(self):
        """Each PRIVILEGE_ESCALATION event has its own audit_id-based dedup key."""
        db = _make_db(
            fetch_rows=[
                self._make_row(1, "ROLE_CHANGE_TO_SYSTEM_ADMIN"),
                self._make_row(2, "ROLE_CHANGE_TO_SYSTEM_ADMIN"),
            ]
        )
        result = _detect_privilege_escalation(db)
        assert len(result) == 2
        assert result[0]["dedup_key"] == "PRIV_ESC:1"
        assert result[1]["dedup_key"] == "PRIV_ESC:2"


# ---------------------------------------------------------------------------
# RAPID_IP_SWITCH
# ---------------------------------------------------------------------------


class TestRapidIPSwitchDetector:
    def test_no_flag_when_no_rows(self):
        """No qualifying window rows → no anomaly."""
        db = _make_db(fetch_rows=[])
        result = _detect_rapid_ip_switch(db)
        assert result == []

    def test_two_distinct_ips_flagged(self):
        """2 distinct IPs in one 10-min window → MEDIUM RAPID_IP_SWITCH."""
        db = _make_db(fetch_rows=[(_USER_A, _WINDOW_START, 2, ["1.1.1.1", "2.2.2.2"])])
        result = _detect_rapid_ip_switch(db)
        assert len(result) == 1
        a = result[0]
        assert a["anomaly_type"] == "RAPID_IP_SWITCH"
        assert a["severity"] == "MEDIUM"
        assert a["subject_user_id"] == str(_USER_A)
        assert a["details"]["distinct_ip_count"] == 2
        assert "1.1.1.1" in a["details"]["ips"]
        assert "RAPID_IP:" in a["dedup_key"]
        assert str(_USER_A) in a["dedup_key"]

    def test_one_ip_not_flagged_by_sql(self):
        """1 distinct IP → SQL HAVING filters it; empty result."""
        db = _make_db(fetch_rows=[])  # HAVING COUNT(DISTINCT ip) >= 2 excludes this
        result = _detect_rapid_ip_switch(db)
        assert result == []

    def test_different_windows_get_distinct_dedup_keys(self):
        """Same user, two different 10-min windows → two distinct dedup keys."""
        win1 = datetime(2026, 6, 12, 14, 0, 0, tzinfo=timezone.utc)
        win2 = datetime(2026, 6, 12, 14, 10, 0, tzinfo=timezone.utc)
        db = _make_db(
            fetch_rows=[
                (_USER_A, win1, 2, ["1.1.1.1", "2.2.2.2"]),
                (_USER_A, win2, 3, ["1.1.1.1", "3.3.3.3", "4.4.4.4"]),
            ]
        )
        result = _detect_rapid_ip_switch(db)
        assert len(result) == 2
        assert result[0]["dedup_key"] != result[1]["dedup_key"]

    def test_cross_boundary_ip_switch_detected(self):
        """IP-A at 14:09, IP-B at 14:11 — 2 min apart but different floor buckets.

        With fixed 10-min floor buckets the 14:11 event lands in 14:10–14:19
        and only sees IP-B (1 distinct), missing the cross-boundary switch.
        The sliding window correctly counts 2 distinct IPs for the 14:11 event.
        """
        window_floor = datetime(2026, 6, 12, 14, 10, 0, tzinfo=timezone.utc)
        db = _make_db(fetch_rows=[(_USER_A, window_floor, 2, ["1.1.1.1", "2.2.2.2"])])
        result = _detect_rapid_ip_switch(db)
        assert len(result) == 1
        assert result[0]["details"]["distinct_ip_count"] == 2
        assert "202606121410" in result[0]["dedup_key"]


# ---------------------------------------------------------------------------
# Dual-write + dedup (_write_anomaly)
# ---------------------------------------------------------------------------


class TestWriteAnomaly:
    def _make_write_db(self, anomaly_id=None):
        """DB that returns (anomaly_id,) on first execute (INSERT anomaly_detections)
        and a plain mock for the second execute (INSERT security_threat_logs)."""
        insert_result = MagicMock()
        insert_result.fetchone.return_value = (anomaly_id,) if anomaly_id else None

        threat_result = MagicMock()

        mock_db = MagicMock()
        mock_db.execute.side_effect = [insert_result, threat_result]
        return mock_db

    def test_new_anomaly_inserts_threat_log(self):
        """When anomaly_detections INSERT returns a row, security_threat_logs is also written."""
        db = self._make_write_db(anomaly_id=1)
        inserted = _write_anomaly(
            db,
            anomaly_type="BULK_DELETE",
            subject_user_id=str(_USER_A),
            severity="HIGH",
            details={"count": 12},
            dedup_key="BULK_DELETE:test:202606121430",
        )
        assert inserted is True
        assert db.execute.call_count == 2
        # Second call should be the security_threat_logs INSERT
        second_sql = str(db.execute.call_args_list[1][0][0])
        assert "security_threat_logs" in second_sql

    def test_dedup_skips_threat_log(self):
        """When ON CONFLICT fires (fetchone returns None), no threat-log insert."""
        db = self._make_write_db(anomaly_id=None)
        inserted = _write_anomaly(
            db,
            anomaly_type="BULK_DELETE",
            subject_user_id=str(_USER_A),
            severity="HIGH",
            details={"count": 12},
            dedup_key="BULK_DELETE:test:202606121430",
        )
        assert inserted is False
        # Only the anomaly_detections INSERT was called; no threat-log write
        assert db.execute.call_count == 1

    def test_threat_log_payload_contains_anomaly_type(self):
        """The security_threat_logs raw_payload includes anomaly_type."""
        db = self._make_write_db(anomaly_id=5)
        _write_anomaly(
            db,
            anomaly_type="OFF_HOURS",
            subject_user_id=str(_USER_A),
            severity="MEDIUM",
            details={"action_type": "PII_EXPORT", "audit_id": 42},
            dedup_key="OFF_HOURS:42",
            source_ip="1.2.3.4",
        )
        # Extract the params passed to the second execute call
        second_params = db.execute.call_args_list[1][0][1]
        payload = json.loads(second_params["payload"])
        assert payload["anomaly_type"] == "OFF_HOURS"
        assert payload["action_type"] == "PII_EXPORT"
        assert second_params["source_ip"] == "1.2.3.4"

    def test_anomaly_details_serialised_as_json(self):
        """details dict is JSON-serialised into the anomaly_detections INSERT."""
        db = self._make_write_db(anomaly_id=2)
        _write_anomaly(
            db,
            anomaly_type="RAPID_IP_SWITCH",
            subject_user_id=str(_USER_A),
            severity="MEDIUM",
            details={"distinct_ip_count": 2, "ips": ["1.1.1.1", "2.2.2.2"]},
            dedup_key="RAPID_IP:abc:202606121430",
        )
        first_params = db.execute.call_args_list[0][0][1]
        loaded = json.loads(first_params["details"])
        assert loaded["distinct_ip_count"] == 2
        assert "1.1.1.1" in loaded["ips"]

    def test_source_ip_none_passed_cleanly_to_threat_log(self):
        """_write_anomaly(..., source_ip=None) passes None cleanly to threat logs."""
        db = self._make_write_db(anomaly_id=3)
        _write_anomaly(
            db,
            anomaly_type="BULK_DELETE",
            subject_user_id=str(_USER_A),
            severity="HIGH",
            details={"count": 12},
            dedup_key="BULK_DELETE:test:202606121430",
            source_ip=None,
        )
        second_params = db.execute.call_args_list[1][0][1]
        assert second_params["source_ip"] is None


# ---------------------------------------------------------------------------
# Window-floor dedup stability
#
# Two detector runs within the same window must produce IDENTICAL dedup keys.
# The key's timestamp component comes from `window_start` — the SQL GROUP BY
# floor expression applied to EVENT timestamps, not the Python run time.
# ---------------------------------------------------------------------------


def _make_write_db_for_run(anomaly_id=None):
    """Stand-alone helper (usable outside TestWriteAnomaly) that mocks a
    two-execute DB: anomaly_detections INSERT then security_threat_logs INSERT."""
    insert_result = MagicMock()
    insert_result.fetchone.return_value = (anomaly_id,) if anomaly_id else None
    threat_result = MagicMock()
    mock_db = MagicMock()
    mock_db.execute.side_effect = [insert_result, threat_result]
    return mock_db


class TestWindowFloorDedup:
    """Prove that two runs at different minutes within the same window produce
    the same dedup key, so ON CONFLICT correctly fires on the second run."""

    def test_bulk_delete_key_is_window_floor_not_run_minute(self):
        """window_start from SQL is the floor (e.g. 14:00), not the run time."""
        # Events fired at 14:01; SQL returns window_start = 14:00 (floor)
        window_floor = datetime(2026, 6, 12, 14, 0, 0, tzinfo=timezone.utc)

        db = _make_db(fetch_rows=[(_USER_A, window_floor, 11, "1.2.3.4")])
        result = _detect_bulk_delete(db)

        assert len(result) == 1
        # Key must encode the FLOOR (14:00 → "202606121400"), not any other minute
        assert result[0]["dedup_key"].endswith("202606121400")

    def test_bulk_delete_same_window_two_runs_produce_identical_key(self):
        """Run at HH:02 and run at HH:04 on events at HH:01 → same dedup key."""
        window_floor = datetime(2026, 6, 12, 14, 0, 0, tzinfo=timezone.utc)

        # Run 1 (conceptually at 14:02): SQL has already computed window_start = 14:00
        db_run1 = _make_db(fetch_rows=[(_USER_A, window_floor, 11, "1.2.3.4")])
        r1 = _detect_bulk_delete(db_run1)

        # Run 2 (conceptually at 14:04): same events, same window_start
        db_run2 = _make_db(fetch_rows=[(_USER_A, window_floor, 11, "1.2.3.4")])
        r2 = _detect_bulk_delete(db_run2)

        assert r1[0]["dedup_key"] == r2[0]["dedup_key"]

    def test_bulk_delete_two_runs_yield_exactly_one_write(self):
        """Simulate two task runs on the same window: first inserts, second deduplicates.

        Asserts exactly 1 anomaly_detections row and 1 security_threat_logs row
        total across both runs.
        """
        window_floor = datetime(2026, 6, 12, 14, 0, 0, tzinfo=timezone.utc)

        db_run1 = _make_db(fetch_rows=[(_USER_A, window_floor, 11, "1.2.3.4")])
        r1 = _detect_bulk_delete(db_run1)

        db_run2 = _make_db(fetch_rows=[(_USER_A, window_floor, 11, "1.2.3.4")])
        r2 = _detect_bulk_delete(db_run2)

        # First run: new insert → anomaly_detections + security_threat_logs
        write_db_run1 = _make_write_db_for_run(anomaly_id=1)
        inserted_run1 = _write_anomaly(write_db_run1, **r1[0])

        # Second run: ON CONFLICT fires (fetchone returns None)
        write_db_run2 = _make_write_db_for_run(anomaly_id=None)
        inserted_run2 = _write_anomaly(write_db_run2, **r2[0])

        assert inserted_run1 is True
        assert inserted_run2 is False
        # Run 1: 2 executes (anomaly_detections INSERT + threat_log INSERT)
        assert write_db_run1.execute.call_count == 2
        # Run 2: 1 execute only (anomaly_detections INSERT, no threat_log)
        assert write_db_run2.execute.call_count == 1

    def test_rapid_ip_key_is_window_floor_not_run_minute(self):
        """RAPID_IP_SWITCH window_start is the SQL-floored bucket start."""
        window_floor = datetime(2026, 6, 12, 14, 0, 0, tzinfo=timezone.utc)

        db = _make_db(fetch_rows=[(_USER_A, window_floor, 2, ["1.1.1.1", "2.2.2.2"])])
        result = _detect_rapid_ip_switch(db)

        assert len(result) == 1
        assert result[0]["dedup_key"].endswith("202606121400")

    def test_rapid_ip_two_runs_yield_exactly_one_write(self):
        """Two runs on the same 10-min window → first inserts, second deduplicates."""
        window_floor = datetime(2026, 6, 12, 14, 0, 0, tzinfo=timezone.utc)

        db_run1 = _make_db(fetch_rows=[(_USER_A, window_floor, 2, ["1.1.1.1", "2.2.2.2"])])
        r1 = _detect_rapid_ip_switch(db_run1)

        db_run2 = _make_db(fetch_rows=[(_USER_A, window_floor, 2, ["1.1.1.1", "2.2.2.2"])])
        r2 = _detect_rapid_ip_switch(db_run2)

        assert r1[0]["dedup_key"] == r2[0]["dedup_key"]

        write_db_run1 = _make_write_db_for_run(anomaly_id=7)
        write_db_run2 = _make_write_db_for_run(anomaly_id=None)

        assert _write_anomaly(write_db_run1, **r1[0]) is True
        assert _write_anomaly(write_db_run2, **r2[0]) is False
        assert write_db_run1.execute.call_count == 2
        assert write_db_run2.execute.call_count == 1


# ---------------------------------------------------------------------------
# Full task — detect_behavioral_anomalies
# ---------------------------------------------------------------------------


class TestDetectBehavioralAnomaliesTask:
    def test_task_commits_on_success(self):
        """Task calls db.commit() when no exceptions occur."""
        mock_db = MagicMock()
        # All detectors return empty lists; no writes needed
        mock_db.execute.return_value.fetchall.return_value = []

        with patch("tasks.anomaly_detection.get_session", return_value=mock_db):
            result = detect_behavioral_anomalies()

        mock_db.commit.assert_called_once()
        mock_db.close.assert_called_once()
        assert result["new"] == 0
        assert result["dedup"] == 0

    def test_task_rollback_and_reraise_on_exception(self):
        """Task rolls back, closes session, and re-raises (security-adjacent pattern)."""
        mock_db = MagicMock()
        mock_db.execute.side_effect = RuntimeError("DB down")

        with patch("tasks.anomaly_detection.get_session", return_value=mock_db):
            with pytest.raises(RuntimeError, match="DB down"):
                detect_behavioral_anomalies()

        mock_db.rollback.assert_called_once()
        mock_db.close.assert_called_once()

    def test_task_counts_new_and_dedup(self):
        """Task correctly accumulates new vs dedup counts across detectors."""
        mock_db = MagicMock()

        # bulk_delete returns 1 anomaly, off_hours/priv_esc/rapid_ip return nothing
        fetch_result_bulk = MagicMock()
        fetch_result_bulk.fetchall.return_value = [(_USER_A, _WINDOW_START, 15, "1.2.3.4")]

        fetch_result_empty = MagicMock()
        fetch_result_empty.fetchall.return_value = []

        # anomaly_detections INSERT returns a row (new insert)
        insert_result = MagicMock()
        insert_result.fetchone.return_value = (1,)

        threat_result = MagicMock()

        mock_db.execute.side_effect = [
            fetch_result_bulk,  # _detect_bulk_delete query
            fetch_result_empty,  # _detect_off_hours
            fetch_result_empty,  # _detect_privilege_escalation
            fetch_result_empty,  # _detect_rapid_ip_switch
            fetch_result_empty,  # _detect_suspicious_query_pattern
            insert_result,  # _write_anomaly: anomaly_detections INSERT
            threat_result,  # _write_anomaly: security_threat_logs INSERT
        ]

        with patch("tasks.anomaly_detection.get_session", return_value=mock_db):
            result = detect_behavioral_anomalies()

        assert result["new"] == 1
        assert result["dedup"] == 0
        mock_db.commit.assert_called_once()

    def test_task_counts_dedup_positive(self):
        """Task returns dedup>0 when first write inserts and second deduplicates."""
        mock_db = MagicMock()

        # bulk_delete returns 2 anomalies for same user/window
        fetch_result_bulk = MagicMock()
        fetch_result_bulk.fetchall.return_value = [
            (_USER_A, _WINDOW_START, 15, "1.2.3.4"),
            (_USER_A, _WINDOW_START, 15, "1.2.3.4"),
        ]

        fetch_result_empty = MagicMock()
        fetch_result_empty.fetchall.return_value = []

        # First _write_anomaly: INSERT succeeds (returns row)
        insert_result_new = MagicMock()
        insert_result_new.fetchone.return_value = (1,)
        threat_result_1 = MagicMock()

        # Second _write_anomaly: ON CONFLICT fires (returns None)
        insert_result_dedup = MagicMock()
        insert_result_dedup.fetchone.return_value = None

        mock_db.execute.side_effect = [
            fetch_result_bulk,  # 0: _detect_bulk_delete query
            insert_result_new,  # 1: _write_anomaly #1 anomaly_detections INSERT
            threat_result_1,  # 2: _write_anomaly #1 security_threat_logs INSERT
            insert_result_dedup,  # 3: _write_anomaly #2 anomaly_detections INSERT (dedup)
            fetch_result_empty,  # 4: _detect_off_hours query
            fetch_result_empty,  # 5: _detect_privilege_escalation query
            fetch_result_empty,  # 6: _detect_rapid_ip_switch query
            fetch_result_empty,  # 7: _detect_suspicious_query_pattern query
            MagicMock(),  # 8: safety margin
        ]

        with patch("tasks.anomaly_detection.get_session", return_value=mock_db):
            result = detect_behavioral_anomalies()

        assert result["new"] == 1
        assert result["dedup"] == 1
        mock_db.commit.assert_called_once()

    def test_task_logs_when_dedup_only(self):
        """Task logs info message even when all anomalies are deduplicated (new=0)."""
        mock_db = MagicMock()

        # bulk_delete returns 1 anomaly; other detectors return nothing
        fetch_result_bulk = MagicMock()
        fetch_result_bulk.fetchall.return_value = [(_USER_A, _WINDOW_START, 15, "1.2.3.4")]

        fetch_result_empty = MagicMock()
        fetch_result_empty.fetchall.return_value = []

        # _write_anomaly: dedup hit (returns None)
        insert_result_dedup = MagicMock()
        insert_result_dedup.fetchone.return_value = None

        mock_db.execute.side_effect = [
            fetch_result_bulk,  # _detect_bulk_delete
            insert_result_dedup,  # _write_anomaly (dedup)
            fetch_result_empty,  # _detect_off_hours
            fetch_result_empty,  # _detect_privilege_escalation
            fetch_result_empty,  # _detect_rapid_ip_switch
            fetch_result_empty,  # _detect_suspicious_query_pattern
        ]

        with (
            patch("tasks.anomaly_detection.get_session", return_value=mock_db),
            patch("tasks.anomaly_detection.logger") as mock_logger,
        ):
            result = detect_behavioral_anomalies()

        assert result["new"] == 0
        assert result["dedup"] == 1
        mock_logger.info.assert_called_once_with(
            "Anomaly detection: %d new anomalies inserted, %d deduplicated",
            0,
            1,
        )


# ---------------------------------------------------------------------------
# SUSPICIOUS_QUERY_PATTERN
# ---------------------------------------------------------------------------


class TestSuspiciousQueryPatternDetector:
    def test_no_flag_when_no_rows(self):
        """No high-frequency PII_EXPORT rows → no anomaly."""
        db = _make_db(fetch_rows=[])
        result = _detect_suspicious_query_pattern(db)
        assert result == []

    def test_flag_when_count_exceeds_threshold(self):
        """11 PII_EXPORT events in 5-min window → HIGH SUSPICIOUS_QUERY_PATTERN."""
        db = _make_db(fetch_rows=[(_USER_A, _WINDOW_START, 11, "1.2.3.4")])
        result = _detect_suspicious_query_pattern(db)
        assert len(result) == 1
        a = result[0]
        assert a["anomaly_type"] == "SUSPICIOUS_QUERY_PATTERN"
        assert a["severity"] == "HIGH"
        assert a["subject_user_id"] == str(_USER_A)
        assert a["details"]["count"] == 11
        assert a["details"]["action_type"] == _PII_EXPORT_ACTION
        assert a["details"]["window_minutes"] == 5
        assert a["details"]["threshold"] == _SUSPICIOUS_QUERY_THRESHOLD
        assert a["source_ip"] == "1.2.3.4"
        assert "SUSPICIOUS_QUERY_PATTERN:" in a["dedup_key"]
        assert str(_USER_A) in a["dedup_key"]

    def test_no_flag_at_threshold(self):
        """Exactly 10 exports (at threshold, not exceeding) → SQL HAVING cnt > 10 filters out."""
        db = _make_db(fetch_rows=[])  # SQL excludes count == threshold
        result = _detect_suspicious_query_pattern(db)
        assert result == []

    def test_multiple_users_flagged(self):
        """Two users each exceeding threshold → two anomalies."""
        db = _make_db(
            fetch_rows=[
                (_USER_A, _WINDOW_START, 12, "1.2.3.4"),
                (_USER_B, _WINDOW_START, 15, "5.6.7.8"),
            ]
        )
        result = _detect_suspicious_query_pattern(db)
        assert len(result) == 2
        types = {r["anomaly_type"] for r in result}
        assert types == {"SUSPICIOUS_QUERY_PATTERN"}

    def test_source_ip_none_when_missing(self):
        """source_ip is None when the DB returns NULL (no IP on audit row)."""
        db = _make_db(fetch_rows=[(_USER_A, _WINDOW_START, 11, None)])
        result = _detect_suspicious_query_pattern(db)
        assert result[0]["source_ip"] is None

    def test_dedup_key_encodes_user_and_window(self):
        """dedup_key is SUSPICIOUS_QUERY_PATTERN:{user_id}:{window_key}."""
        window_floor = datetime(2026, 6, 12, 14, 0, 0, tzinfo=timezone.utc)
        db = _make_db(fetch_rows=[(_USER_A, window_floor, 11, None)])
        result = _detect_suspicious_query_pattern(db)
        assert result[0]["dedup_key"] == f"SUSPICIOUS_QUERY_PATTERN:{_USER_A}:202606121400"

    def test_cross_boundary_burst_detected(self):
        """6 exports at 14:04 + 6 at 14:05 = 12 in sliding window → flagged.

        Fixed floor-bucket at 14:05 would start a new 5-min bucket and count only 6,
        missing the burst. The sliding window counts 12 for the 14:05 event.
        """
        window_2 = datetime(2026, 6, 12, 14, 5, 0, tzinfo=timezone.utc)
        db = _make_db(fetch_rows=[(_USER_A, window_2, 12, "1.2.3.4")])
        result = _detect_suspicious_query_pattern(db)
        assert len(result) == 1
        assert result[0]["details"]["count"] == 12
        assert "202606121405" in result[0]["dedup_key"]


class TestSuspiciousQueryPatternWindowFloor:
    """Prove dedup stability: two task runs within the same 5-min window produce
    the same dedup key, so ON CONFLICT correctly fires on the second run."""

    def test_key_is_window_floor_not_run_minute(self):
        """window_start from SQL is the floor (e.g. 14:00), not the actual event minute."""
        window_floor = datetime(2026, 6, 12, 14, 0, 0, tzinfo=timezone.utc)
        db = _make_db(fetch_rows=[(_USER_A, window_floor, 11, "1.2.3.4")])
        result = _detect_suspicious_query_pattern(db)
        assert len(result) == 1
        assert result[0]["dedup_key"].endswith("202606121400")

    def test_two_runs_same_window_produce_identical_key(self):
        """Run at HH:02 and run at HH:04 on events at HH:01 → same dedup key."""
        window_floor = datetime(2026, 6, 12, 14, 0, 0, tzinfo=timezone.utc)
        db_run1 = _make_db(fetch_rows=[(_USER_A, window_floor, 11, "1.2.3.4")])
        db_run2 = _make_db(fetch_rows=[(_USER_A, window_floor, 11, "1.2.3.4")])
        r1 = _detect_suspicious_query_pattern(db_run1)
        r2 = _detect_suspicious_query_pattern(db_run2)
        assert r1[0]["dedup_key"] == r2[0]["dedup_key"]

    def test_two_runs_yield_exactly_one_write(self):
        """First run inserts; second run deduplicates — one anomaly row, one threat-log row total."""
        window_floor = datetime(2026, 6, 12, 14, 0, 0, tzinfo=timezone.utc)
        db_run1 = _make_db(fetch_rows=[(_USER_A, window_floor, 11, "1.2.3.4")])
        db_run2 = _make_db(fetch_rows=[(_USER_A, window_floor, 11, "1.2.3.4")])
        r1 = _detect_suspicious_query_pattern(db_run1)
        r2 = _detect_suspicious_query_pattern(db_run2)

        write_db_run1 = _make_write_db_for_run(anomaly_id=9)
        write_db_run2 = _make_write_db_for_run(anomaly_id=None)

        assert _write_anomaly(write_db_run1, **r1[0]) is True
        assert _write_anomaly(write_db_run2, **r2[0]) is False
        assert write_db_run1.execute.call_count == 2  # anomaly_detections + threat_log
        assert write_db_run2.execute.call_count == 1  # anomaly_detections only (dedup)
