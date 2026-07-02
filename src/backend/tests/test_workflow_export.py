"""Tests for workflow-specific analytics export endpoints.

Run: cd src/backend && python -m pytest tests/test_workflow_export.py -v
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch

from main import app
from auth import get_analyst_or_admin
from auth import get_db_with_rls

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

WFLOW_PREFIX = "/api/analytics/export/workflow"

VALID_COMPARATIVE_BODY = {
    "range_a_start": "2024-01-01",
    "range_a_end": "2024-01-31",
    "range_b_start": "2024-02-01",
    "range_b_end": "2024-02-29",
    "filters": {},
}

VALID_TRENDS_BODY = {
    "interval": "daily",
    "filters": {},
}

VALID_RESPONSE_TIME_BODY = {
    "filters": {},
}

VALID_TOP_N_FULL_BODY = {
    "metric": "incidents",
    "dimension": "municipality",
    "mode": "full",
    "filters": {},
}

VALID_TOP_N_SELECTED_BODY = {
    "metric": "incidents",
    "dimension": "municipality",
    "mode": "selected",
    "selected_name": "Test Hotspot",
    "metric_value": 42.0,
    "filters": {},
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_overrides():
    """Ensure dependency overrides are cleared after each test."""
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def mock_national_analyst():
    """Override auth + RLS deps with a national analyst."""

    async def _analyst():
        return {
            "user_id": "00000000-0000-0000-0000-000000000001",
            "keycloak_id": "test-kid",
            "role": "NATIONAL_ANALYST",
        }

    def _db():
        return MagicMock()

    app.dependency_overrides[get_analyst_or_admin] = _analyst
    app.dependency_overrides[get_db_with_rls] = _db
    yield


# ===================================================================
# Comparative
# ===================================================================


class TestWorkflowComparativeExport:
    ENDPOINT = f"{WFLOW_PREFIX}/comparative"

    @patch("api.routes.analytics.export_workflow_comparative_task")
    def test_valid_request_returns_task_id(self, mock_task, mock_national_analyst):
        mock_task.delay.return_value = MagicMock(id="mock-task-123")
        resp = client.post(self.ENDPOINT, json=VALID_COMPARATIVE_BODY)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["task_id"] == "mock-task-123"

    def test_invalid_dates_return_422(self, mock_national_analyst):
        body = {**VALID_COMPARATIVE_BODY, "range_a_start": "not-a-date"}
        resp = client.post(self.ENDPOINT, json=body)
        assert resp.status_code == 422, resp.text

    def test_missing_required_fields_return_422(self, mock_national_analyst):
        resp = client.post(self.ENDPOINT, json={})
        assert resp.status_code == 422, resp.text


# ===================================================================
# Trends
# ===================================================================


class TestWorkflowTrendsExport:
    ENDPOINT = f"{WFLOW_PREFIX}/trends"

    @patch("api.routes.analytics.export_workflow_trends_task")
    def test_valid_request_returns_task_id(self, mock_task, mock_national_analyst):
        mock_task.delay.return_value = MagicMock(id="mock-task-456")
        resp = client.post(self.ENDPOINT, json=VALID_TRENDS_BODY)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["task_id"] == "mock-task-456"

    def test_invalid_interval_returns_422(self, mock_national_analyst):
        body = {**VALID_TRENDS_BODY, "interval": "invalid"}
        resp = client.post(self.ENDPOINT, json=body)
        assert resp.status_code == 422, resp.text


# ===================================================================
# Response Time
# ===================================================================


class TestWorkflowResponseTimeExport:
    ENDPOINT = f"{WFLOW_PREFIX}/response-time"

    @patch("api.routes.analytics.export_workflow_response_time_task")
    def test_valid_request_returns_task_id(self, mock_task, mock_national_analyst):
        mock_task.delay.return_value = MagicMock(id="mock-task-789")
        resp = client.post(self.ENDPOINT, json=VALID_RESPONSE_TIME_BODY)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["task_id"] == "mock-task-789"


# ===================================================================
# Top-N
# ===================================================================


class TestWorkflowTopNExport:
    ENDPOINT = f"{WFLOW_PREFIX}/top-n"

    @patch("api.routes.analytics.export_workflow_top_n_task")
    def test_full_mode_returns_task_id(self, mock_task, mock_national_analyst):
        mock_task.delay.return_value = MagicMock(id="mock-task-topn-full")
        resp = client.post(self.ENDPOINT, json=VALID_TOP_N_FULL_BODY)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["task_id"] == "mock-task-topn-full"

    @patch("api.routes.analytics.export_workflow_top_n_task")
    def test_selected_mode_returns_task_id(self, mock_task, mock_national_analyst):
        mock_task.delay.return_value = MagicMock(id="mock-task-topn-sel")
        resp = client.post(self.ENDPOINT, json=VALID_TOP_N_SELECTED_BODY)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["task_id"] == "mock-task-topn-sel"

    def test_invalid_metric_returns_422(self, mock_national_analyst):
        body = {**VALID_TOP_N_FULL_BODY, "metric": "invalid"}
        resp = client.post(self.ENDPOINT, json=body)
        assert resp.status_code == 422, resp.text

    def test_invalid_dimension_returns_422(self, mock_national_analyst):
        body = {**VALID_TOP_N_FULL_BODY, "dimension": "invalid"}
        resp = client.post(self.ENDPOINT, json=body)
        assert resp.status_code == 422, resp.text

    def test_invalid_mode_returns_422(self, mock_national_analyst):
        body = {**VALID_TOP_N_FULL_BODY, "mode": "invalid"}
        resp = client.post(self.ENDPOINT, json=body)
        assert resp.status_code == 422, resp.text

    def test_selected_mode_missing_name_returns_422(self, mock_national_analyst):
        body = {
            **VALID_TOP_N_SELECTED_BODY,
            "selected_name": None,
        }
        resp = client.post(self.ENDPOINT, json=body)
        assert resp.status_code == 422, resp.text


# ===================================================================
# Service-level — barangay_name filter
# ===================================================================


class TestBarangayFilterInfrastructure:
    """Verify the barangay_name filter plumbing added in Step 2."""

    def test_append_common_filters_passes_barangay(self):
        from services.analytics_read_model import _append_common_filters

        clauses: list[str] = []
        params: dict[str, str] = {}
        _append_common_filters(
            clauses, params,
            start_date="2024-01-01",
            end_date="2024-12-31",
            barangay_name="Test Barangay",
        )
        joined = " AND ".join(clauses)
        assert "barangay_name" in joined
        assert params["barangay_name"] == "Test Barangay"

    def test_build_analytics_filters_passes_barangay(self):
        from services.analytics.filters import build_analytics_filters

        filters = build_analytics_filters(
            barangay_name="Some Barangay",
            start_date="2024-01-01",
            end_date="2024-12-31",
        )
        assert filters.barangay_name == "Some Barangay"

    def test_as_task_filters_includes_barangay(self):
        from services.analytics.filters import build_analytics_filters

        filters = build_analytics_filters(barangay_name="My Barangay")
        task_filters = filters.as_task_filters()
        assert task_filters.get("barangay_name") == "My Barangay"

    def test_get_export_rows_passes_barangay(self):
        """Verify get_export_rows passes barangay_name through _append_common_filters."""
        from services.analytics_read_model import _append_common_filters

        clauses: list[str] = []
        params: dict[str, str] = {}
        _append_common_filters(
            clauses, params,
            barangay_name="Specific Barangay",
        )
        assert params.get("barangay_name") == "Specific Barangay"
