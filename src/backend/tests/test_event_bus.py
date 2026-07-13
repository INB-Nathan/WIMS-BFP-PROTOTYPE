"""Unit tests for the synchronous event_bus publish helpers.

These helpers are called from sync request handlers and Celery tasks as
fire-and-forget notifications: a Redis outage must never propagate as an
exception to the caller (which would turn a successful mutation into a 500,
or fail a Celery task that has already committed its DB work).
"""

from services import event_bus


def _raise(*_args, **_kwargs):
    raise ConnectionError("Redis is unreachable")


def test_publish_verification_event_sync_swallows_redis_errors(monkeypatch):
    monkeypatch.setattr(event_bus, "_get_sync_redis", _raise)

    # Must not raise despite the underlying Redis client being unreachable.
    event_bus.publish_verification_event_sync(
        "civilian.report_submitted",
        report_id=1,
        extra={"region_id": 2},
    )


def test_publish_verification_event_sync_publishes_on_healthy_redis(monkeypatch):
    published = {}

    class _FakeRedis:
        def publish(self, channel, message):
            published["channel"] = channel
            published["message"] = message

    monkeypatch.setattr(event_bus, "_get_sync_redis", lambda: _FakeRedis())

    event_bus.publish_verification_event_sync(
        "civilian.report_submitted",
        report_id=42,
        extra={"region_id": 7},
    )

    assert published["channel"] == event_bus.CHANNELS["verification"]
    assert '"event_type": "civilian.report_submitted"' in published["message"]
    assert '"report_id": 42' in published["message"]


def test_publish_system_event_sync_swallows_redis_errors(monkeypatch):
    monkeypatch.setattr(event_bus, "_get_sync_redis", _raise)

    # Must not raise despite the underlying Redis client being unreachable.
    event_bus.publish_system_event_sync("system.config_changed", {"key": "x"})


def test_publish_system_event_sync_publishes_on_healthy_redis(monkeypatch):
    published = {}

    class _FakeRedis:
        def publish(self, channel, message):
            published["channel"] = channel
            published["message"] = message

    monkeypatch.setattr(event_bus, "_get_sync_redis", lambda: _FakeRedis())

    event_bus.publish_system_event_sync("system.worker_status", {"pruned_count": 3})

    assert published["channel"] == event_bus.CHANNELS["system"]
    assert '"event_type": "system.worker_status"' in published["message"]
