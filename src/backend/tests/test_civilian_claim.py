"""Tests for POST /api/civilian/reports/claim (Issue #654).

Covers the secure claim handshake: an anonymous reporter who later registers
can attach their report to their CIVILIAN_REPORTER account using the tracking
token. Security branches (401/404/409) are exercised without a live DB by
overriding the optional_auth and get_db dependencies. The success path patches
_fetch_report_response so no Postgres round-trip is required.
"""

import hashlib
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from api.routes import civilian
from database import get_db
from auth import optional_auth


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class _MockDB:
    """Minimal DB mock for the claim endpoint guard branches."""

    def __init__(self, *, valid_token: bool, already_linked: bool):
        self._valid_token = valid_token
        self._already_linked = already_linked
        self.committed = False
        self.executed = []

    def execute(self, statement, params=None):
        sql = str(statement)
        self.executed.append(sql)
        if "validate_tracking_token" in sql:

            class _R:
                def scalar(self):
                    return self._v

            r = _R()
            r._v = self._valid_token
            return r
        if "UPDATE wims.citizen_reports" in sql:

            class _U:
                # 0 rows => already linked; 1 row => claimed
                rowcount = 0 if self._already_linked else 1

            return _U()

        class _Empty:
            def scalar(self):
                return None

            def fetchone(self):
                return None

        return _Empty()

    def commit(self):
        self.committed = True


@pytest.fixture
def client():
    from main import app

    return TestClient(app)


@contextmanager
def _override_auth(app, user):
    app.dependency_overrides[optional_auth] = lambda: user
    yield
    app.dependency_overrides.pop(optional_auth, None)


@contextmanager
def _override_db(app, db):
    app.dependency_overrides[get_db] = lambda: db
    yield
    app.dependency_overrides.pop(get_db, None)


def test_claim_requires_authenticated_reporter(client):
    from main import app

    # Anonymous (optional_auth returns None) -> 401
    with (
        _override_auth(app, None),
        _override_db(app, _MockDB(valid_token=True, already_linked=False)),
    ):
        resp = client.post(
            "/api/civilian/reports/claim",
            json={"report_id": 1, "tracking_token": "abc"},
        )
    assert resp.status_code == 401


def test_claim_rejects_non_reporter_role(client):
    from main import app

    with (
        _override_auth(app, {"user_id": 7, "role": "VIEWER"}),
        _override_db(app, _MockDB(valid_token=True, already_linked=False)),
    ):
        resp = client.post(
            "/api/civilian/reports/claim",
            json={"report_id": 1, "tracking_token": "abc"},
        )
    assert resp.status_code == 401


def test_claim_invalid_token_returns_neutral_404(client):
    from main import app

    with (
        _override_auth(app, {"user_id": 7, "role": "CIVILIAN_REPORTER"}),
        _override_db(app, _MockDB(valid_token=False, already_linked=False)),
    ):
        resp = client.post(
            "/api/civilian/reports/claim",
            json={"report_id": 1, "tracking_token": "wrong"},
        )
    # Neutral 404 — must not distinguish "report exists, bad token" from "no report".
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Report not found"


def test_claim_already_linked_returns_409(client):
    from main import app

    with (
        _override_auth(app, {"user_id": 7, "role": "CIVILIAN_REPORTER"}),
        _override_db(app, _MockDB(valid_token=True, already_linked=True)),
    ):
        resp = client.post(
            "/api/civilian/reports/claim",
            json={"report_id": 1, "tracking_token": "good"},
        )
    assert resp.status_code == 409
    assert "linked" in resp.json()["detail"].lower()


def test_claim_success_links_report_and_returns_response(client, monkeypatch):
    from main import app

    captured = {}

    def fake_fetch(db, report_id):
        captured["report_id"] = report_id
        captured["contributor_user_id"] = db.executed  # touch to ensure call
        return {
            "report_id": report_id,
            "latitude": 14.5995,
            "longitude": 120.9842,
            "trust_score": 50,
            "status": "PENDING",
            "created_at": "2026-07-18T00:00:00",
        }

    monkeypatch.setattr(civilian, "_fetch_report_response", fake_fetch)

    db = _MockDB(valid_token=True, already_linked=False)
    with _override_auth(app, {"user_id": 7, "role": "CIVILIAN_REPORTER"}), _override_db(app, db):
        resp = client.post(
            "/api/civilian/reports/claim",
            json={"report_id": 42, "tracking_token": "good"},
        )
    assert resp.status_code == 200
    assert resp.json()["report_id"] == 42
    # The race-safe UPDATE must have scoped contributor_user_id = :uid.
    update_sql = next(s for s in db.executed if "UPDATE wims.citizen_reports" in s)
    assert "contributor_user_id = :uid" in update_sql
    assert "contributor_user_id IS NULL" in update_sql
    assert db.committed is True
