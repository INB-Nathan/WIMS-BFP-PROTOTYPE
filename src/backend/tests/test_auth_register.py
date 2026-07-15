"""
Tests for civilian self-service registration — POST /api/auth/register.

Issue #593.

Schema-level unit tests validate password strength, email format, and
contact number pattern without any service dependencies.

Endpoint tests use mocks for Turnstile, Keycloak admin, Redis, and DB
so no external services are required.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import json
import pytest
from urllib.parse import quote
from fastapi.testclient import TestClient
from keycloak.exceptions import KeycloakError
from pydantic import ValidationError

import api.routes.auth as auth_routes
from database import get_db
from schemas.auth import (
    CivilianRegisterRequest,
    RegisterResponse,
)
from main import app


# ═══════════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════════


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    auth_routes._redis = None
    yield
    app.dependency_overrides.clear()
    auth_routes._redis = None


@pytest.fixture
def valid_payload():
    """A valid registration payload for happy-path tests."""
    return {
        "email": "test@example.com",
        "first_name": "Juan",
        "last_name": "Dela Cruz",
        "password": "StrongPass1",
        "contact_number": "09171234567",
        "dpa_consent": True,
        "turnstile_token": "valid-turnstile-token",
    }


@pytest.fixture
def mock_redis():
    """Return an AsyncMock that mimics aioredis.Redis for registration."""
    r = AsyncMock()
    r.setex = AsyncMock()
    r.get = AsyncMock()
    r.delete = AsyncMock()
    r.ping = AsyncMock(return_value=True)
    r.incr = AsyncMock(return_value=1)
    r.ttl = AsyncMock(return_value=300)
    r.expire = AsyncMock()
    return r


@pytest.fixture
def mock_keycloak_admin():
    """Return a MagicMock KeycloakAdmin with default returns."""
    adm = MagicMock(name="KeycloakAdmin")
    adm.create_user.return_value = "user-uuid-reg-001"
    adm.set_user_password.return_value = None
    adm.send_update_account.return_value = None
    adm.get_realm_role.return_value = {"id": "role-id", "name": "CIVILIAN_REPORTER"}
    adm.assign_realm_roles.return_value = None
    adm.get_users.return_value = []
    adm.delete_user.return_value = None
    return adm


@pytest.fixture
def mock_db():
    db = MagicMock(name="db_session")
    db.execute.return_value = MagicMock()
    # First execute() call in register() uses RETURNING user_id + fetchone()
    mock_result = MagicMock()
    mock_result.user_id = "00000000-0000-0000-0000-000000000001"
    db.execute.return_value.fetchone.return_value = mock_result
    return db


# ═══════════════════════════════════════════════════════════════════════════
# Schema unit tests
# ═══════════════════════════════════════════════════════════════════════════


class TestCivilianRegisterRequestSchema:
    def test_valid_request(self):
        data = CivilianRegisterRequest(
            email="test@example.com",
            first_name="Juan",
            last_name="Dela Cruz",
            password="StrongPass1",
            contact_number="09171234567",
            dpa_consent=True,
            turnstile_token="abc123",
        )
        assert data.email == "test@example.com"
        assert data.password == "StrongPass1"

    def test_invalid_email_format(self):
        with pytest.raises(ValidationError):
            CivilianRegisterRequest(
                email="not-an-email",
                first_name="Juan",
                last_name="Dela Cruz",
                password="StrongPass1",
                contact_number="09171234567",
                dpa_consent=True,
                turnstile_token="abc123",
            )

    def test_password_too_short(self):
        with pytest.raises(ValidationError, match="String should have at least 8"):
            CivilianRegisterRequest(
                email="test@example.com",
                first_name="Juan",
                last_name="Dela Cruz",
                password="Short1",
                contact_number="09171234567",
                dpa_consent=True,
                turnstile_token="abc123",
            )

    def test_password_no_uppercase(self):
        with pytest.raises(ValidationError, match="Password must be at least 8"):
            CivilianRegisterRequest(
                email="test@example.com",
                first_name="Juan",
                last_name="Dela Cruz",
                password="lowercase1",
                contact_number="09171234567",
                dpa_consent=True,
                turnstile_token="abc123",
            )

    def test_password_no_digit(self):
        with pytest.raises(ValidationError, match="Password must be at least 8"):
            CivilianRegisterRequest(
                email="test@example.com",
                first_name="Juan",
                last_name="Dela Cruz",
                password="NoDigitsHere",
                contact_number="09171234567",
                dpa_consent=True,
                turnstile_token="abc123",
            )

    def test_password_no_lowercase(self):
        with pytest.raises(ValidationError, match="Password must be at least 8"):
            CivilianRegisterRequest(
                email="test@example.com",
                first_name="Juan",
                last_name="Dela Cruz",
                password="NOLOWERCASE1",
                contact_number="09171234567",
                dpa_consent=True,
                turnstile_token="abc123",
            )

    def test_invalid_contact_wrong_prefix(self):
        with pytest.raises(ValidationError, match="Contact number must be a valid"):
            CivilianRegisterRequest(
                email="test@example.com",
                first_name="Juan",
                last_name="Dela Cruz",
                password="StrongPass1",
                contact_number="08171234567",
                dpa_consent=True,
                turnstile_token="abc123",
            )

    def test_international_contact_no_leading_zero(self):
        with pytest.raises(ValidationError, match="Contact number must be a valid"):
            CivilianRegisterRequest(
                email="test@example.com",
                first_name="Juan",
                last_name="Dela Cruz",
                password="StrongPass1",
                contact_number="63917123456",
                dpa_consent=True,
                turnstile_token="abc123",
            )

    def test_contact_number_too_long(self):
        with pytest.raises(ValidationError):
            CivilianRegisterRequest(
                email="test@example.com",
                first_name="Juan",
                last_name="Dela Cruz",
                password="StrongPass1",
                contact_number="091712345678",
                dpa_consent=True,
                turnstile_token="abc123",
            )

    def test_missing_turnstile_token(self):
        with pytest.raises(ValidationError):
            CivilianRegisterRequest(
                email="test@example.com",
                first_name="Juan",
                last_name="Dela Cruz",
                password="StrongPass1",
                contact_number="09171234567",
                dpa_consent=True,
                turnstile_token="",
            )


class TestRegisterResponse:
    def test_valid_response(self):
        resp = RegisterResponse(
            status="ok",
            message="Verification email sent",
            email="test@example.com",
        )
        assert resp.status == "ok"
        assert resp.email == "test@example.com"
        assert resp.user_id is None


# ═══════════════════════════════════════════════════════════════════════════
# Endpoint tests — POST /api/auth/register
# ═══════════════════════════════════════════════════════════════════════════


def _kc_patches(mock_adm):
    """Return both patches for _get_admin_client.

    ``api.routes.auth`` imports ``_get_admin_client`` from ``services.keycloak_admin``,
    so a patch on only one module does NOT affect the other's reference.
    """
    return [
        patch("api.routes.auth._get_admin_client", return_value=mock_adm),
        patch("services.keycloak_admin._get_admin_client", return_value=mock_adm),
    ]


class TestRegisterEndpoint:
    """Integration tests for POST /api/auth/register with all mocks."""

    def test_success_with_dpa_consent(
        self, client: TestClient, valid_payload, mock_redis, mock_keycloak_admin, mock_db
    ):
        app.dependency_overrides[get_db] = lambda: mock_db
        kc_p1, kc_p2 = _kc_patches(mock_keycloak_admin)
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.verify_turnstile", return_value=True),
            patch("api.routes.auth.send_email_async") as mock_send,
            kc_p1,
            kc_p2,
        ):
            response = client.post("/api/auth/register", json=valid_payload)
        assert response.status_code == 201, response.json()
        data = response.json()
        assert data["status"] == "ok"
        assert data["email"] == "test@example.com"
        assert "Verification email sent" in data["message"]
        # Verify-first: no DB record created at registration time.
        mock_db.execute.assert_not_called()
        # Keycloak user created disabled + email unverified.
        create_payload = mock_keycloak_admin.create_user.call_args[0][0]
        assert create_payload["enabled"] is False
        assert create_payload["emailVerified"] is False
        mock_keycloak_admin.set_user_password.assert_called_once_with(
            user_id="user-uuid-reg-001",
            password="StrongPass1",
            temporary=False,
        )
        mock_keycloak_admin.assign_realm_roles.assert_called_once()
        # Verification code stored in Redis and email sent.
        mock_redis.setex.assert_called_once()
        args, kwargs = mock_redis.setex.call_args
        assert args[0] == "reg_verify:test@example.com"
        assert args[1] == 600
        mock_send.assert_called_once()
        assert mock_send.call_args.kwargs["template_name"] == "email_verification"
        assert mock_send.call_args.kwargs["context"]["code"]
        assert mock_send.call_args.kwargs["context"]["pending_email"] == "test@example.com"
        # The email must link the user into the verify page with code + email.
        verify_url = mock_send.call_args.kwargs["context"]["verify_url"]
        assert verify_url.startswith("https://wimsbfp.tech/verify?code=")
        assert f"&email={quote('test@example.com')}" in verify_url

    def test_success_without_dpa_consent(
        self, client: TestClient, valid_payload, mock_redis, mock_keycloak_admin, mock_db
    ):
        app.dependency_overrides[get_db] = lambda: mock_db
        kc_p1, kc_p2 = _kc_patches(mock_keycloak_admin)
        payload = {**valid_payload, "dpa_consent": False}
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.verify_turnstile", return_value=True),
            patch("api.routes.auth.send_email_async"),
            kc_p1,
            kc_p2,
        ):
            response = client.post("/api/auth/register", json=payload)
        assert response.status_code == 201, response.json()
        assert response.json()["status"] == "ok"
        assert response.json()["email"] == "test@example.com"

    def test_rate_limit_exceeded_returns_429(
        self, client: TestClient, valid_payload, mock_redis, mock_db
    ):
        app.dependency_overrides[get_db] = lambda: mock_db
        mock_redis.incr = AsyncMock(return_value=4)
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.verify_turnstile") as mock_turnstile,
        ):
            response = client.post("/api/auth/register", json=valid_payload)
        assert response.status_code == 429
        mock_turnstile.assert_not_called()

    def test_turnstile_failure_returns_429(
        self, client: TestClient, valid_payload, mock_redis, mock_db
    ):
        app.dependency_overrides[get_db] = lambda: mock_db
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch(
                "api.routes.auth.verify_turnstile",
                side_effect=__import__("fastapi").HTTPException(
                    status_code=429, detail="CAPTCHA verification failed"
                ),
            ),
        ):
            response = client.post("/api/auth/register", json=valid_payload)
        assert response.status_code == 429

    def test_duplicate_email_returns_409(
        self, client: TestClient, valid_payload, mock_redis, mock_keycloak_admin, mock_db
    ):
        app.dependency_overrides[get_db] = lambda: mock_db
        mock_keycloak_admin.get_users.return_value = [{"id": "existing-user-id"}]
        kc_p1, kc_p2 = _kc_patches(mock_keycloak_admin)
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.verify_turnstile", return_value=True),
            kc_p1,
            kc_p2,
        ):
            response = client.post("/api/auth/register", json=valid_payload)
        assert response.status_code == 409
        assert "already exists" in response.json()["detail"].lower()
        mock_keycloak_admin.create_user.assert_not_called()

    def test_redis_unavailable_returns_503_and_cleans_up(
        self, client: TestClient, valid_payload, mock_keycloak_admin, mock_db
    ):
        # Redis is required to store the verification code; without it the
        # disabled Keycloak user must be rolled back to avoid an orphan.
        app.dependency_overrides[get_db] = lambda: mock_db
        kc_p1, kc_p2 = _kc_patches(mock_keycloak_admin)
        with (
            patch("api.routes.auth._get_redis", return_value=None),
            patch("api.routes.auth.verify_turnstile", return_value=True),
            kc_p1,
            kc_p2,
        ):
            response = client.post("/api/auth/register", json=valid_payload)
        assert response.status_code == 503
        mock_keycloak_admin.create_user.assert_called_once()
        mock_keycloak_admin.delete_user.assert_called_once()

    def test_email_send_failure_cleans_up_keycloak(
        self, client: TestClient, valid_payload, mock_redis, mock_keycloak_admin, mock_db
    ):
        app.dependency_overrides[get_db] = lambda: mock_db
        kc_p1, kc_p2 = _kc_patches(mock_keycloak_admin)
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.verify_turnstile", return_value=True),
            patch(
                "api.routes.auth.send_email_async",
                side_effect=RuntimeError("smtp down"),
            ),
            kc_p1,
            kc_p2,
        ):
            response = client.post("/api/auth/register", json=valid_payload)
        assert response.status_code == 502
        # Redis key and disabled Keycloak user both cleaned up.
        mock_redis.delete.assert_called_once_with("reg_verify:test@example.com")
        mock_keycloak_admin.delete_user.assert_called_once()

    def test_keycloak_creation_failure_returns_502(
        self, client: TestClient, valid_payload, mock_redis, mock_keycloak_admin, mock_db
    ):
        app.dependency_overrides[get_db] = lambda: mock_db
        mock_keycloak_admin.create_user.side_effect = KeycloakError(error_message="kc down")
        kc_p1, kc_p2 = _kc_patches(mock_keycloak_admin)
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.verify_turnstile", return_value=True),
            kc_p1,
            kc_p2,
        ):
            response = client.post("/api/auth/register", json=valid_payload)
        assert response.status_code == 502


class TestVerifyRegistrationEndpoint:
    """Integration tests for POST /api/auth/verify-registration with all mocks."""

    def _redis_payload(self, **overrides):
        payload = {
            "code": "123456",
            "contact_number": "09171234567",
            "dpa_consent": True,
        }
        payload.update(overrides)
        return payload

    def test_success_enables_user_and_inserts_db(
        self, client: TestClient, mock_redis, mock_keycloak_admin, mock_db
    ):
        app.dependency_overrides[get_db] = lambda: mock_db
        mock_redis.get.return_value = json.dumps(self._redis_payload())
        # The disabled Keycloak user created during /register.
        mock_keycloak_admin.get_users.return_value = [{"id": "user-uuid-reg-001"}]
        kc_p1, kc_p2 = _kc_patches(mock_keycloak_admin)
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.set_user_enabled") as mock_enable,
            kc_p1,
            kc_p2,
        ):
            response = client.post(
                "/api/auth/verify-registration",
                json={"email": "test@example.com", "code": "123456"},
            )
        assert response.status_code == 200, response.json()
        data = response.json()
        assert data["status"] == "ok"
        assert "verified" in data["message"].lower()
        # Keycloak user enabled + email marked verified.
        mock_enable.assert_called_once_with("user-uuid-reg-001", enabled=True, email_verified=True)
        # DB inserts: wims.users, wims.civilian_contributors, DPA audit.
        assert mock_db.execute.call_count >= 2
        # Redis key deleted after success.
        mock_redis.delete.assert_called_with("reg_verify:test@example.com")

    def test_wrong_code_returns_400(
        self, client: TestClient, mock_redis, mock_keycloak_admin, mock_db
    ):
        app.dependency_overrides[get_db] = lambda: mock_db
        mock_redis.get.return_value = json.dumps(self._redis_payload())
        kc_p1, kc_p2 = _kc_patches(mock_keycloak_admin)
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.set_user_enabled") as mock_enable,
            kc_p1,
            kc_p2,
        ):
            response = client.post(
                "/api/auth/verify-registration",
                json={"email": "test@example.com", "code": "000000"},
            )
        assert response.status_code == 400
        mock_enable.assert_not_called()

    def test_rate_limit_exceeded_returns_429(
        self, client: TestClient, mock_redis, mock_keycloak_admin, mock_db
    ):
        app.dependency_overrides[get_db] = lambda: mock_db
        mock_redis.get.return_value = json.dumps(self._redis_payload())
        mock_redis.incr = AsyncMock(return_value=6)
        kc_p1, kc_p2 = _kc_patches(mock_keycloak_admin)
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.set_user_enabled") as mock_enable,
            kc_p1,
            kc_p2,
        ):
            response = client.post(
                "/api/auth/verify-registration",
                json={"email": "test@example.com", "code": "123456"},
            )
        assert response.status_code == 429
        mock_enable.assert_not_called()

    def test_missing_redis_key_returns_404(
        self, client: TestClient, mock_redis, mock_keycloak_admin, mock_db
    ):
        app.dependency_overrides[get_db] = lambda: mock_db
        mock_redis.get.return_value = None
        kc_p1, kc_p2 = _kc_patches(mock_keycloak_admin)
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.set_user_enabled") as mock_enable,
            kc_p1,
            kc_p2,
        ):
            response = client.post(
                "/api/auth/verify-registration",
                json={"email": "test@example.com", "code": "123456"},
            )
        assert response.status_code == 404
        mock_enable.assert_not_called()

    def test_db_insert_failure_cleans_up_keycloak(
        self, client: TestClient, mock_redis, mock_keycloak_admin, mock_db
    ):
        mock_redis.get.return_value = json.dumps(self._redis_payload())
        # The disabled Keycloak user created during /register.
        mock_keycloak_admin.get_users.return_value = [{"id": "user-uuid-reg-001"}]
        db_fail = MagicMock(name="db_session")
        db_fail.execute.side_effect = Exception("DB constraint violation")
        app.dependency_overrides[get_db] = lambda: db_fail
        kc_p1, kc_p2 = _kc_patches(mock_keycloak_admin)
        with (
            patch("api.routes.auth._get_redis", return_value=mock_redis),
            patch("api.routes.auth.set_user_enabled"),
            kc_p1,
            kc_p2,
        ):
            response = client.post(
                "/api/auth/verify-registration",
                json={"email": "test@example.com", "code": "123456"},
            )
        assert response.status_code == 502
        mock_keycloak_admin.delete_user.assert_called_once()

    def test_invalid_email_returns_422(self, client: TestClient, valid_payload, mock_db):
        app.dependency_overrides[get_db] = lambda: mock_db
        payload = {**valid_payload, "email": "not-an-email"}
        response = client.post("/api/auth/register", json=payload)
        assert response.status_code == 422

    def test_weak_password_returns_422(self, client: TestClient, valid_payload, mock_db):
        app.dependency_overrides[get_db] = lambda: mock_db
        payload = {**valid_payload, "password": "weak"}
        response = client.post("/api/auth/register", json=payload)
        assert response.status_code == 422

    def test_invalid_contact_returns_422(self, client: TestClient, valid_payload, mock_db):
        app.dependency_overrides[get_db] = lambda: mock_db
        payload = {**valid_payload, "contact_number": "12345"}
        response = client.post("/api/auth/register", json=payload)
        assert response.status_code == 422

    def test_empty_body_returns_422(self, client: TestClient, mock_db):
        app.dependency_overrides[get_db] = lambda: mock_db
        response = client.post("/api/auth/register", json={})
        assert response.status_code == 422
