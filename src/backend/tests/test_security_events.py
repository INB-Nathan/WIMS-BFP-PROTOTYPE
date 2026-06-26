"""Tests for POST /api/auth/security-event (RP-08 FAILED_LOGIN, RP-18 PASSWORD_RESET, RP-19 LOGOUT)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import api.routes.security_events as security_events_module


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


# ====== KC Event SPI tests (POST /api/auth/keycloak-event) ======

VALID_SECRET = "test-secret-abc123"
KC_EVENT_URL = "/api/auth/keycloak-event"


def _make_client(secret: str = VALID_SECRET) -> tuple[TestClient, MagicMock]:
    """Return a TestClient with get_db mocked and _get_kc_secret patched to return secret."""
    from main import app
    from database import get_db

    mock_db = MagicMock()
    mock_db.execute.return_value = MagicMock()

    def _mock_get_db():
        yield mock_db

    app.dependency_overrides[get_db] = _mock_get_db
    client = TestClient(app, raise_server_exceptions=False)
    return client, mock_db


@pytest.fixture(autouse=True)
def _cleanup_overrides():
    from main import app
    from database import get_db

    yield
    app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------
# Bearer auth tests
# ---------------------------------------------------------------------------


def test_missing_authorization_header_returns_401():
    client, _ = _make_client()
    with patch.object(security_events_module, "_get_kc_secret", return_value=VALID_SECRET):
        r = client.post(KC_EVENT_URL, json={"event_type": "LOGIN_ERROR"})
    assert r.status_code == 401


def test_wrong_secret_returns_401():
    client, _ = _make_client()
    with patch.object(security_events_module, "_get_kc_secret", return_value=VALID_SECRET):
        r = client.post(
            KC_EVENT_URL,
            json={"event_type": "LOGIN_ERROR"},
            headers={"Authorization": "Bearer wrong-secret"},
        )
    assert r.status_code == 401


def test_unset_backend_secret_fail_closed():
    """If WIMS_KEYCLOAK_EVENT_SECRET is blank, every request → 401."""
    client, _ = _make_client()
    with patch.object(security_events_module, "_get_kc_secret", return_value=""):
        r = client.post(
            KC_EVENT_URL,
            json={"event_type": "LOGIN_ERROR"},
            headers={"Authorization": f"Bearer {VALID_SECRET}"},
        )
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Event mapping + audit write tests
# ---------------------------------------------------------------------------


def test_valid_secret_login_error_returns_202_failed_login():
    client, mock_db = _make_client()
    with (
        patch.object(security_events_module, "_get_kc_secret", return_value=VALID_SECRET),
        patch("api.routes.security_events.log_system_audit") as mock_audit,
    ):
        r = client.post(
            KC_EVENT_URL,
            json={
                "event_type": "LOGIN_ERROR",
                "username": "testuser",
                "error": "invalid_user_credentials",
            },
            headers={"Authorization": f"Bearer {VALID_SECRET}"},
        )

    assert r.status_code == 202
    data = r.json()
    assert data["action_type"] == "FAILED_LOGIN"
    mock_audit.assert_called_once()
    call_kwargs = mock_audit.call_args
    # action_type and result are positional (2nd and 3rd args after db)
    assert call_kwargs[0][2] == "FAILED_LOGIN"  # action_type
    assert call_kwargs[1].get("result") == "failure"
    nv = call_kwargs[1].get("new_values", {})
    assert nv.get("source") == "keycloak_spi"
    assert nv.get("username") == "testuser"


def test_user_id_is_always_none():
    """log_system_audit must receive user_id=None (no account-existence lookup)."""
    client, mock_db = _make_client()
    with (
        patch.object(security_events_module, "_get_kc_secret", return_value=VALID_SECRET),
        patch("api.routes.security_events.log_system_audit") as mock_audit,
    ):
        client.post(
            KC_EVENT_URL,
            json={"event_type": "UPDATE_PASSWORD", "username": "admin"},
            headers={"Authorization": f"Bearer {VALID_SECRET}"},
        )

    mock_audit.assert_called_once()
    # Second positional arg after db is user_id
    assert mock_audit.call_args[0][1] is None


def test_kc_event_unknown_event_type_returns_422():
    client, _ = _make_client()
    with patch.object(security_events_module, "_get_kc_secret", return_value=VALID_SECRET):
        r = client.post(
            KC_EVENT_URL,
            json={"event_type": "SOME_UNKNOWN_EVENT"},
            headers={"Authorization": f"Bearer {VALID_SECRET}"},
        )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# All four event type mappings
# ---------------------------------------------------------------------------

_EXPECTED_MAPPINGS = [
    ("LOGIN_ERROR", "FAILED_LOGIN", "failure"),
    ("USER_DISABLED_BY_PERMANENT_LOCKOUT", "FAILED_LOGIN", "failure"),
    ("UPDATE_PASSWORD", "PASSWORD_RESET", "success"),
    ("SEND_RESET_PASSWORD", "PASSWORD_RESET", "success"),
]


@pytest.mark.parametrize("kc_event,wims_action,expected_result", _EXPECTED_MAPPINGS)
def test_four_events_round_trip(kc_event: str, wims_action: str, expected_result: str):
    """Each Keycloak EventType maps to the correct WIMS action_type and result."""
    client, _ = _make_client()
    with (
        patch.object(security_events_module, "_get_kc_secret", return_value=VALID_SECRET),
        patch("api.routes.security_events.log_system_audit") as mock_audit,
    ):
        r = client.post(
            KC_EVENT_URL,
            json={"event_type": kc_event, "username": "u", "keycloak_event_id": "kc-id-1"},
            headers={"Authorization": f"Bearer {VALID_SECRET}"},
        )

    assert r.status_code == 202, f"Expected 202 for {kc_event}, got {r.status_code}"
    assert r.json()["action_type"] == wims_action
    mock_audit.assert_called_once()
    args, kwargs = mock_audit.call_args
    assert args[2] == wims_action
    assert kwargs.get("result") == expected_result
    nv = kwargs.get("new_values", {})
    assert nv.get("keycloak_event_id") == "kc-id-1"
