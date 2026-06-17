"""
Tests for admin sync failure management endpoints (PR #379 / issues #302, #141).

Covers:
- POST /admin/sync/report — report a failed sync op (authenticated, any role)
- GET  /admin/sync/failed — list failed syncs (SYSTEM_ADMIN only)
- POST /admin/sync/{op_id}/retry — clear a failed op from server list (admin)
- DELETE /admin/sync/{op_id} — remove a failed op from server list (admin)
"""

import pytest
from fastapi.testclient import TestClient

import auth
from main import app

# Import the module-level _failed_syncs dict to reset between tests
from api.routes.admin.sync import _failed_syncs


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()
    _failed_syncs.clear()


# ── Helpers ──────────────────────────────────────────────────────────────────


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


# ── POST /admin/sync/report ──────────────────────────────────────────────────


class TestReportSyncFailure:
    def test_report_accepts_authenticated_user(self, client: TestClient):
        """Any authenticated user can report their own sync failure."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user

        response = client.post(
            "/api/admin/sync/report",
            json={
                "localId": "op-uuid-1",
                "operation": "create",
                "errorCode": "network",
                "errorMessage": "Connection lost",
                "encoderId": "kid-encoder",
                "regionId": 5,
                "retryCount": 5,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "logged"

    def test_report_missing_localId_returns_400(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user

        response = client.post(
            "/api/admin/sync/report",
            json={"operation": "create"},
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "localId is required"

    def test_reported_op_appears_in_admin_failed_list(self, client: TestClient):
        # Step 1: encoder reports a failure
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user
        resp = client.post(
            "/api/admin/sync/report",
            json={
                "localId": "op-uuid-2",
                "operation": "submit",
                "errorCode": "4xx",
                "errorMessage": "HTTP 422",
                "encoderId": "kid-encoder",
                "regionId": 3,
                "retryCount": 5,
            },
        )
        assert resp.status_code == 200

        # Step 2: admin lists failed syncs
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        resp2 = client.get("/api/admin/sync/failed")
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2["total"] >= 1
        matching = [item for item in data2["items"] if item["localId"] == "op-uuid-2"]
        assert len(matching) == 1
        assert matching[0]["operation"] == "submit"
        assert matching[0]["errorCode"] == "4xx"


# ── GET /admin/sync/failed ───────────────────────────────────────────────────


class TestListFailedSyncs:
    def test_empty_when_no_reports(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        response = client.get("/api/admin/sync/failed")
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_sorted_by_failed_at_desc(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user
        client.post(
            "/api/admin/sync/report",
            json={"localId": "op-a", "operation": "create", "encoderId": "e1"},
        )
        client.post(
            "/api/admin/sync/report",
            json={"localId": "op-b", "operation": "update", "encoderId": "e1"},
        )

        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        response = client.get("/api/admin/sync/failed")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        # Most recent first (op-b was reported after op-a)
        assert data["items"][0]["localId"] == "op-b"
        assert data["items"][1]["localId"] == "op-a"


# ── POST /admin/sync/{op_id}/retry ───────────────────────────────────────────


class TestRetrySyncOp:
    def test_retry_clears_existing_op(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user
        client.post(
            "/api/admin/sync/report",
            json={"localId": "op-retry-1", "operation": "create", "encoderId": "e1"},
        )

        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        response = client.post("/api/admin/sync/op-retry-1/retry")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "retry"
        assert data["opId"] == "op-retry-1"

        # Verify it's gone from the list
        resp2 = client.get("/api/admin/sync/failed")
        assert resp2.status_code == 200
        remaining = [item for item in resp2.json()["items"] if item["localId"] == "op-retry-1"]
        assert len(remaining) == 0

    def test_retry_non_existent_returns_404(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        response = client.post("/api/admin/sync/nonexistent/retry")
        assert response.status_code == 404
        assert response.json()["detail"] == "Sync op not found"


# ── DELETE /admin/sync/{op_id} ───────────────────────────────────────────────


class TestDeleteSyncOp:
    def test_delete_removes_existing_op(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user
        client.post(
            "/api/admin/sync/report",
            json={"localId": "op-del-1", "operation": "delete", "encoderId": "e1"},
        )

        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        response = client.delete("/api/admin/sync/op-del-1")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "deleted"
        assert data["opId"] == "op-del-1"

        # Verify it's gone from the list
        resp2 = client.get("/api/admin/sync/failed")
        assert resp2.status_code == 200
        remaining = [item for item in resp2.json()["items"] if item["localId"] == "op-del-1"]
        assert len(remaining) == 0

    def test_delete_non_existent_returns_404(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        response = client.delete("/api/admin/sync/nonexistent")
        assert response.status_code == 404
        assert response.json()["detail"] == "Sync op not found"
