"""Tests for user notification preferences (#72):
- GET /api/user/me/profile returns email_opt_in and push_opt_in
- PATCH /api/user/me updates email_opt_in and push_opt_in in DB
- Keycloak is not called when only preference fields are patched
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import auth
from auth import get_db_with_rls
from main import app


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def _mock_user():
    return {
        "user_id": "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-analyst",
        "username": "analyst",
        "kc_username": "analyst@bfp.gov.ph",
        "role": "NATIONAL_ANALYST",
        "email": "analyst@bfp.gov.ph",
    }


def _db_with_prefs(email_opt_in: bool = True, push_opt_in: bool = True):
    """Mock DB session whose fetchone returns contact_number + both prefs."""
    db = MagicMock()
    db.execute.return_value.fetchone.return_value = ("09171234567", email_opt_in, push_opt_in)
    return db


# =============================================================================
# GET /api/user/me/profile — returns prefs
# =============================================================================


class TestGetProfileReturnsPrefs:
    def test_returns_email_opt_in_true(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user
        mock_db = _db_with_prefs(email_opt_in=True, push_opt_in=True)
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with patch("api.routes.user.get_user_profile") as mock_kc:
            mock_kc.return_value = {
                "first_name": "Ana",
                "last_name": "Lyst",
                "email": "analyst@bfp.gov.ph",
            }
            response = client.get("/api/user/me/profile")

        assert response.status_code == 200
        data = response.json()
        assert data["email_opt_in"] is True
        assert data["push_opt_in"] is True

    def test_returns_email_opt_in_false(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user
        mock_db = _db_with_prefs(email_opt_in=False, push_opt_in=True)
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with patch("api.routes.user.get_user_profile") as mock_kc:
            mock_kc.return_value = {
                "first_name": "Ana",
                "last_name": "Lyst",
                "email": "analyst@bfp.gov.ph",
            }
            response = client.get("/api/user/me/profile")

        assert response.status_code == 200
        data = response.json()
        assert data["email_opt_in"] is False
        assert data["push_opt_in"] is True

    def test_defaults_to_true_when_null(self, client: TestClient):
        """Rows without prefs (None) should default to True."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user
        db = MagicMock()
        db.execute.return_value.fetchone.return_value = ("09171234567", None, None)
        app.dependency_overrides[get_db_with_rls] = lambda: db

        with patch("api.routes.user.get_user_profile") as mock_kc:
            mock_kc.return_value = {
                "first_name": "Ana",
                "last_name": "Lyst",
                "email": "analyst@bfp.gov.ph",
            }
            response = client.get("/api/user/me/profile")

        assert response.status_code == 200
        data = response.json()
        assert data["email_opt_in"] is True
        assert data["push_opt_in"] is True


# =============================================================================
# PATCH /api/user/me — persists prefs
# =============================================================================


class TestPatchProfileUpdatesPrefs:
    def test_patch_email_opt_in_false_updates_db(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user
        mock_db = _db_with_prefs()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with patch("api.routes.user.update_user_profile"), patch("api.routes.user.logger"):
            response = client.patch("/api/user/me", json={"email_opt_in": False})

        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        sql_calls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("email_opt_in" in s for s in sql_calls), (
            f"email_opt_in not in DB calls: {sql_calls}"
        )

    def test_patch_push_opt_in_false_updates_db(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user
        mock_db = _db_with_prefs()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with patch("api.routes.user.update_user_profile"), patch("api.routes.user.logger"):
            response = client.patch("/api/user/me", json={"push_opt_in": False})

        assert response.status_code == 200
        sql_calls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("push_opt_in" in s for s in sql_calls), (
            f"push_opt_in not in DB calls: {sql_calls}"
        )

    def test_patch_both_prefs_in_single_call(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user
        mock_db = _db_with_prefs()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with patch("api.routes.user.update_user_profile"), patch("api.routes.user.logger"):
            response = client.patch(
                "/api/user/me", json={"email_opt_in": False, "push_opt_in": False}
            )

        assert response.status_code == 200
        sql_calls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("email_opt_in" in s and "push_opt_in" in s for s in sql_calls), (
            f"Combined update not found in: {sql_calls}"
        )

    def test_patch_only_prefs_no_keycloak_call(self, client: TestClient):
        """Updating prefs-only should not call Keycloak at all."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user
        mock_db = _db_with_prefs()
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db

        with (
            patch("api.routes.user.update_user_profile") as mock_kc,
            patch("api.routes.user.logger"),
        ):
            response = client.patch("/api/user/me", json={"email_opt_in": True})

        assert response.status_code == 200
        mock_kc.assert_not_called()
