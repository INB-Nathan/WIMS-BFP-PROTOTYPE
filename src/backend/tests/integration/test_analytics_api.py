"""
TDD: National Analyst Analytics API — RBAC and CSV Export.

Red State: REGIONAL_ENCODER gets 403 on analytics endpoints.
Green State: NATIONAL_ANALYST and SYSTEM_ADMIN can access analytics.
CSV export dispatches Celery task and returns task_id.
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import auth
from database import get_db
from main import app


@pytest.fixture
def client():
    """TestClient for FastAPI app."""
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    """Ensure dependency overrides are cleared after each test."""
    yield
    app.dependency_overrides.clear()


def test_analytics_heatmap_rejects_regional_encoder(client: TestClient):
    """REGIONAL_ENCODER must receive 403 on GET /api/analytics/heatmap."""
    async def mock_regional_encoder():
        return {"user_id": "test-uuid", "keycloak_id": "kid", "role": "REGIONAL_ENCODER"}

    app.dependency_overrides[auth.get_current_wims_user] = mock_regional_encoder

    response = client.get("/api/analytics/heatmap")
    assert response.status_code == 403
    assert "NATIONAL_ANALYST" in (response.json().get("detail") or "") or "analyst" in (
        response.json().get("detail") or ""
    ).lower()


def test_analytics_heatmap_accepts_national_analyst(client: TestClient):
    """NATIONAL_ANALYST must receive 200 on GET /api/analytics/heatmap."""
    async def mock_national_analyst():
        return {"user_id": "test-uuid", "keycloak_id": "kid", "role": "NATIONAL_ANALYST"}

    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchall.return_value = []
    mock_db.execute.return_value = mock_result

    def mock_get_db():
        try:
            yield mock_db
        finally:
            pass

    app.dependency_overrides[auth.get_current_wims_user] = mock_national_analyst
    app.dependency_overrides[get_db] = mock_get_db

    response = client.get("/api/analytics/heatmap")
    assert response.status_code == 200
    data = response.json()
    assert "type" in data or "features" in data or "data" in data


def test_analytics_heatmap_accepts_system_admin(client: TestClient):
    """SYSTEM_ADMIN must receive 200 on GET /api/analytics/heatmap."""
    async def mock_system_admin():
        return {"user_id": "test-uuid", "keycloak_id": "kid", "role": "SYSTEM_ADMIN"}

    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchall.return_value = []
    mock_db.execute.return_value = mock_result

    def mock_get_db():
        try:
            yield mock_db
        finally:
            pass

    app.dependency_overrides[auth.get_current_wims_user] = mock_system_admin
    app.dependency_overrides[get_db] = mock_get_db

    response = client.get("/api/analytics/heatmap")
    assert response.status_code == 200


def test_analytics_export_csv_dispatches_task_and_returns_task_id(client: TestClient):
    """POST /api/analytics/export/csv must dispatch Celery task and return task_id."""
    async def mock_national_analyst():
        return {"user_id": "test-uuid", "keycloak_id": "kid", "role": "NATIONAL_ANALYST"}

    mock_task = MagicMock()
    mock_task.delay.return_value = MagicMock(id="mock-task-id-123")

    app.dependency_overrides[auth.get_current_wims_user] = mock_national_analyst

    with patch("api.routes.analytics.export_incidents_csv_task", mock_task):
        response = client.post(
            "/api/analytics/export/csv",
            json={"filters": {}, "columns": ["incident_id", "notification_dt"]},
        )

    assert response.status_code == 200
    data = response.json()
    assert "task_id" in data
    assert data["task_id"] == "mock-task-id-123"


def test_analytics_trends_rejects_regional_encoder(client: TestClient):
    """REGIONAL_ENCODER must receive 403 on GET /api/analytics/trends."""
    async def mock_regional_encoder():
        return {"user_id": "test-uuid", "keycloak_id": "kid", "role": "REGIONAL_ENCODER"}

    app.dependency_overrides[auth.get_current_wims_user] = mock_regional_encoder

    response = client.get("/api/analytics/trends")
    assert response.status_code == 403


def test_analytics_comparative_rejects_regional_encoder(client: TestClient):
    """REGIONAL_ENCODER must receive 403 on GET /api/analytics/comparative."""
    async def mock_regional_encoder():
        return {"user_id": "test-uuid", "keycloak_id": "kid", "role": "REGIONAL_ENCODER"}

    app.dependency_overrides[auth.get_current_wims_user] = mock_regional_encoder

    response = client.get(
        "/api/analytics/comparative",
        params={
            "range_a_start": "2024-01-01",
            "range_a_end": "2024-01-31",
            "range_b_start": "2024-02-01",
            "range_b_end": "2024-02-29",
        },
    )
    assert response.status_code == 403


def test_analytics_heatmap_scopes_to_verified_non_archived(client: TestClient):
    """Heatmap query must filter by verification_status=VERIFIED and is_archived=FALSE."""
    async def mock_national_analyst():
        return {"user_id": "test-uuid", "keycloak_id": "kid", "role": "NATIONAL_ANALYST"}

    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchall.return_value = []
    mock_db.execute.return_value = mock_result

    def mock_get_db():
        try:
            yield mock_db
        finally:
            pass

    app.dependency_overrides[auth.get_current_wims_user] = mock_national_analyst
    app.dependency_overrides[get_db] = mock_get_db

    client.get("/api/analytics/heatmap")

    # Verify execute was called with SQL containing verified + non-archived filter
    call_args = mock_db.execute.call_args
    assert call_args is not None
    sql = str(call_args[0][0]) if call_args[0] else ""
    assert "VERIFIED" in sql
    assert "is_archived" in sql
