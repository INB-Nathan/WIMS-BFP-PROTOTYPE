"""
Issue #526 — admin user onboarding must never expose a plaintext password.

Keycloak already emails a set-password link on user creation
(create_keycloak_user -> send_update_account). These tests assert:
  - POST /api/admin/users never returns temporary_password/note, and
    surfaces email_sent (both True and False paths).
  - POST /api/admin/users/{keycloak_id}/resend-credentials resends the
    same Keycloak email and is admin-gated.
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import auth
from database import get_db
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def mock_admin_user():
    return {
        "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-admin",
        "username": "admin",
        "role": "SYSTEM_ADMIN",
    }


def mock_encoder_user():
    return {
        "user_id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-encoder",
        "username": "encoder",
        "role": "REGIONAL_ENCODER",
    }


def _new_user_payload():
    return {
        "email": "newuser@bfp.gov.ph",
        "first_name": "New",
        "last_name": "User",
        "role": "REGIONAL_ENCODER",
        "username": "newuser",
    }


class TestCreateUserNeverExposesPassword:
    def test_response_has_no_password_and_email_sent_true(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        app.dependency_overrides[get_db] = lambda: MagicMock()

        with (
            patch(
                "api.routes.admin.users.create_keycloak_user",
                return_value=("kc-uuid-1", True),
            ),
            patch("api.routes.admin.users.log_system_audit"),
        ):
            response = client.post("/api/admin/users", json=_new_user_payload())

        assert response.status_code == 201
        body = response.json()
        assert "temporary_password" not in body
        assert "note" not in body
        assert body["email_sent"] is True
        assert body["email"] == "newuser@bfp.gov.ph"
        assert body["keycloak_id"] == "kc-uuid-1"
        assert body["username"] == "newuser"

    def test_response_email_sent_false_still_no_password(self, client: TestClient):
        """Keycloak email dispatch failed — response must surface email_sent=False,
        never fall back to a plaintext password."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        app.dependency_overrides[get_db] = lambda: MagicMock()

        with (
            patch(
                "api.routes.admin.users.create_keycloak_user",
                return_value=("kc-uuid-2", False),
            ),
            patch("api.routes.admin.users.log_system_audit"),
        ):
            response = client.post("/api/admin/users", json=_new_user_payload())

        assert response.status_code == 201
        body = response.json()
        assert "temporary_password" not in body
        assert "note" not in body
        assert body["email_sent"] is False

    def test_requires_system_admin(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user

        response = client.post("/api/admin/users", json=_new_user_payload())

        assert response.status_code == 403


class TestResendCredentials:
    def test_resend_returns_email_sent_true(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        with patch(
            "api.routes.admin.users.resend_update_account_email",
            return_value=True,
        ) as mock_resend:
            response = client.post("/api/admin/users/kc-uuid-1/resend-credentials")

        assert response.status_code == 200
        assert response.json() == {"email_sent": True}
        mock_resend.assert_called_once_with("kc-uuid-1")

    def test_resend_returns_email_sent_false_on_failure(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        with patch(
            "api.routes.admin.users.resend_update_account_email",
            return_value=False,
        ):
            response = client.post("/api/admin/users/kc-uuid-1/resend-credentials")

        assert response.status_code == 200
        assert response.json() == {"email_sent": False}

    def test_resend_requires_system_admin(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user

        response = client.post("/api/admin/users/kc-uuid-1/resend-credentials")

        assert response.status_code == 403
