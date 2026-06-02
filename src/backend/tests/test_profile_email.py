"""
Tests for self-service profile update with email support — issues #28, #86.

Covers:
- PATCH /api/user/me — schema accepts email field
- PATCH /api/user/me — email included in update_user_profile call
- PATCH /api/user/me — email synced to DB
- GET  /api/user/me/profile — returns email
"""

import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

import auth
from database import get_db_with_rls, get_db
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
        "role": "NATIONAL_ANALYST",
        "email": "analyst@bfp.gov.ph",
    }


def _get_db_session():
    db = MagicMock()
    db.execute.return_value.fetchone.return_value = ("09171234567",)
    return db


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


# ── PATCH /api/user/me tests ─────────────────────────────────────────────────


class TestProfileUpdateWithEmail:
    def test_update_email_calls_keycloak(self, client: TestClient):
        """Email should be passed through to update_user_profile."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.user.update_user_profile") as mock_kc_update,
            patch("api.routes.user.logger"),
        ):
            mock_kc_update.return_value = None
            response = client.patch("/api/user/me", json={"email": "new@bfp.gov.ph"})

            assert response.status_code == 200
            mock_kc_update.assert_called_once()
            call_kwargs = mock_kc_update.call_args.kwargs
            assert call_kwargs.get("email") == "new@bfp.gov.ph"

    def test_update_email_syncs_to_db(self, client: TestClient):
        """Email should be written to wims.users along with contact_number."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.user.update_user_profile") as mock_kc_update,
            patch("api.routes.user.logger"),
        ):
            mock_kc_update.return_value = None
            response = client.patch(
                "/api/user/me",
                json={"email": "new@bfp.gov.ph", "contact_number": "09181112233"},
            )

            assert response.status_code == 200
            # DB execute calls are independent per field — contact_number first, then email
            calls = mock_db.execute.call_args_list
            db_sqls = [str(c[0][0]) for c in calls]
            assert any("contact_number" in s for s in db_sqls), f"contact_number not in: {db_sqls}"
            assert any("email" in s for s in db_sqls), f"email not in: {db_sqls}"

    def test_update_email_without_other_fields(self, client: TestClient):
        """Updating only email should work."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.user.update_user_profile") as mock_kc_update,
            patch("api.routes.user.logger"),
        ):
            mock_kc_update.return_value = None
            response = client.patch("/api/user/me", json={"email": "analyst-updated@bfp.gov.ph"})

            assert response.status_code == 200
            assert mock_kc_update.call_args.kwargs.get("email") == "analyst-updated@bfp.gov.ph"

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
            app.dependency_overrides[get_db] = lambda: mock_db

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
            app.dependency_overrides[get_db] = lambda: mock_db

            response = client.get("/api/user/me/profile")

            assert response.status_code == 200
            data = response.json()
            assert data.get("email") == "analyst@bfp.gov.ph"

    def test_update_email_db_sync_failure_returns_partial(self, client: TestClient):
        """When DB sync fails after Keycloak update, return partial status."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_analyst_user
        mock_db = _get_db_session()
        mock_db.execute.side_effect = Exception("DB connection lost")
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.user.update_user_profile") as mock_kc_update,
            patch("api.routes.user.logger"),
        ):
            mock_kc_update.return_value = None
            response = client.patch(
                "/api/user/me",
                json={"email": "new@bfp.gov.ph"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "partial"
            assert "database sync failed" in data["message"].lower()
