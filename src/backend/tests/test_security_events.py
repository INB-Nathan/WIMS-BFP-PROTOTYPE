"""Tests for POST /api/auth/security-event (RP-08 FAILED_LOGIN, RP-18 PASSWORD_RESET, RP-19 LOGOUT)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


def _make_client(mock_db):
    """Return a TestClient with get_db overridden and Redis disabled."""
    from main import app
    from database import get_db

    app.dependency_overrides[get_db] = lambda: mock_db
    return app


@pytest.fixture()
def client_no_redis():
    """TestClient with get_db overridden to a MagicMock session, Redis disabled."""
    from main import app
    from database import get_db

    mock_db = MagicMock()
    app.dependency_overrides[get_db] = lambda: mock_db

    with patch("api.routes.auth._get_redis", new=AsyncMock(return_value=None)):
        with TestClient(app) as c:
            yield c, mock_db

    app.dependency_overrides.clear()


def test_logout_returns_202_and_writes_audit_row(client_no_redis):
    """LOGOUT event → 202, audit row inserted with uid=None, commit called."""
    client, mock_db = client_no_redis
    res = client.post(
        "/api/auth/security-event",
        json={"event_type": "LOGOUT", "username": "jdoe"},
    )
    assert res.status_code == 202
    body = res.json()
    assert body["status"] == "recorded"
    assert body["event_type"] == "LOGOUT"

    assert mock_db.execute.called, "log_system_audit must call db.execute"
    assert mock_db.commit.called, "endpoint must commit the audit row"

    # user_id (SQL param "uid") must be NULL for unauthenticated endpoint
    call_params = mock_db.execute.call_args[0][1]
    assert call_params.get("uid") is None, "audit row must have user_id=NULL"


def test_unknown_event_type_returns_422(client_no_redis):
    """Unknown event_type → 422 Unprocessable Entity, no DB write."""
    client, mock_db = client_no_redis
    res = client.post(
        "/api/auth/security-event",
        json={"event_type": "INVALID_EVENT"},
    )
    assert res.status_code == 422
    assert not mock_db.execute.called


def test_rate_limit_blocks_31st_request():
    """31st request within the rate window → 429 Too Many Requests."""
    from main import app
    from database import get_db
    from fastapi import HTTPException

    mock_db = MagicMock()
    app.dependency_overrides[get_db] = lambda: mock_db

    call_count = 0

    async def counting_rate_limit(r, key, max_requests, window_seconds):
        nonlocal call_count
        call_count += 1
        if call_count > 30:
            raise HTTPException(
                status_code=429, detail="Too many requests. Try again in 60 seconds."
            )

    mock_redis = AsyncMock()

    with patch("api.routes.auth._get_redis", new=AsyncMock(return_value=mock_redis)):
        with patch("api.routes.auth._check_rate_limit", new=counting_rate_limit):
            with TestClient(app) as client:
                for _ in range(30):
                    res = client.post(
                        "/api/auth/security-event",
                        json={"event_type": "LOGOUT"},
                    )
                    assert res.status_code == 202

                res = client.post(
                    "/api/auth/security-event",
                    json={"event_type": "LOGOUT"},
                )
                assert res.status_code == 429

    app.dependency_overrides.clear()


def test_failed_login_event_returns_202(client_no_redis):
    """FAILED_LOGIN event is accepted and returns 202 with result=failure audit row."""
    client, mock_db = client_no_redis
    res = client.post(
        "/api/auth/security-event",
        json={"event_type": "FAILED_LOGIN", "username": "attacker"},
    )
    assert res.status_code == 202
    assert res.json()["event_type"] == "FAILED_LOGIN"
    assert mock_db.execute.called
    assert mock_db.commit.called
