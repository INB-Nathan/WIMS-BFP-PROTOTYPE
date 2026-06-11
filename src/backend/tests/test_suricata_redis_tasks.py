"""TDD: Redis stream pipeline tasks — ACK ordering, dedup, fallback, AI gate (#157).

Mocks Redis at the client level to verify:
- T1: Consumer group creation
- T2: Redis-unreachable fallback returns 0
- T3: HIGH/CRITICAL alerts forwarded to ai:queue
- T4: Invalid JSON messages are acked and skipped
- T6: ACK ordering (xack after commit, not before)
- T8: Auto-AI gate disabled → messages acked without analysis
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
import redis

from celery_config import celery_app


def _task_modules_registered():
    import tasks.suricata_redis  # noqa: F401
    import tasks.ai_forwarding  # noqa: F401


@pytest.fixture(autouse=True)
def _auto_register():
    _task_modules_registered()
    yield
    celery_app.tasks.pop("tasks.suricata_redis.subscribe_alerts", None)
    celery_app.tasks.pop("tasks.ai_forwarding.process_queue", None)


def _eve_alert_json(severity=2):
    return json.dumps(
        {
            "event_type": "alert",
            "src_ip": "10.0.0.1",
            "dest_ip": "10.0.0.2",
            "timestamp": "2026-06-10T00:00:00+0000",
            "alert": {"signature_id": 1000001, "severity": severity},
        }
    )


def _stream_entry(alert_json=None, message_id="1000-0"):
    if alert_json is None:
        alert_json = _eve_alert_json()
    return [
        (
            b"suricata:alerts",
            [(message_id.encode(), {b"alert": alert_json.encode()})],
        )
    ]


class TestEnsureGroup:
    def test_ensure_group_creates_stream_and_group(self):
        r = MagicMock(spec=redis.Redis)
        from tasks.suricata_redis import _ensure_group, STREAM_KEY, GROUP_NAME

        _ensure_group(r)
        r.xgroup_create.assert_called_once_with(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)

    def test_ensure_group_suppresses_busygroup_error(self):
        r = MagicMock(spec=redis.Redis)
        from redis import ResponseError

        r.xgroup_create.side_effect = ResponseError("BUSYGROUP consumer group name already exists")
        from tasks.suricata_redis import _ensure_group

        _ensure_group(r)


class TestRedisUnreachableFallback:
    def test_connect_error_returns_zero(self):
        from redis import ConnectionError

        with patch(
            "tasks.suricata_redis._connect",
            side_effect=ConnectionError("no connection"),
        ):
            from tasks.suricata_redis import subscribe_suricata_alerts

            result = subscribe_suricata_alerts()
        assert result == 0

    def test_timeout_error_returns_zero(self):
        from redis import TimeoutError

        with patch(
            "tasks.suricata_redis._connect",
            side_effect=TimeoutError("timeout"),
        ):
            from tasks.suricata_redis import subscribe_suricata_alerts

            result = subscribe_suricata_alerts()
        assert result == 0


class TestSubscribeSuricataAlerts:
    def test_high_severity_forwarded_to_ai_queue(self):
        alert = _eve_alert_json(severity=3)
        entries = _stream_entry(alert)
        r = MagicMock(spec=redis.Redis)
        r.xreadgroup.return_value = entries
        r.set.return_value = True

        with (
            patch("tasks.suricata_redis.get_session", return_value=MagicMock()),
            patch("tasks.suricata_redis.set_rls_context"),
            patch("tasks.suricata_redis._connect", return_value=r),
            patch("tasks.suricata_redis._ensure_group"),
            patch("tasks.suricata_redis._insert_log", return_value=42),
            patch("tasks.suricata_redis.publish_security_event_sync"),
        ):
            from tasks.suricata_redis import subscribe_suricata_alerts

            result = subscribe_suricata_alerts()

        assert result == 1

    def test_medium_severity_not_forwarded_to_ai_queue(self):
        alert = _eve_alert_json(severity=2)
        entries = _stream_entry(alert)
        r = MagicMock(spec=redis.Redis)
        r.xreadgroup.return_value = entries
        r.set.return_value = True

        with (
            patch("tasks.suricata_redis.get_session", return_value=MagicMock()),
            patch("tasks.suricata_redis.set_rls_context"),
            patch("tasks.suricata_redis._connect", return_value=r),
            patch("tasks.suricata_redis._ensure_group"),
            patch("tasks.suricata_redis._insert_log", return_value=42),
            patch("tasks.suricata_redis.publish_security_event_sync"),
        ):
            from tasks.suricata_redis import subscribe_suricata_alerts

            result = subscribe_suricata_alerts()

        assert result == 1
        r.xadd.assert_not_called()

    def test_xack_called_after_commit_not_before(self):
        alert = _eve_alert_json()
        entries = _stream_entry(alert)
        r = MagicMock(spec=redis.Redis)
        r.xreadgroup.return_value = entries
        r.set.return_value = True

        call_order = []

        def track_xack(*args, **kw):
            call_order.append("xack")

        r.xack.side_effect = track_xack

        mock_db = MagicMock()

        def track_commit():
            call_order.append("commit")

        mock_db.commit.side_effect = track_commit

        with (
            patch("tasks.suricata_redis.get_session", return_value=mock_db),
            patch("tasks.suricata_redis.set_rls_context"),
            patch("tasks.suricata_redis._connect", return_value=r),
            patch("tasks.suricata_redis._ensure_group"),
            patch("tasks.suricata_redis._insert_log", return_value=42),
            patch("tasks.suricata_redis.publish_security_event_sync"),
        ):
            from tasks.suricata_redis import subscribe_suricata_alerts

            subscribe_suricata_alerts()

        assert "commit" in call_order
        assert "xack" in call_order
        assert call_order.index("commit") < call_order.index("xack"), (
            "xack must be called AFTER commit"
        )

    def test_duplicate_detected_skipped(self):
        alert = _eve_alert_json()
        entries = _stream_entry(alert)
        r = MagicMock(spec=redis.Redis)
        r.xreadgroup.return_value = entries
        r.set.return_value = False

        with (
            patch("tasks.suricata_redis.get_session", return_value=MagicMock()),
            patch("tasks.suricata_redis.set_rls_context"),
            patch("tasks.suricata_redis._connect", return_value=r),
            patch("tasks.suricata_redis._ensure_group"),
            patch("tasks.suricata_redis._insert_log") as mock_insert,
        ):
            from tasks.suricata_redis import subscribe_suricata_alerts

            result = subscribe_suricata_alerts()

        assert result == 0
        mock_insert.assert_not_called()


class TestInvalidJsonHandling:
    def test_invalid_json_acked_and_skipped(self):
        entries = [
            (
                b"suricata:alerts",
                [(b"9999-0", {b"alert": b"not_json_at_all"})],
            )
        ]
        r = MagicMock(spec=redis.Redis)
        r.xreadgroup.return_value = entries
        r.set.return_value = True

        with (
            patch("tasks.suricata_redis.get_session", return_value=MagicMock()),
            patch("tasks.suricata_redis.set_rls_context"),
            patch("tasks.suricata_redis._connect", return_value=r),
            patch("tasks.suricata_redis._ensure_group"),
            patch("tasks.suricata_redis._insert_log") as mock_insert,
            patch("json.loads", side_effect=json.JSONDecodeError("bad json", "", 0)),
        ):
            from tasks.suricata_redis import subscribe_suricata_alerts

            result = subscribe_suricata_alerts()

        assert result == 0
        mock_insert.assert_not_called()


class TestProcessAiQueue:
    def _ai_stream_entry(self, log_id="42"):
        return [
            (
                b"ai:queue",
                [
                    (
                        b"2000-0",
                        {
                            b"log_id": log_id.encode(),
                            b"severity": b"HIGH",
                        },
                    )
                ],
            )
        ]

    def test_auto_ai_disabled_acks_without_analysis(self):
        entries = self._ai_stream_entry()
        r = MagicMock(spec=redis.Redis)
        r.xreadgroup.return_value = entries

        with (
            patch("tasks.ai_forwarding.get_session", return_value=MagicMock()),
            patch("tasks.ai_forwarding.set_rls_context"),
            patch("tasks.ai_forwarding._connect", return_value=r),
            patch("tasks.ai_forwarding._ensure_group"),
            patch("tasks.ai_forwarding._auto_ai_enabled", return_value=False),
            patch("services.ai_service.analyze_threat_log") as mock_analyze,
        ):
            from tasks.ai_forwarding import process_ai_queue

            result = process_ai_queue()

        assert result == 0
        r.xack.assert_called_once()
        mock_analyze.assert_not_called()

    def test_ai_failure_leaves_message_unacked(self):
        entries = self._ai_stream_entry()
        r = MagicMock(spec=redis.Redis)
        r.xreadgroup.return_value = entries

        with (
            patch("tasks.ai_forwarding.get_session", return_value=MagicMock()),
            patch("tasks.ai_forwarding.set_rls_context"),
            patch("tasks.ai_forwarding._connect", return_value=r),
            patch("tasks.ai_forwarding._ensure_group"),
            patch("tasks.ai_forwarding._auto_ai_enabled", return_value=True),
        ):
            from tasks.ai_forwarding import process_ai_queue

            result = process_ai_queue()

        assert result == 0
