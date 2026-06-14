"""Tests for Suricata HIGH-severity alert handling (no auto-incident creation — #165)."""

from __future__ import annotations

import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest

from services.suricata_ingestion import (
    _create_security_incident,
    _security_incident_exists,
    _SVC_SURICATA_UUID,
    _BFP_HQ_LONGITUDE,
    _BFP_HQ_LATITUDE,
    _DEFAULT_REGION_ID,
)


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.execute.return_value.fetchone.return_value = None
    return db


@pytest.fixture(autouse=True)
def _clear_positions():
    import services.suricata_ingestion as si

    si._eve_file_positions.clear()
    yield


class TestSuricataTaskTransaction:
    def test_ingest_task_commits_caller_owned_session(self):
        import tasks.suricata as task

        events: list[str] = []
        mock_db = MagicMock()
        mock_db.commit.side_effect = lambda: events.append("commit")
        mock_db.close.side_effect = lambda: events.append("close")

        def ingest_success(*_args, **_kwargs):
            events.append("ingest")
            return 3

        with (
            patch.object(task, "get_session", return_value=mock_db),
            patch.object(task, "set_rls_context"),
            patch.object(task, "ingest_eve_file", side_effect=ingest_success) as mock_ingest,
        ):
            result = task.ingest_suricata_eve()

        assert result == 3
        mock_ingest.assert_called_once_with(task.EVE_LOG_PATH, db_session=mock_db)
        assert events == ["ingest", "commit", "close"]
        mock_db.commit.assert_called_once()
        mock_db.rollback.assert_not_called()
        mock_db.close.assert_called_once()

    def test_ingest_task_rolls_back_caller_owned_session_on_failure(self):
        import tasks.suricata as task

        events: list[str] = []
        mock_db = MagicMock()
        mock_db.rollback.side_effect = lambda: events.append("rollback")
        mock_db.close.side_effect = lambda: events.append("close")

        def ingest_failure(*_args, **_kwargs):
            events.append("ingest")
            raise RuntimeError("boom")

        with (
            patch.object(task, "get_session", return_value=mock_db),
            patch.object(task, "set_rls_context"),
            patch.object(task, "ingest_eve_file", side_effect=ingest_failure),
            pytest.raises(RuntimeError),
        ):
            task.ingest_suricata_eve()

        assert events == ["ingest", "rollback", "close"]
        mock_db.commit.assert_not_called()
        mock_db.rollback.assert_called_once()
        mock_db.close.assert_called_once()


class TestSecurityIncidentExists:
    def test_returns_true_when_incident_exists(self, mock_db):
        mock_db.execute.return_value.fetchone.return_value = (1,)
        assert _security_incident_exists(mock_db, log_id=999) is True

    def test_returns_false_when_no_incident(self, mock_db):
        mock_db.execute.return_value.fetchone.return_value = None
        assert _security_incident_exists(mock_db, log_id=999) is False


