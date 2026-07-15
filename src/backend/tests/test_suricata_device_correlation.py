"""Tests for services/suricata_ingestion.py device-token correlation
(Wayfinder — issue #568): reads the Redis telemetry hash written by
device_token_middleware and correlates it onto a security_threat_logs row.
"""

import json

from unittest.mock import MagicMock, patch

from services.suricata_ingestion import _correlate_device_token, _insert_row


def _mock_redis_with_hgetall(entries: dict) -> MagicMock:
    r = MagicMock()
    r.hgetall.return_value = entries
    r.close = MagicMock()
    return r


class TestCorrelateDeviceToken:
    def test_no_telemetry_returns_all_none(self):
        """No entries for this IP → all correlation columns are None."""
        with patch(
            "services.suricata_ingestion._redis_lib.Redis.from_url",
            return_value=_mock_redis_with_hgetall({}),
        ):
            result = _correlate_device_token("1.2.3.4")
        assert result == {
            "device_token_hash": None,
            "device_correlation_source": None,
            "device_correlation_confidence": None,
            "device_observed_at": None,
        }

    def test_single_hash_high_confidence(self):
        """Exactly one distinct device hash for the IP → high confidence."""
        payload = json.dumps(
            {
                "device_token_hash": "abc123",
                "user_agent": "curl/8.0",
                "authenticated_user_id": None,
                "timestamp": "2026-07-15T10:00:00+00:00",
                "path": "/api/civilian/reports",
            }
        )
        with patch(
            "services.suricata_ingestion._redis_lib.Redis.from_url",
            return_value=_mock_redis_with_hgetall({"abc123": payload}),
        ):
            result = _correlate_device_token("1.2.3.4")
        assert result["device_token_hash"] == "abc123"
        assert result["device_correlation_source"] == "redis_telemetry"
        assert result["device_correlation_confidence"] == "high"
        assert result["device_observed_at"] == "2026-07-15T10:00:00+00:00"

    def test_multiple_hashes_ambiguous(self):
        """2+ distinct device hashes for the same IP (CGNAT) → ambiguous, no hash."""
        payload_a = json.dumps({"timestamp": "2026-07-15T10:00:00+00:00"})
        payload_b = json.dumps({"timestamp": "2026-07-15T10:05:00+00:00"})
        with patch(
            "services.suricata_ingestion._redis_lib.Redis.from_url",
            return_value=_mock_redis_with_hgetall({"hash_a": payload_a, "hash_b": payload_b}),
        ):
            result = _correlate_device_token("1.2.3.4")
        assert result["device_token_hash"] is None
        assert result["device_correlation_source"] == "redis_telemetry"
        assert result["device_correlation_confidence"] == "ambiguous"
        assert result["device_observed_at"] == "2026-07-15T10:05:00+00:00"  # latest of the two

    def test_redis_down_fails_open(self):
        """Redis unavailable during read → all None, no exception raised."""
        with patch(
            "services.suricata_ingestion._redis_lib.Redis.from_url",
            side_effect=Exception("connection refused"),
        ):
            result = _correlate_device_token("1.2.3.4")
        assert result["device_token_hash"] is None
        assert result["device_correlation_source"] is None

    def test_empty_source_ip_returns_all_none_without_redis_call(self):
        with patch("services.suricata_ingestion._redis_lib.Redis.from_url") as from_url:
            result = _correlate_device_token("")
        assert result["device_token_hash"] is None
        from_url.assert_not_called()

    def test_malformed_json_entry_skipped(self):
        """A corrupt JSON payload for one hash is skipped rather than raising."""
        with patch(
            "services.suricata_ingestion._redis_lib.Redis.from_url",
            return_value=_mock_redis_with_hgetall({"bad_hash": "not-json"}),
        ):
            result = _correlate_device_token("1.2.3.4")
        assert result["device_token_hash"] is None
        assert result["device_correlation_source"] is None


class TestInsertRowIncludesDeviceColumns:
    def test_insert_row_passes_device_correlation_params(self):
        """_insert_row forwards device_* keys to the INSERT, defaulting to
        None when the row dict doesn't carry them (backward compatible)."""
        db = MagicMock()
        db.execute.return_value.scalar.return_value = 55

        row = {
            "source_ip": "1.2.3.4",
            "destination_ip": "5.6.7.8",
            "suricata_sid": 1,
            "severity_level": "HIGH",
            "raw_payload": "{}",
            "classification": "test",
            "suricata_signature": "sig",
            "suricata_category": "cat",
            "device_token_hash": "abc123",
            "device_correlation_source": "redis_telemetry",
            "device_correlation_confidence": "high",
            "device_observed_at": "2026-07-15T10:00:00+00:00",
        }
        log_id = _insert_row(db, row)
        assert log_id == 55
        params = db.execute.call_args.args[1]
        assert params["device_token_hash"] == "abc123"
        assert params["device_correlation_confidence"] == "high"

    def test_insert_row_defaults_device_columns_when_absent(self):
        """Rows without device_* keys (e.g. older callers) still insert cleanly."""
        db = MagicMock()
        db.execute.return_value.scalar.return_value = 56

        row = {
            "source_ip": "1.2.3.4",
            "destination_ip": "5.6.7.8",
            "suricata_sid": 1,
            "severity_level": "HIGH",
            "raw_payload": "{}",
            "classification": "test",
            "suricata_signature": "sig",
            "suricata_category": "cat",
        }
        log_id = _insert_row(db, row)
        assert log_id == 56
        params = db.execute.call_args.args[1]
        assert params["device_token_hash"] is None
        assert params["device_correlation_confidence"] is None
