"""
Tests for email verification endpoints — issue #225.

POST /api/auth/change-email — Step 1: verify password, store pending email + code, send email
POST /api/auth/verify-email — Step 2: verify code, update email in Keycloak and DB

Uses mocks for Redis, Keycloak, and email sending; no live services required.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from keycloak.exceptions import KeycloakError

import auth
from auth import get_db_with_rls
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ── Helpers ──────────────────────────────────────────────────────────────────


def mock_analyst_user():
    return {
        "user_id": "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-analyst",
        "username": "analyst",
        "kc_username": "analyst@bfp.gov.ph",
        "role": "NATIONAL_ANALYST",
        "email": "analyst@bfp.gov.ph",
    }


def _get_db_session():
    db = MagicMock()
    db.execute.return_value.fetchone.return_value = ("09171234567", True, True)
    return db


def _async_redis_mock(with_data=None):
    """Return an AsyncMock that mimics aioredis.Redis for email verification."""
    r = AsyncMock()
    r.setex = AsyncMock()
    r.get = AsyncMock()
    r.delete = AsyncMock()
    r.ping = AsyncMock(return_value=True)
    if with_data:
        r.get.return_value = json.dumps(with_data)
    return r


# ── POST /api/auth/change-email ──────────────────────────────────────────────


class TestChangeEmail:
    def test_success_stores_code_and_sends_email(self, client: TestClient):
        """Happy path: password verified, code stored in Redis, email sent."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock()

        with (
            patch("api.routes.auth._verify_password", return_value="analyst@bfp.gov.ph"),
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.send_email_async") as mock_send,
        ):
            response = client.post(
                "/api/auth/change-email",
                json={"new_email": "new@bfp.gov.ph", "current_password": "CorrectPassword1!"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ok"
            assert "new@bfp.gov.ph" in data["message"]

            # Redis key was set
            mock_redis.setex.assert_called_once()
            redis_args = mock_redis.setex.call_args
            assert redis_args[0][0] == "email_verify:c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
            assert redis_args[0][1] == 600
            stored = json.loads(redis_args[0][2])
            assert stored["pending_email"] == "new@bfp.gov.ph"
            assert "code" in stored
            assert len(stored["code"]) == 6

            # Email was sent
            mock_send.assert_called_once()
            send_kwargs = mock_send.call_args.kwargs
            assert send_kwargs["to"] == "new@bfp.gov.ph"
            assert send_kwargs["template_name"] == "email_verification"

    def test_password_verified_against_keycloak(self, client: TestClient):
        """Password is verified before storing code or sending email."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock()

        with (
            patch(
                "api.routes.auth._verify_password", return_value="analyst@bfp.gov.ph"
            ) as mock_verify,
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.send_email_async"),
        ):
            client.post(
                "/api/auth/change-email",
                json={"new_email": "new@bfp.gov.ph", "current_password": "CorrectPassword1!"},
            )

            mock_verify.assert_called_once()

    def test_incorrect_password_returns_401(self, client: TestClient):
        """Wrong password returns 401 without touching Redis or email."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock()

        with (
            patch(
                "api.routes.auth._verify_password",
                side_effect=__import__("fastapi").HTTPException(
                    status_code=401, detail="Incorrect current password"
                ),
            ),
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.send_email_async") as mock_send,
        ):
            response = client.post(
                "/api/auth/change-email",
                json={"new_email": "new@bfp.gov.ph", "current_password": "WrongPassword1!"},
            )

            assert response.status_code == 401
            mock_send.assert_not_called()
            mock_redis.setex.assert_not_called()

    def test_missing_current_password_returns_400(self, client: TestClient):
        """Empty or whitespace current_password returns 400 before Redis/email."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock()

        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.send_email_async") as mock_send,
        ):
            response = client.post(
                "/api/auth/change-email",
                json={"new_email": "new@bfp.gov.ph", "current_password": ""},
            )

            assert response.status_code == 400
            assert "password" in response.json()["detail"].lower()
            mock_send.assert_not_called()

    def test_whitespace_only_password_returns_400(self, client: TestClient):
        """Whitespace-only current_password is treated as missing."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock()

        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.send_email_async") as mock_send,
        ):
            response = client.post(
                "/api/auth/change-email",
                json={"new_email": "new@bfp.gov.ph", "current_password": "   "},
            )

            assert response.status_code == 400
            mock_send.assert_not_called()

    def test_redis_unavailable_returns_503(self, client: TestClient):
        """When Redis is down, return 503 without attempting password verify or email."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.auth._get_redis", return_value=None),
            patch("api.routes.auth._verify_password") as mock_verify,
            patch("api.routes.auth.send_email_async") as mock_send,
        ):
            response = client.post(
                "/api/auth/change-email",
                json={"new_email": "new@bfp.gov.ph", "current_password": "CorrectPassword1!"},
            )

            assert response.status_code == 503
            assert "temporarily unavailable" in response.json()["detail"].lower()
            mock_verify.assert_not_called()
            mock_send.assert_not_called()

    def test_email_send_failure_cleans_redis_and_returns_502(self, client: TestClient):
        """When email sending fails, Redis key is cleaned and 502 returned."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock()

        with (
            patch("api.routes.auth._verify_password", return_value="analyst@bfp.gov.ph"),
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch(
                "api.routes.auth.send_email_async",
                side_effect=Exception("SMTP connection refused"),
            ),
        ):
            response = client.post(
                "/api/auth/change-email",
                json={"new_email": "new@bfp.gov.ph", "current_password": "CorrectPassword1!"},
            )

            assert response.status_code == 502
            assert "failed to send" in response.json()["detail"].lower()

            # Redis key must be cleaned up
            mock_redis.delete.assert_called_once_with(
                "email_verify:c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
            )

    def test_empty_new_email_rejected_by_pydantic(self, client: TestClient):
        """Empty new_email should be rejected at schema level (422)."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        response = client.post(
            "/api/auth/change-email",
            json={"new_email": "", "current_password": "CorrectPassword1!"},
        )

        assert response.status_code == 422

    def test_invalid_new_email_format_rejected(self, client: TestClient):
        """Invalid email format should be rejected at schema level (422)."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        response = client.post(
            "/api/auth/change-email",
            json={"new_email": "not-an-email", "current_password": "CorrectPassword1!"},
        )

        assert response.status_code == 422


