"""Unit contracts for anonymous capability plumbing and ownership."""

from __future__ import annotations

import uuid
import pytest
from fastapi import HTTPException
from starlette.requests import Request

import auth
from services.anonymous_sessions import (
    IssuedAnonymousSession,
    authorize_pending_photo,
    issue_anonymous_session,
    resolve_pending_photo_owner,
    revoke_anonymous_session,
    validate_anonymous_session,
)
from services.report_photos import upload_pending_photo


def _request(*, authorization: str | None = None, query: str = "") -> Request:
    headers = [] if authorization is None else [(b"authorization", authorization.encode())]
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/civilian/photos/upload",
            "headers": headers,
            "query_string": query.encode(),
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
        }
    )


class _Result:
    def __init__(self, value=None, row=None):
        self.value = value
        self.row = row

    def scalar_one_or_none(self):
        return self.value

    def one(self):
        return self.row


class _DB:
    def __init__(self, *results):
        self.results = list(results)
        self.statements = []
        self.commits = 0
        self.rollbacks = 0

    def execute(self, statement, params=None):
        self.statements.append((statement, params))
        return self.results.pop(0)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_issue_returns_raw_token_once_without_logging_or_python_storage():
    session_id = uuid.uuid4()
    raw_token = "a" * 64
    db = _DB(_Result(row=(session_id, raw_token)))

    issued = issue_anonymous_session(db, device_id_hash="b" * 64)

    assert issued == IssuedAnonymousSession(session_id, raw_token)
    assert db.commits == 1
    assert raw_token not in str(db.statements[0][0])
    # The adapter has no logger/storage sink and only passes the bound value to SQL.
    assert db.statements[0][1] == {"device_id_hash": "b" * 64}


def test_validate_returns_only_derived_session_uuid():
    session_id = uuid.uuid4()
    db = _DB(_Result(value=session_id))

    assert validate_anonymous_session(db, "c" * 64) == session_id
    assert db.commits == 0
    assert db.statements[0][1] == {"raw_token": "c" * 64}


@pytest.mark.parametrize("capability", ["invalid", "expired", "revoked"])
def test_invalid_expired_or_revoked_capability_is_neutral_404(monkeypatch, capability):
    monkeypatch.setattr(auth, "validate_anonymous_session", lambda _db, _token: None)

    with pytest.raises(HTTPException) as exc_info:
        auth.get_anonymous_session_id(_request(authorization=f"Bearer {capability}"), object())

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Photo not found"


def test_valid_capability_returns_only_session_uuid(monkeypatch):
    session_id = uuid.uuid4()
    seen = []

    def validate(_db, token):
        seen.append(token)
        return session_id

    monkeypatch.setattr(auth, "validate_anonymous_session", validate)
    assert (
        auth.get_anonymous_session_id(_request(authorization="Bearer " + "1" * 64), object())
        == session_id
    )
    assert seen == ["1" * 64]


def test_missing_capability_remains_anonymous_and_query_tokens_are_ignored(monkeypatch):
    called = False

    def unexpected_validate(_db, _token):
        nonlocal called
        called = True
        return uuid.uuid4()

    monkeypatch.setattr(auth, "validate_anonymous_session", unexpected_validate)
    assert auth.get_anonymous_session_id(_request(query="capability=" + "d" * 64), object()) is None
    assert called is False


def test_non_bearer_authorization_fails_closed():
    with pytest.raises(HTTPException) as exc_info:
        auth.get_anonymous_session_id(_request(authorization="Basic abc"), object())
    assert exc_info.value.status_code == 404


def test_registered_and_anonymous_pending_owners_are_exclusive():
    session_id = uuid.uuid4()
    user_id = uuid.uuid4()

    assert resolve_pending_photo_owner(
        registered_user={"user_id": user_id, "role": "CIVILIAN_REPORTER"},
        anonymous_session_id=session_id,
    ) == (user_id, None)
    assert resolve_pending_photo_owner(
        registered_user=None,
        anonymous_session_id=session_id,
    ) == (None, session_id)

    with pytest.raises(ValueError):
        resolve_pending_photo_owner(registered_user=None, anonymous_session_id=None)


def test_cross_session_pending_photo_denial_is_false():
    db = _DB(_Result(value=False))
    assert authorize_pending_photo(db, "e" * 64, uuid.uuid4()) is False
    statement, params = db.statements[0]
    assert "authorize_anonymous_pending_photo" in str(statement)
    assert params["raw_token"] == "e" * 64


def test_pending_photo_service_fails_closed_before_any_write():
    with pytest.raises(HTTPException) as exc_info:
        upload_pending_photo(
            db=object(),
            file=object(),
            registered_user=None,
            anonymous_session_id=uuid.uuid4(),
        )
    assert exc_info.value.status_code == 501


def test_revoke_commits_without_returning_or_storing_token():
    db = _DB(_Result(value=True))
    assert revoke_anonymous_session(db, "f" * 64) is True
    assert db.commits == 1
    assert db.statements[0][1] == {"raw_token": "f" * 64}