class TestCreateSecurityIncident:
    def test_high_severity_alert_creates_incident(self, mock_db):
        mock_result = MagicMock()
        mock_result.fetchone.return_value = (42,)
        mock_db.execute.return_value = mock_result

        incident_id = _create_security_incident(
            mock_db,
            log_id=1,
            source_ip="192.168.1.100",
            suricata_sid=123456,
            raw_payload='{"event_type":"alert"}',
        )

        assert incident_id == 42
        calls = mock_db.execute.call_args_list
        fire_incident_call = calls[0]
        params = fire_incident_call[0][1] if len(fire_incident_call[0]) > 1 else {}
        assert params["encoder_id"] == _SVC_SURICATA_UUID
        assert params["region_id"] == _DEFAULT_REGION_ID
        assert params["log_id"] == 1

    def test_security_incident_has_correct_location(self, mock_db):
        mock_result = MagicMock()
        mock_result.fetchone.return_value = (99,)
        mock_db.execute.return_value = mock_result

        _create_security_incident(
            mock_db, log_id=5, source_ip="1.2.3.4", suricata_sid=999, raw_payload="test"
        )

        first_call_args = mock_db.execute.call_args_list[0]
        params = first_call_args[0][1] if len(first_call_args[0]) > 1 else {}
        assert params["lon"] == _BFP_HQ_LONGITUDE
        assert params["lat"] == _BFP_HQ_LATITUDE

    def test_security_incident_links_to_threat_log(self, mock_db):
        mock_result = MagicMock()
        mock_result.fetchone.return_value = (77,)
        mock_db.execute.return_value = mock_result

        _create_security_incident(
            mock_db, log_id=55, source_ip="5.5.5.5", suricata_sid=777, raw_payload="link test"
        )

        first_call_args = mock_db.execute.call_args_list[0]
        params = first_call_args[0][1] if len(first_call_args[0]) > 1 else {}
        assert params["log_id"] == 55

    def test_duplicate_guard_exists(self, mock_db):
        mock_db.execute.return_value.fetchone.return_value = (1,)
        assert _security_incident_exists(mock_db, log_id=10) is True

    def test_security_incident_inserts_nonsensitive_details(self, mock_db):
        mock_result = MagicMock()
        mock_result.fetchone.return_value = (88,)
        mock_db.execute.return_value = mock_result

        _create_security_incident(
            mock_db, log_id=99, source_ip="8.8.8.8", suricata_sid=999, raw_payload="payload"
        )

        calls = mock_db.execute.call_args_list
        ns_call = calls[1]
        ns_sql = str(ns_call[0][0])
        ns_params = ns_call[0][1] if len(ns_call[0]) > 1 else {}
        assert "INSERT INTO wims.incident_nonsensitive_details" in ns_sql
        assert ns_params["iid"] == 88
        assert ns_params["station_name"] == "Auto-detected: SID=999 SRC=8.8.8.8"

    def test_security_incident_inserts_ivh_entry(self, mock_db):
        mock_result = MagicMock()
        mock_result.fetchone.return_value = (55,)
        mock_db.execute.return_value = mock_result

        _create_security_incident(
            mock_db, log_id=100, source_ip="1.1.1.1", suricata_sid=111, raw_payload="ivh test"
        )

        calls = mock_db.execute.call_args_list
        ivh_call = calls[2]
        ivh_sql = str(ivh_call[0][0])
        ivh_params = ivh_call[0][1] if len(ivh_call[0]) > 1 else {}
        assert "INSERT INTO wims.incident_verification_history" in ivh_sql
        assert ivh_params["iid"] == 55
        assert ivh_params["uid"] == _SVC_SURICATA_UUID

    def test_high_severity_no_longer_auto_creates_incident(self, mock_db):
        import services.suricata_ingestion as si

        mock_ins = MagicMock(return_value=50)
        mock_create = MagicMock(return_value=5001)
        mock_exists = MagicMock(return_value=False)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tf:
            tf.write(
                '{"event_type":"alert","src_ip":"10.0.0.1","dest_ip":"8.8.8.8","alert":{"signature_id":1,"severity":3}}\n'
            )
            tf.flush()
            temp_path = tf.name

        try:
            with patch.object(si, "_insert_row", mock_ins):
                with patch.object(si, "_security_incident_exists", mock_exists):
                    with patch.object(si, "_create_security_incident", mock_create):
                        si.ingest_eve_file(temp_path, db_session=mock_db)

            assert mock_ins.call_count >= 1, f"_insert_row: {mock_ins.call_count}"
            assert mock_create.call_count == 0, (
                f"_create_security_incident should NOT be called after #165: {mock_create.call_count}"
            )
        finally:
            os.unlink(temp_path)

    def test_medium_severity_does_not_trigger_auto_incident(self, mock_db):
        import services.suricata_ingestion as si

        mock_ins = MagicMock(return_value=50)
        mock_create = MagicMock()
        mock_exists = MagicMock(return_value=False)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tf:
            tf.write(
                '{"event_type":"alert","src_ip":"10.0.0.1","dest_ip":"8.8.8.8","alert":{"signature_id":1,"severity":2}}\n'
            )
            tf.flush()
            temp_path = tf.name

        try:
            with patch.object(si, "_insert_row", mock_ins):
                with patch.object(si, "_security_incident_exists", mock_exists):
                    with patch.object(si, "_create_security_incident", mock_create):
                        si.ingest_eve_file(temp_path, db_session=mock_db)

            assert mock_ins.call_count >= 1, f"_insert_row: {mock_ins.call_count}"
            assert mock_create.call_count == 0, (
                f"_create_security_incident: {mock_create.call_count}"
            )
        finally:
            os.unlink(temp_path)