# ── POST /api/auth/verify-email ──────────────────────────────────────────────


class TestVerifyEmail:
    def test_success_updates_keycloak_and_db(self, client: TestClient):
        """Happy path: code matches, Keycloak updated, DB synced, Redis cleaned."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock(
            with_data={"pending_email": "new@bfp.gov.ph", "code": "123456"}
        )

        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.update_user_profile") as mock_kc_update,
        ):
            response = client.post(
                "/api/auth/verify-email",
                json={"code": "123456"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ok"
            assert "new@bfp.gov.ph" in data["message"]

            # Keycloak was updated
            mock_kc_update.assert_called_once_with("kid-analyst", email="new@bfp.gov.ph")

            # DB was updated
            calls = mock_db.execute.call_args_list
            db_sqls = [str(c[0][0]) for c in calls]
            assert any("wims.users SET email" in s for s in db_sqls), (
                f"email update not in: {db_sqls}"
            )

            # Redis key was deleted
            mock_redis.delete.assert_called_once_with(
                "email_verify:c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
            )

    def test_missing_code_returns_400(self, client: TestClient):
        """Empty code returns 400 without touching Redis data."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock(
            with_data={"pending_email": "new@bfp.gov.ph", "code": "123456"}
        )

        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.update_user_profile") as mock_kc_update,
        ):
            response = client.post(
                "/api/auth/verify-email",
                json={"code": ""},
            )

            assert response.status_code == 400
            assert "required" in response.json()["detail"].lower()
            mock_kc_update.assert_not_called()

    def test_whitespace_only_code_returns_400(self, client: TestClient):
        """Whitespace-only code returns 400."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock()

        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.update_user_profile") as mock_kc_update,
        ):
            response = client.post(
                "/api/auth/verify-email",
                json={"code": "   "},
            )

            assert response.status_code == 400
            mock_kc_update.assert_not_called()

    def test_no_pending_change_returns_404(self, client: TestClient):
        """When Redis has no pending email change, return 404."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock()
        mock_redis.get.return_value = None  # No key in Redis

        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.update_user_profile") as mock_kc_update,
        ):
            response = client.post(
                "/api/auth/verify-email",
                json={"code": "123456"},
            )

            assert response.status_code == 404
            assert "no pending" in response.json()["detail"].lower()
            mock_kc_update.assert_not_called()

    def test_wrong_code_returns_400(self, client: TestClient):
        """Non-matching code returns 400, Redis key preserved for retry."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock(
            with_data={"pending_email": "new@bfp.gov.ph", "code": "999999"}
        )

        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.update_user_profile") as mock_kc_update,
        ):
            response = client.post(
                "/api/auth/verify-email",
                json={"code": "123456"},
            )

            assert response.status_code == 400
            assert "invalid" in response.json()["detail"].lower()
            mock_kc_update.assert_not_called()
            # Redis key should NOT be deleted on wrong code
            mock_redis.delete.assert_not_called()

    def test_redis_unavailable_returns_503(self, client: TestClient):
        """When Redis is down, return 503."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.auth._get_redis", return_value=None),
            patch("api.routes.auth.update_user_profile") as mock_kc_update,
        ):
            response = client.post(
                "/api/auth/verify-email",
                json={"code": "123456"},
            )

            assert response.status_code == 503
            assert "temporarily unavailable" in response.json()["detail"].lower()
            mock_kc_update.assert_not_called()

    def test_keycloak_update_failure_returns_502(self, client: TestClient):
        """Keycloak API failure returns 502, Redis key preserved for retry."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock(
            with_data={"pending_email": "new@bfp.gov.ph", "code": "123456"}
        )

        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch(
                "api.routes.auth.update_user_profile",
                side_effect=KeycloakError(error_message="keycloak down"),
            ),
        ):
            response = client.post(
                "/api/auth/verify-email",
                json={"code": "123456"},
            )

            assert response.status_code == 502
            assert "identity provider" in response.json()["detail"].lower()
            # Redis key should NOT be deleted on Keycloak failure
            mock_redis.delete.assert_not_called()

    def test_db_sync_failure_returns_partial(self, client: TestClient):
        """When DB sync fails after Keycloak success, return partial status."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        # Simulate DB connection lost during the update
        mock_db.execute.side_effect = Exception("DB connection lost")
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        mock_redis = _async_redis_mock(
            with_data={"pending_email": "new@bfp.gov.ph", "code": "123456"}
        )

        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.update_user_profile") as mock_kc_update,
        ):
            response = client.post(
                "/api/auth/verify-email",
                json={"code": "123456"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "partial"
            assert "database sync failed" in data["message"].lower()
            mock_kc_update.assert_called_once()

            # Redis key must still be cleaned up
            mock_redis.delete.assert_called_once()

    def test_empty_body_returns_422(self, client: TestClient):
        """Empty JSON body should be rejected at schema level (422)."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        response = client.post(
            "/api/auth/verify-email",
            json={},
        )

        assert response.status_code == 422
