"""
Tests for self-service profile update with email support — issues #28, #86.

Covers:
- PATCH /api/user/me — schema accepts email field
- PATCH /api/user/me — email included in update_user_profile call
- PATCH /api/user/me — email synced to DB
- GET  /api/user/me/profile — returns email
"""

import pytest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch
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


@contextmanager
def _verified_current_password(username="analyst@bfp.gov.ph"):
    with (
        patch("api.routes.user._get_admin_client") as mock_get_admin,
        patch("api.routes.user.KeycloakOpenID") as mock_keycloak_openid,
    ):
        admin = mock_get_admin.return_value
        admin.get_user.return_value = {"username": username}
        oidc = mock_keycloak_openid.return_value
        oidc.token.return_value = {"access_token": "verified"}
        yield mock_get_admin, mock_keycloak_openid, oidc


# ── ProfileUpdate schema tests ───────────────────────────────────────────────


class TestProfileEmailSchema:
    """Verify the ProfileUpdate schema accepts email."""

    def test_email_field_present(self):
        """ProfileUpdate schema should include an optional email field."""
        from api.routes.user import ProfileUpdate

        payload = ProfileUpdate(email="test@bfp.gov.ph")
        assert payload.email == "test@bfp.gov.ph"

    def test_email_field_none_by_default(self):
        """ProfileUpdate schema should default email to None."""
        from api.routes.user import ProfileUpdate

        payload = ProfileUpdate(first_name="Jane")
        assert payload.email is None
        assert payload.first_name == "Jane"

    def test_empty_body_no_fields(self):
        """Empty body should be valid (email, first_name, last_name, contact_number all None)."""
        from api.routes.user import ProfileUpdate

        payload = ProfileUpdate()
        assert payload.email is None
        assert payload.current_password is None
        assert payload.first_name is None
        assert payload.last_name is None
        assert payload.contact_number is None

    def test_email_rejects_invalid_format(self):
        """EmailStr should reject malformed email addresses."""
        from api.routes.user import ProfileUpdate
        from pydantic import ValidationError

        # Valid email should work
        payload = ProfileUpdate(email="valid@bfp.gov.ph")
        assert payload.email == "valid@bfp.gov.ph"

        # Invalid email should raise ValidationError
        with pytest.raises(ValidationError):
            ProfileUpdate(email="notanemail")

        with pytest.raises(ValidationError):
            ProfileUpdate(email="missing-domain@")

        # Blank/whitespace email should also be rejected by EmailStr
        with pytest.raises(ValidationError):
            ProfileUpdate(email="   ")

        with pytest.raises(ValidationError):
            ProfileUpdate(email="")

    def test_contact_number_matches_frontend_format(self):
        """Backend contact number validation should match frontend ^09\\d{9}$ regex."""
        from api.routes.user import ProfileUpdate
        from pydantic import ValidationError

        payload = ProfileUpdate(contact_number="09171234567")
        assert payload.contact_number == "09171234567"

        with pytest.raises(ValidationError):
            ProfileUpdate(contact_number="1234567")

        with pytest.raises(ValidationError):
            ProfileUpdate(contact_number="+639171234567")


# ── PATCH /api/user/me tests ─────────────────────────────────────────────────


