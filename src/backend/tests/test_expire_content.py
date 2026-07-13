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
