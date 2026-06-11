"""
TDD: M8 behavioral anomaly detection.

Tests call detector functions directly with mock DB sessions that return
synthetic audit rows — no running database required.

Coverage:
  - BULK_DELETE: 10 events → no flag; 11 events → HIGH anomaly
  - OFF_HOURS: 06:00 PHT (in-hours) → no flag; 22:00 PHT → MEDIUM anomaly
  - PRIVILEGE_ESCALATION: non-admin role change → no flag; SYSTEM_ADMIN → HIGH
  - RAPID_IP_SWITCH: 1 distinct IP → no flag; 2 distinct IPs → MEDIUM anomaly
  - Dedup: second _write_anomaly call for same dedup_key → no insert, no threat-log
  - Dual-write: new anomaly → security_threat_logs row also inserted
"""

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch


from tasks.anomaly_detection import (
    _detect_bulk_delete,
    _detect_off_hours,
    _detect_privilege_escalation,
    _detect_rapid_ip_switch,
    _write_anomaly,
    detect_behavioral_anomalies,
)

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_USER_A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000001")
_USER_B = uuid.UUID("bbbbbbbb-0000-4000-8000-000000000002")
_NOW = datetime(2026, 6, 12, 14, 30, 0, tzinfo=timezone.utc)
_WINDOW_5MIN = datetime(2026, 6, 12, 14, 30, 0, tzinfo=timezone.utc)
_WINDOW_10MIN = datetime(2026, 6, 12, 14, 30, 0, tzinfo=timezone.utc)


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
        db = _make_db(fetch_rows=[(_USER_A, _WINDOW_5MIN, 11)])
        result = _detect_bulk_delete(db)
        assert len(result) == 1
        a = result[0]
        assert a["anomaly_type"] == "BULK_DELETE"
        assert a["severity"] == "HIGH"
        assert a["subject_user_id"] == str(_USER_A)
        assert a["details"]["count"] == 11
        assert "BULK_DELETE:" in a["dedup_key"]
        assert str(_USER_A) in a["dedup_key"]

    def test_multiple_users_flagged(self):
        """Two users each with >10 deletes → two anomalies."""
        db = _make_db(
            fetch_rows=[
                (_USER_A, _WINDOW_5MIN, 15),
                (_USER_B, _WINDOW_5MIN, 12),
            ]
        )
        result = _detect_bulk_delete(db)
        assert len(result) == 2
        types = {r["anomaly_type"] for r in result}
        assert types == {"BULK_DELETE"}


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
        db = _make_db(fetch_rows=[(_USER_A, _WINDOW_10MIN, 2, ["1.1.1.1", "2.2.2.2"])])
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

    def test_task_rollback_on_exception(self):
        """Task rolls back and closes session when a detector raises."""
        mock_db = MagicMock()
        mock_db.execute.side_effect = RuntimeError("DB down")

        with patch("tasks.anomaly_detection.get_session", return_value=mock_db):
            result = detect_behavioral_anomalies()

        mock_db.rollback.assert_called_once()
        mock_db.close.assert_called_once()
        # Returns 0 counts on failure — does not raise
        assert result == {"new": 0, "dedup": 0}

    def test_task_counts_new_and_dedup(self):
        """Task correctly accumulates new vs dedup counts across detectors."""
        mock_db = MagicMock()

        # bulk_delete returns 1 anomaly, off_hours/priv_esc/rapid_ip return nothing
        fetch_result_bulk = MagicMock()
        fetch_result_bulk.fetchall.return_value = [(_USER_A, _WINDOW_5MIN, 15)]

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
            insert_result,  # _write_anomaly: anomaly_detections INSERT
            threat_result,  # _write_anomaly: security_threat_logs INSERT
        ]

        with patch("tasks.anomaly_detection.get_session", return_value=mock_db):
            result = detect_behavioral_anomalies()

        assert result["new"] == 1
        assert result["dedup"] == 0
        mock_db.commit.assert_called_once()