class TestProfileUpdateWithEmail:
    def test_email_change_blocked_directs_to_verification_flow(self, client: TestClient):
        """Direct email change via PATCH /api/user/me is blocked — must use verification flow."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.user.update_user_profile") as mock_kc_update,
            patch("api.routes.user.logger"),
        ):
            response = client.patch(
                "/api/user/me",
                json={"email": "new@bfp.gov.ph", "current_password": "CorrectPassword1!"},
            )

            assert response.status_code == 400
            detail = response.json()["detail"]
            assert "change-email" in detail.lower()
            assert "verify-email" in detail.lower()
            # Password verification and Keycloak update must be skipped
            mock_kc_update.assert_not_called()

    def test_email_with_contact_number_blocked_by_verification_policy(self, client: TestClient):
        """Even when other fields are present, email changes are blocked for verification flow."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.user.update_user_profile") as mock_kc_update,
            patch("api.routes.user.logger"),
        ):
            response = client.patch(
                "/api/user/me",
                json={
                    "email": "new@bfp.gov.ph",
                    "current_password": "CorrectPassword1!",
                    "contact_number": "09181112233",
                },
            )

            assert response.status_code == 400
            detail = response.json()["detail"]
            assert "change-email" in detail.lower()
            # Neither Keycloak update nor DB sync should be triggered
            mock_kc_update.assert_not_called()
            # DB execute should not have been called for email
            calls = mock_db.execute.call_args_list
            db_sqls = [str(c[0][0]) for c in calls]
            assert not any("email" in s for s in db_sqls), (
                f"email should not be in DB calls: {db_sqls}"
            )

    def test_email_only_change_blocked_redirects_to_verification(self, client: TestClient):
        """Updating only email is blocked — route directs to verification endpoints."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.user.update_user_profile") as mock_kc_update,
            patch("api.routes.user.logger"),
        ):
            response = client.patch(
                "/api/user/me",
                json={
                    "email": "analyst-updated@bfp.gov.ph",
                    "current_password": "CorrectPassword1!",
                },
            )

            assert response.status_code == 400
            detail = response.json()["detail"]
            assert "change-email" in detail.lower()
            mock_kc_update.assert_not_called()

    def test_get_profile_includes_email(self, client: TestClient):
        """GET /api/user/me/profile should include email in response."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user

        with patch("api.routes.user.get_user_profile") as mock_get_kc:
            mock_get_kc.return_value = {
                "first_name": "Ana",
                "last_name": "Lyst",
                "email": "analyst@bfp.gov.ph",
            }
            mock_db = _get_db_session()
            app.dependency_overrides[get_db_with_rls] = lambda: mock_db

            response = client.get("/api/user/me/profile")

            assert response.status_code == 200
            data = response.json()
            assert data.get("email") == "analyst@bfp.gov.ph"

    def test_get_profile_falls_back_to_context_email(self, client: TestClient):
        """If Keycloak profile has no email, fall back to user context email."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user

        with patch("api.routes.user.get_user_profile") as mock_get_kc:
            mock_get_kc.return_value = {
                "first_name": "Ana",
                "last_name": "Lyst",
            }
            mock_db = _get_db_session()
            app.dependency_overrides[get_db_with_rls] = lambda: mock_db

            response = client.get("/api/user/me/profile")

            assert response.status_code == 200
            data = response.json()
            assert data.get("email") == "analyst@bfp.gov.ph"

    def test_email_change_blocked_even_without_password(self, client: TestClient):
        """Email change is blocked even when current_password is omitted — verification required."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with patch("api.routes.user.update_user_profile") as mock_kc_update:
            response = client.patch("/api/user/me", json={"email": "new@bfp.gov.ph"})

            assert response.status_code == 400
            detail = response.json()["detail"]
            assert "change-email" in detail.lower()
            assert "verify-email" in detail.lower()
            mock_kc_update.assert_not_called()

    def test_email_change_blocked_before_password_verification(self, client: TestClient):
        """Email change is blocked at the route level before any password check occurs."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.user.update_user_profile") as mock_kc_update,
            patch("api.routes.user.logger"),
        ):
            response = client.patch(
                "/api/user/me",
                json={"email": "new@bfp.gov.ph", "current_password": "WrongPassword1!"},
            )

            # Blocked at 400 (email changes require verification flow),
            # not 401 (password not checked at all)
            assert response.status_code == 400
            detail = response.json()["detail"]
            assert "change-email" in detail.lower()
            mock_kc_update.assert_not_called()

    def test_update_profile_keycloak_failure_returns_502(self, client: TestClient):
        """Keycloak profile update errors should return 502."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.user.update_user_profile") as mock_kc_update,
            patch("api.routes.user.logger"),
        ):
            mock_kc_update.side_effect = KeycloakError(error_message="keycloak down")
            response = client.patch("/api/user/me", json={"first_name": "Ana"})

            assert response.status_code == 502
            assert "identity provider" in response.json()["detail"].lower()

    def test_update_profile_empty_body_returns_400(self, client: TestClient):
        """Route-level empty PATCH body should return 400 No fields to update."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        response = client.patch("/api/user/me", json={})

        assert response.status_code == 400
        assert response.json()["detail"] == "No fields to update"

    def test_update_profile_empty_email_string_is_rejected(self, client: TestClient):
        """Route-level empty string email should be rejected by EmailStr validation."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        response = client.patch(
            "/api/user/me",
            json={"email": "", "current_password": "CorrectPassword1!"},
        )

        assert response.status_code == 422

    def test_email_change_db_issue_irrelevant_email_blocked_first(self, client: TestClient):
        """Route-level email block fires before DB is touched, so DB failures are irrelevant."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        mock_db.execute.side_effect = Exception("DB connection lost")
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.user.update_user_profile") as mock_kc_update,
            patch("api.routes.user.logger"),
        ):
            response = client.patch(
                "/api/user/me",
                json={"email": "new@bfp.gov.ph", "current_password": "CorrectPassword1!"},
            )

            # Email changes are blocked with 400 regardless of DB state
            assert response.status_code == 400
            detail = response.json()["detail"]
            assert "change-email" in detail.lower()
            mock_kc_update.assert_not_called()


class TestKeycloakProfileUpdate:
    def test_contact_number_update_merges_existing_attributes(self):
        """Updating contact_number must not replace unrelated Keycloak attributes."""
        from services.keycloak_admin import update_user_profile

        with patch("services.keycloak_admin._get_admin_client") as mock_get_admin:
            admin = mock_get_admin.return_value
            admin.get_user.return_value = {
                "attributes": {
                    "station_id": ["42"],
                    "mfa_enrolled": ["true"],
                }
            }

            update_user_profile("kid-analyst", contact_number="09171234567")

            admin.update_user.assert_called_once()
            payload = admin.update_user.call_args.kwargs["payload"]
            assert payload["attributes"] == {
                "station_id": ["42"],
                "mfa_enrolled": ["true"],
                "contact_number": ["09171234567"],
            }
