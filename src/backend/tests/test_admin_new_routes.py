"""
TDD: New Admin Routes — issues #108, #109, #110.

Covers:
- PATCH /admin/scheduled-reports/{report_id}     (GAP-A10)
- POST /admin/restore                            (Issue #108)
- GET  /admin/sessions/{user_id}                 (GAP-A13)
- DELETE /admin/sessions/{user_id}/{session_id}   (GAP-A13)
"""

import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

import auth
from database import get_db_with_rls
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# =============================================================================
# Helpers
# =============================================================================


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


# =============================================================================
# PATCH /admin/scheduled-reports/{report_id}
# =============================================================================


class TestUpdateScheduledReport:
    def test_patch_disables_report(self, client: TestClient):
        """PATCH with enabled=false returns 200 and the report is disabled."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = (5, "Weekly PDF", False)
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/scheduled-reports/5",
            json={"enabled": False},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is False
        assert data["id"] == 5

    def test_patch_enables_report(self, client: TestClient):
        """PATCH with enabled=true returns 200 and the report is enabled."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = (3, "Monthly CSV", True)
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/scheduled-reports/3",
            json={"enabled": True},
        )
        assert response.status_code == 200
        assert response.json()["enabled"] is True

    def test_patch_returns_404_when_report_missing(self, client: TestClient):
        """PATCH against a non-existent report_id returns 404."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = None
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/scheduled-reports/999999",
            json={"enabled": False},
        )
        assert response.status_code == 404

    def test_patch_requires_admin(self, client: TestClient):
        """PATCH with REGIONAL_ENCODER token returns 403."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user

        response = client.patch(
            "/api/admin/scheduled-reports/1",
            json={"enabled": False},
        )
        assert response.status_code in (401, 403)


# =============================================================================
# POST /admin/restore
# =============================================================================


class TestRestoreBackup:
    def test_rejects_invalid_filename(self, client: TestClient):
        """Uploading a file whose name does not match ^wims_\\d{8}_\\d{6}\\.sql\\.enc$ returns 400."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        response = client.post(
            "/api/admin/restore",
            files={"file": ("evil.txt", b"not a backup", "text/plain")},
        )
        assert response.status_code == 400
        assert "Invalid" in response.json().get("detail", "")

    def test_rejects_missing_file(self, client: TestClient):
        """POST /admin/restore with no file part returns 422."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        response = client.post("/api/admin/restore")
        assert response.status_code == 422


# =============================================================================
# GET /admin/sessions/{user_id}
# =============================================================================


class TestGetUserSessions:
    def test_returns_404_for_unknown_user(self, client: TestClient):
        """GET /admin/sessions/{uuid} where no user matches returns 404."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = None
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/sessions/00000000-0000-0000-0000-000000000000")
        assert response.status_code == 404

    def test_returns_sessions_list(self, client: TestClient):
        """GET returns the sessions list returned by the mocked Keycloak client."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = ("kid-abc123",)
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        fake_sessions = [
            {
                "id": "sess-001",
                "ipAddress": "1.1.1.1",
                "start": 1747000000,
                "lastAccess": 1747000100,
                "clients": {"web": "Chrome"},
            }
        ]

        with patch("services.keycloak_admin._get_admin_client") as mock_get_adm:
            mock_adm = MagicMock()
            mock_adm.get_sessions.return_value = fake_sessions
            mock_get_adm.return_value = mock_adm

            response = client.get("/api/admin/sessions/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")

        assert response.status_code == 200
        data = response.json()
        assert "sessions" in data
        assert isinstance(data["sessions"], list)
        assert len(data["sessions"]) == 1
        assert data["sessions"][0]["id"] == "sess-001"


# =============================================================================
# DELETE /admin/sessions/{user_id}/{session_id}
# =============================================================================


class TestRevokeUserSession:
    def test_returns_404_for_unknown_user(self, client: TestClient):
        """DELETE against a non-existent user returns 404."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = None
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.delete(
            "/api/admin/sessions/00000000-0000-0000-0000-000000000000/sess-xyz"
        )
        assert response.status_code == 404

    def test_revoke_session_success(self, client: TestClient):
        """DELETE /sessions/{user_id}/{session_id} returns 200 on success."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = ("kid-abc123",)
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("services.keycloak_admin._get_admin_client") as mock_get_adm:
            mock_adm = MagicMock()
            mock_adm.delete_user_session.return_value = None
            mock_get_adm.return_value = mock_adm

            response = client.delete(
                "/api/admin/sessions/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/sess-abc"
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["session_id"] == "sess-abc"
