"""Unit tests for the Community Safety Hub expiry task."""

from __future__ import annotations

from tasks import expire_content


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _Savepoint:
    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _tb):
        return False


class _Session:
    def __init__(self):
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def execute(self, _sql):
        return _Result([("content-a",), ("content-b",)])

    def begin_nested(self):
        return _Savepoint()

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def test_expiry_task_archives_returned_ids_and_commits(monkeypatch):
    session = _Session()
    audits = []
    monkeypatch.setattr(expire_content, "get_session", lambda _user_id: session)
    monkeypatch.setattr(
        expire_content,
        "log_system_audit",
        lambda **kwargs: audits.append(kwargs),
    )

    result = expire_content.expire_published_content.run()

    assert result == 2
    assert session.committed is True
    assert session.rolled_back is False
    assert session.closed is True
    assert audits[0]["action_type"] == "CMS_EXPIRY_SYSTEM"
    assert audits[0]["new_values"] == {"archived_count": 2}


class _EmptySession(_Session):
    """Session whose UPDATE returns no rows (nothing expired to archive)."""

    def execute(self, _sql):
        return _Result([])


def test_expiry_task_emits_no_audit_when_nothing_archived(monkeypatch):
    session = _EmptySession()
    audits = []
    monkeypatch.setattr(expire_content, "get_session", lambda _user_id: session)
    monkeypatch.setattr(
        expire_content,
        "log_system_audit",
        lambda **kwargs: audits.append(kwargs),
    )

    result = expire_content.expire_published_content.run()

    assert result == 0
    assert session.committed is True
    assert session.closed is True
    # No-op beat runs must not pollute the audit trail.
    assert audits == []


class _RedisFake:
    """Recording fake for the sync Redis client used by the task.

    Captures incrby/set calls so the test can assert the cumulative expiry
    metrics are written to the correct Redis keys. The real client is never
    contacted.
    """

    def __init__(self):
        self.ops = []

    def incrby(self, key, amount):
        self.ops.append(("incrby", key, amount))

    def set(self, key, value):
        self.ops.append(("set", key, value))


def test_expiry_task_emits_redis_metrics_on_success_and_noop(monkeypatch):
    """The task mirrors cumulative counters into Redis (fail-open).

    A real archive run (count > 0) increments ``archived_total`` by count and
    sets ``last_success_ts``, but must NOT touch ``skipped_total``. A no-op run
    (count == 0) increments ``archived_total`` by 0 and ``skipped_total`` by 1,
    and still sets ``last_success_ts``. The commit and audit gate are untouched.
    """

    def run_with(session_cls):
        session = session_cls()
        fake_redis = _RedisFake()
        monkeypatch.setattr(expire_content, "get_session", lambda _user_id: session)
        monkeypatch.setattr(
            expire_content,
            "get_redis_client",
            lambda: fake_redis,
        )
        result = expire_content.expire_published_content.run()
        return result, session, fake_redis

    # Scenario 1: archive run (count > 0).
    result, session, fake_redis = run_with(_Session)
    assert result == 2
    assert session.committed is True
    incrby = [op for op in fake_redis.ops if op[0] == "incrby"]
    sets = [op for op in fake_redis.ops if op[0] == "set"]
    assert ("incrby", "metrics:community_content_expiry:archived_total", 2) in incrby
    # A real archive run must not increment the no-op skip counter.
    assert all(op[1] != "metrics:community_content_expiry:skipped_total" for op in incrby)
    # last_success_ts is set on every successful run.
    assert ("set", "metrics:community_content_expiry:last_success_ts") in [
        (op[0], op[1]) for op in sets
    ]

    # Scenario 2: no-op run (count == 0).
    result, session, fake_redis = run_with(_EmptySession)
    assert result == 0
    assert session.committed is True
    incrby = [op for op in fake_redis.ops if op[0] == "incrby"]
    sets = [op for op in fake_redis.ops if op[0] == "set"]
    # archived_total still incremented (by 0); skipped_total incremented by 1.
    assert ("incrby", "metrics:community_content_expiry:archived_total", 0) in incrby
    assert ("incrby", "metrics:community_content_expiry:skipped_total", 1) in incrby
    assert ("set", "metrics:community_content_expiry:last_success_ts") in [
        (op[0], op[1]) for op in sets
    ]
