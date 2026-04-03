"""
TDD: National Analyst Analytics API — RBAC and CSV Export.

Red State: REGIONAL_ENCODER gets 403 on analytics endpoints.
Green State: NATIONAL_ANALYST and SYSTEM_ADMIN can access analytics.
CSV export dispatches Celery task and returns task_id.

Comparative/trends filters: incident_type maps to general_category; alarm_level is optional.
Comparative ranges may overlap — API does not enforce ordering between range A and range B.
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
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "role": "REGIONAL_ENCODER",
        }

    app.dependency_overrides[auth.get_current_wims_user] = mock_regional_encoder

    response = client.get("/api/analytics/heatmap")
    assert response.status_code == 403
    assert (
        "NATIONAL_ANALYST" in (response.json().get("detail") or "")
        or "analyst" in (response.json().get("detail") or "").lower()
    )


def test_analytics_heatmap_accepts_national_analyst(client: TestClient):
    """NATIONAL_ANALYST must receive 200 on GET /api/analytics/heatmap."""

    async def mock_national_analyst():
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "role": "NATIONAL_ANALYST",
        }

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
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "role": "NATIONAL_ANALYST",
        }

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
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "role": "REGIONAL_ENCODER",
        }

    app.dependency_overrides[auth.get_current_wims_user] = mock_regional_encoder

    response = client.get("/api/analytics/trends")
    assert response.status_code == 403


def test_analytics_comparative_rejects_regional_encoder(client: TestClient):
    """REGIONAL_ENCODER must receive 403 on GET /api/analytics/comparative."""

    async def mock_regional_encoder():
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "role": "REGIONAL_ENCODER",
        }

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


def test_analytics_heatmap_uses_read_model(client: TestClient):
    """Heatmap must query analytics_incident_facts (read model), not raw fire_incidents."""

    async def mock_national_analyst():
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "role": "NATIONAL_ANALYST",
        }

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

    # Verify execute was called with SQL against analytics_incident_facts (pre-filtered read model)
    call_args = mock_db.execute.call_args
    assert call_args is not None
    sql = str(call_args[0][0]) if call_args[0] else ""
    assert "analytics_incident_facts" in sql


def _mock_analyst_db():
    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchall.return_value = []
    mock_db.execute.return_value = mock_result

    def mock_get_db():
        try:
            yield mock_db
        finally:
            pass

    return mock_db, mock_get_db


def test_analytics_comparative_passes_alarm_level_and_incident_type_to_count_in_range(
    client: TestClient,
):
    """GET /api/analytics/comparative must forward alarm_level and incident_type to count_in_range."""

    async def mock_national_analyst():
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "role": "NATIONAL_ANALYST",
        }

    mock_db, mock_get_db = _mock_analyst_db()

    app.dependency_overrides[auth.get_current_wims_user] = mock_national_analyst
    app.dependency_overrides[get_db] = mock_get_db

    with patch("api.routes.analytics.count_in_range", side_effect=[3, 7]) as mock_count:
        response = client.get(
            "/api/analytics/comparative",
            params={
                "range_a_start": "2024-01-01",
                "range_a_end": "2024-01-15",
                "range_b_start": "2024-02-01",
                "range_b_end": "2024-02-15",
                "incident_type": "STRUCTURAL",
                "alarm_level": "2",
            },
        )

    assert response.status_code == 200
    assert mock_count.call_count == 2
    for call in mock_count.call_args_list:
        assert call.kwargs.get("incident_type") == "STRUCTURAL"
        assert call.kwargs.get("alarm_level") == "2"
    data = response.json()
    assert data["range_a"]["count"] == 3
    assert data["range_b"]["count"] == 7


def test_analytics_comparative_counts_differ_when_incident_type_filter_changes(
    client: TestClient,
):
    """Same date ranges; different incident_type must yield different counts when underlying data differs."""

    async def mock_national_analyst():
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "role": "NATIONAL_ANALYST",
        }

    mock_db, mock_get_db = _mock_analyst_db()

    app.dependency_overrides[auth.get_current_wims_user] = mock_national_analyst
    app.dependency_overrides[get_db] = mock_get_db

    params_base = {
        "range_a_start": "2024-01-01",
        "range_a_end": "2024-01-31",
        "range_b_start": "2024-02-01",
        "range_b_end": "2024-02-29",
    }

    with patch(
        "api.routes.analytics.count_in_range", side_effect=[10, 12]
    ) as mock_count_structural:
        r1 = client.get(
            "/api/analytics/comparative",
            params={**params_base, "incident_type": "STRUCTURAL"},
        )
    assert r1.status_code == 200
    assert r1.json()["range_a"]["count"] == 10

    with patch(
        "api.routes.analytics.count_in_range", side_effect=[4, 5]
    ) as mock_count_other:
        r2 = client.get(
            "/api/analytics/comparative",
            params={**params_base, "incident_type": "VEHICULAR"},
        )
    assert r2.status_code == 200
    assert r2.json()["range_a"]["count"] == 4
    assert (
        mock_count_structural.call_args_list[0].kwargs.get("incident_type")
        == "STRUCTURAL"
    )
    assert mock_count_other.call_args_list[0].kwargs.get("incident_type") == "VEHICULAR"


def test_analytics_comparative_counts_differ_when_alarm_level_filter_changes(
    client: TestClient,
):
    """Same date ranges; different alarm_level must yield different counts when implementation applies the filter."""

    async def mock_national_analyst():
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "role": "NATIONAL_ANALYST",
        }

    mock_db, mock_get_db = _mock_analyst_db()

    app.dependency_overrides[auth.get_current_wims_user] = mock_national_analyst
    app.dependency_overrides[get_db] = mock_get_db

    params_base = {
        "range_a_start": "2024-01-01",
        "range_a_end": "2024-01-31",
        "range_b_start": "2024-02-01",
        "range_b_end": "2024-02-29",
    }

    with patch("api.routes.analytics.count_in_range", side_effect=[8, 9]) as mock_a:
        r1 = client.get(
            "/api/analytics/comparative", params={**params_base, "alarm_level": "1"}
        )
    assert r1.status_code == 200
    assert r1.json()["range_a"]["count"] == 8

    with patch("api.routes.analytics.count_in_range", side_effect=[1, 2]) as mock_b:
        r2 = client.get(
            "/api/analytics/comparative", params={**params_base, "alarm_level": "3"}
        )
    assert r2.status_code == 200
    assert r2.json()["range_a"]["count"] == 1
    assert mock_a.call_args_list[0].kwargs.get("alarm_level") == "1"
    assert mock_b.call_args_list[0].kwargs.get("alarm_level") == "3"


def test_analytics_trends_passes_alarm_level_to_get_trends(client: TestClient):
    """GET /api/analytics/trends must forward alarm_level to get_trends."""

    async def mock_national_analyst():
        return {
            "user_id": "test-uuid",
            "keycloak_id": "kid",
            "role": "NATIONAL_ANALYST",
        }

    mock_db, mock_get_db = _mock_analyst_db()

    app.dependency_overrides[auth.get_current_wims_user] = mock_national_analyst
    app.dependency_overrides[get_db] = mock_get_db

    with patch("api.routes.analytics.get_trends", return_value=[]) as mock_gt:
        response = client.get(
            "/api/analytics/trends",
            params={
                "start_date": "2024-01-01",
                "end_date": "2024-01-31",
                "alarm_level": "2",
                "incident_type": "STRUCTURAL",
            },
        )

    assert response.status_code == 200
    assert mock_gt.called
    assert mock_gt.call_args.kwargs.get("alarm_level") == "2"
    assert mock_gt.call_args.kwargs.get("incident_type") == "STRUCTURAL"
