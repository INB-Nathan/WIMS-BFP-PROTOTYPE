"""
TDD Baseline: Analyst Dashboard Queue (AQ-01 through AQ-15).

Red State: ALL tests here should FAIL against current codebase.
Green State: Each test passes when its corresponding AQ feature is implemented.

Coverage:
  Phase 1 — Foundation: materialized views, schema expansion, sync
  Phase 2 — Filters + Charts: severity, damage, pie, top-10, response time
  Phase 3 — Export: PDF, Excel, audit trail
  Phase 4 — Extensions: multi-region, cross-region, top-N, scheduled reports

Standards enforced:
  - RBAC: only NATIONAL_ANALYST + SYSTEM_ADMIN (no bypass by path)
  - Parameterized SQL: filter values bound, not concatenated
  - Read model: queries against analytics_incident_facts or materialized views
  - Error responses: no stack traces, no SQL leaks
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

import auth
from database import get_db, get_db_with_rls
from main import app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def _mock_user(role: str):
    async def _fn():
        return {
            "user_id": "00000000-0000-0000-0000-000000000001",
            "keycloak_id": "kid",
            "role": role,
        }
    return _fn


def _mock_analyst_db():
    """Mock DB that returns empty results by default."""
    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchall.return_value = []
    mock_result.scalar.return_value = 0
    mock_db.execute.return_value = mock_result
    # Chain for .scalar()
    mock_db.execute.return_value.scalar.return_value = 0

    def mock_get_db():
        try:
            yield mock_db
        finally:
            pass

    def mock_get_db_with_rls(request=None):
        try:
            yield mock_db
        finally:
            pass

    return mock_db, mock_get_db, mock_get_db_with_rls


def _set_analyst(client: TestClient):
    """Wire NATIONAL_ANALYST + mock DB for a test."""
    mock_db, mock_get_db, mock_get_db_with_rls = _mock_analyst_db()
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("NATIONAL_ANALYST")
    app.dependency_overrides[get_db] = mock_get_db
    app.dependency_overrides[get_db_with_rls] = mock_get_db_with_rls
    return mock_db


# ===========================================================================
# PHASE 1: Foundation (AQ-01, AQ-02, AQ-03)
# ===========================================================================

class TestPhase1Foundation:
    """Materialized views, schema expansion, sync."""

    # -- AQ-01: Materialized views exist ----------------------------------

    def test_mv_incident_counts_daily_exists(self, client: TestClient):
        """mv_incident_counts_daily materialized view must exist in DB schema."""
        mock_db = _set_analyst(client)
        # Query pg_matviews to check view exists
        mock_db.execute.return_value.fetchone.return_value = ("mv_incident_counts_daily",)

        response = client.get("/api/analytics/heatmap")
        assert response.status_code == 200

        # The sync or refresh task must reference this view
        # Verify by checking if analytics_refresh task imports it
        from tasks.analytics_refresh import MV_NAMES
        assert "mv_incident_counts_daily" in MV_NAMES

    def test_mv_incident_by_region_exists(self, client: TestClient):
        """mv_incident_by_region materialized view must exist."""
        from tasks.analytics_refresh import MV_NAMES
        assert "mv_incident_by_region" in MV_NAMES

    def test_mv_incident_by_barangay_exists(self, client: TestClient):
        """mv_incident_by_barangay materialized view must exist."""
        from tasks.analytics_refresh import MV_NAMES
        assert "mv_incident_by_barangay" in MV_NAMES

    def test_mv_incident_type_distribution_exists(self, client: TestClient):
        """mv_incident_type_distribution materialized view must exist."""
        from tasks.analytics_refresh import MV_NAMES
        assert "mv_incident_type_distribution" in MV_NAMES

    def test_materialized_view_refresh_is_celery_task(self):
        """Materialized view refresh must be a Celery beat task (not manual)."""
        from tasks.analytics_refresh import refresh_materialized_views
        # Must be a celery shared_task or task
        assert hasattr(refresh_materialized_views, "delay"), \
            "refresh_materialized_views must be a Celery task (has .delay)"

    def test_materialized_view_refresh_accepts_concurrent_option(self):
        """REFRESH MATERIALIZED VIEW CONCURRENTLY for zero-downtime."""
        from tasks.analytics_refresh import refresh_materialized_views
        import inspect
        sig = inspect.signature(refresh_materialized_views)
        # Must support concurrent=True or similar flag
        param_names = list(sig.parameters.keys())
        assert any("concurrent" in p.lower() for p in param_names), \
            "refresh_materialized_views must accept concurrent flag"

    # -- AQ-02: Schema expansion -----------------------------------------

    def test_analytics_facts_has_casualty_columns(self, client: TestClient):
        """analytics_incident_facts must have civilian_injured, civilian_deaths columns."""
        from tasks.exports import ALLOWED_EXPORT_COLUMNS
        assert "civilian_injured" in ALLOWED_EXPORT_COLUMNS
        assert "civilian_deaths" in ALLOWED_EXPORT_COLUMNS
        assert "firefighter_injured" in ALLOWED_EXPORT_COLUMNS
        assert "firefighter_deaths" in ALLOWED_EXPORT_COLUMNS

    def test_analytics_facts_has_response_time_column(self):
        """analytics_incident_facts must have total_response_time_minutes."""
        from tasks.exports import ALLOWED_EXPORT_COLUMNS
        assert "total_response_time_minutes" in ALLOWED_EXPORT_COLUMNS

    def test_analytics_facts_has_property_damage_column(self):
        """analytics_incident_facts must have estimated_damage_php."""
        from tasks.exports import ALLOWED_EXPORT_COLUMNS
        assert "estimated_damage_php" in ALLOWED_EXPORT_COLUMNS

    def test_analytics_facts_has_barangay_column(self):
        """analytics_incident_facts must have barangay_name for top-N queries."""
        from tasks.exports import ALLOWED_EXPORT_COLUMNS
        assert "barangay_name" in ALLOWED_EXPORT_COLUMNS or "fire_station_name" in ALLOWED_EXPORT_COLUMNS

    def test_analytics_facts_has_fire_station_column(self):
        """analytics_incident_facts must have fire_station_name."""
        from tasks.exports import ALLOWED_EXPORT_COLUMNS
        assert "fire_station_name" in ALLOWED_EXPORT_COLUMNS

    # -- AQ-03: Sync populates new columns -------------------------------

    def test_sync_incident_populates_casualty_columns(self):
        """sync_incident_to_analytics must insert civilian_injured/deaths etc."""
        import inspect
        from services.analytics_read_model import sync_incident_to_analytics
        source = inspect.getsource(sync_incident_to_analytics)
        assert "civilian_injured" in source, "sync must populate civilian_injured"
        assert "civilian_deaths" in source, "sync must populate civilian_deaths"
        assert "total_response_time_minutes" in source, "sync must populate response time"

    def test_sync_incident_populates_barangay_and_station(self):
        """sync_incident_to_analytics must populate barangay and fire_station_name."""
        import inspect
        from services.analytics_read_model import sync_incident_to_analytics
        source = inspect.getsource(sync_incident_to_analytics)
        assert "barangay" in source, "sync must populate barangay"
        assert "fire_station_name" in source, "sync must populate fire_station_name"


# ===========================================================================
# PHASE 2: Filters + Charts (AQ-04 through AQ-08)
# ===========================================================================

class TestPhase2FiltersAndCharts:
    """Casualty severity, damage range, pie chart, top-10, response time."""

    # -- AQ-04: Casualty severity filter ---------------------------------

    def test_heatmap_accepts_casualty_severity_filter(self, client: TestClient):
        """GET /api/analytics/heatmap must accept casualty_severity query param."""
        mock_db = _set_analyst(client)
        response = client.get("/api/analytics/heatmap", params={"casualty_severity": "high"})
        assert response.status_code == 200
        # Verify severity was passed to DB query
        call_args = mock_db.execute.call_args
        sql = str(call_args[0][0]) if call_args else ""
        params = call_args[0][1] if call_args and len(call_args[0]) > 1 else {}
        assert "civilian_deaths" in sql or "casualty_severity" in str(params), \
            "severity filter must map to casualty column query"

    def test_trends_accepts_casualty_severity_filter(self, client: TestClient):
        """GET /api/analytics/trends must accept casualty_severity query param."""
        mock_db = _set_analyst(client)
        response = client.get("/api/analytics/trends", params={"casualty_severity": "medium"})
        assert response.status_code == 200

    def test_casualty_severity_invalid_value_rejected(self, client: TestClient):
        """casualty_severity must be high/medium/low only."""
        _set_analyst(client)
        response = client.get("/api/analytics/heatmap", params={"casualty_severity": "invalid"})
        assert response.status_code == 422

    # -- AQ-05: Property damage range filter -----------------------------

    def test_heatmap_accepts_damage_range_filter(self, client: TestClient):
        """GET /api/analytics/heatmap must accept damage_min and damage_max."""
        mock_db = _set_analyst(client)
        response = client.get("/api/analytics/heatmap", params={
            "damage_min": 10000,
            "damage_max": 500000,
        })
        assert response.status_code == 200
        call_args = mock_db.execute.call_args
        sql = str(call_args[0][0]) if call_args else ""
        assert "estimated_damage_php" in sql

    def test_damage_range_min_must_be_non_negative(self, client: TestClient):
        """damage_min must reject negative values."""
        _set_analyst(client)
        response = client.get("/api/analytics/heatmap", params={"damage_min": -100})
        assert response.status_code == 422

    def test_damage_range_max_must_exceed_min(self, client: TestClient):
        """damage_max must be greater than damage_min when both provided."""
        _set_analyst(client)
        response = client.get("/api/analytics/heatmap", params={
            "damage_min": 500000,
            "damage_max": 10000,
        })
        assert response.status_code == 422

    # -- AQ-06: Type distribution endpoint -------------------------------

    def test_type_distribution_endpoint_exists(self, client: TestClient):
        """GET /api/analytics/type-distribution must exist and return 200."""
        mock_db = _set_analyst(client)
        mock_db.execute.return_value.fetchall.return_value = [
            ("STRUCTURAL", 42),
            ("NON_STRUCTURAL", 18),
            ("VEHICULAR", 7),
        ]
        response = client.get("/api/analytics/type-distribution")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 3
        assert data[0]["type"] == "STRUCTURAL"
        assert data[0]["count"] == 42

    def test_type_distribution_supports_date_filter(self, client: TestClient):
        """Type distribution must accept date range filters."""
        mock_db = _set_analyst(client)
        mock_db.execute.return_value.fetchall.return_value = []
        response = client.get("/api/analytics/type-distribution", params={
            "start_date": "2024-01-01",
            "end_date": "2024-12-31",
        })
        assert response.status_code == 200

    def test_type_distribution_supports_region_filter(self, client: TestClient):
        """Type distribution must accept region_id filter."""
        mock_db = _set_analyst(client)
        mock_db.execute.return_value.fetchall.return_value = []
        response = client.get("/api/analytics/type-distribution", params={"region_id": 1})
        assert response.status_code == 200

    def test_type_distribution_rejects_regional_encoder(self, client: TestClient):
        """REGIONAL_ENCODER must receive 403 on type-distribution."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user("REGIONAL_ENCODER")
        response = client.get("/api/analytics/type-distribution")
        assert response.status_code == 403

    # -- AQ-07: Top barangays endpoint -----------------------------------

    def test_top_barangays_endpoint_exists(self, client: TestClient):
        """GET /api/analytics/top-barangays must exist and return 200."""
        mock_db = _set_analyst(client)
        mock_db.execute.return_value.fetchall.return_value = [
            ("Barangay 1", 120),
            ("Barangay 2", 95),
            ("Barangay 3", 87),
        ]
        response = client.get("/api/analytics/top-barangays")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 3
        assert data[0]["barangay"] == "Barangay 1"
        assert data[0]["count"] == 120

    def test_top_barangays_respects_limit_param(self, client: TestClient):
        """Top barangays must accept limit parameter (default 10)."""
        mock_db = _set_analyst(client)
        mock_db.execute.return_value.fetchall.return_value = [
            (f"Barangay {i}", 100 - i) for i in range(1, 6)
        ]
        response = client.get("/api/analytics/top-barangays", params={"limit": 5})
        assert response.status_code == 200
        data = response.json()
        assert len(data) <= 5

    def test_top_barangays_limit_max_50(self, client: TestClient):
        """Top barangays limit > 50 must be rejected by FastAPI validation."""
        _set_analyst(client)
        response = client.get("/api/analytics/top-barangays", params={"limit": 999})
        assert response.status_code == 422

    def test_top_barangays_rejects_regional_encoder(self, client: TestClient):
        """REGIONAL_ENCODER must receive 403 on top-barangays."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user("REGIONAL_ENCODER")
        response = client.get("/api/analytics/top-barangays")
        assert response.status_code == 403

    # -- AQ-08: Response time by region endpoint -------------------------

    def test_response_time_by_region_endpoint_exists(self, client: TestClient):
        """GET /api/analytics/response-time-by-region must exist and return 200."""
        mock_db = _set_analyst(client)
        # Mock returns (region_id, avg_rt, min_rt, max_rt) matching SQL
        mock_db.execute.return_value.fetchall.return_value = [
            (1, 12.5, 3, 45),
            (2, 18.2, 5, 32),
        ]
        response = client.get("/api/analytics/response-time-by-region")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2
        # Must include region_id, region_name, avg_response_time, min, max
        item = data[0]
        assert "region_id" in item
        assert "region_name" in item
        assert "avg_response_time" in item
        assert "min_response_time" in item
        assert "max_response_time" in item

    def test_response_time_supports_date_filter(self, client: TestClient):
        """Response time must accept date range."""
        mock_db = _set_analyst(client)
        mock_db.execute.return_value.fetchall.return_value = []
        response = client.get("/api/analytics/response-time-by-region", params={
            "start_date": "2024-01-01",
            "end_date": "2024-12-31",
        })
        assert response.status_code == 200

    def test_response_time_rejects_regional_encoder(self, client: TestClient):
        """REGIONAL_ENCODER must receive 403 on response-time endpoint."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user("REGIONAL_ENCODER")
        response = client.get("/api/analytics/response-time-by-region")
        assert response.status_code == 403

    def test_response_time_queries_read_model(self, client: TestClient):
        """Response time must query analytics_incident_facts or mv_incident_by_region."""
        mock_db = _set_analyst(client)
        mock_db.execute.return_value.fetchall.return_value = []
        client.get("/api/analytics/response-time-by-region")
        call_args = mock_db.execute.call_args
        sql = str(call_args[0][0]).lower()
        assert "analytics_incident_facts" in sql or "mv_incident_by_region" in sql


# ===========================================================================
# PHASE 3: Export (AQ-09, AQ-10, AQ-11)
# ===========================================================================

class TestPhase3Export:
    """PDF, Excel, audit trail."""

    def _set_analyst(self, client: TestClient):
        return _set_analyst(client)

    # -- AQ-09: PDF export -----------------------------------------------

    def test_export_pdf_endpoint_exists(self, client: TestClient):
        """POST /api/analytics/export/pdf must dispatch Celery task."""
        self._set_analyst(client)
        mock_task = MagicMock()
        mock_task.delay.return_value = MagicMock(id="pdf-task-123")

        with patch("api.routes.analytics.export_incidents_pdf_task", mock_task):
            response = client.post("/api/analytics/export/pdf", json={
                "filters": {},
                "columns": ["incident_id", "notification_dt"],
            })

        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data
        assert data["task_id"] == "pdf-task-123"

    def test_export_pdf_rejects_regional_encoder(self, client: TestClient):
        """REGIONAL_ENCODER must receive 403 on PDF export."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user("REGIONAL_ENCODER")
        response = client.post("/api/analytics/export/pdf", json={
            "filters": {},
            "columns": ["incident_id"],
        })
        assert response.status_code == 403

    def test_export_pdf_accepts_filters(self, client: TestClient):
        """PDF export must forward filters to Celery task."""
        self._set_analyst(client)
        mock_task = MagicMock()
        mock_task.delay.return_value = MagicMock(id="pdf-task-456")

        with patch("api.routes.analytics.export_incidents_pdf_task", mock_task):
            client.post("/api/analytics/export/pdf", json={
                "filters": {"start_date": "2024-01-01", "region_id": 1},
                "columns": ["incident_id"],
            })

        assert mock_task.delay.called
        call_kwargs = mock_task.delay.call_args[1] or mock_task.delay.call_args[0]
        # Filters must be passed through
        assert "filters" in str(call_kwargs) or "start_date" in str(call_kwargs)

    # -- AQ-10: Excel export ---------------------------------------------

    def test_export_excel_endpoint_exists(self, client: TestClient):
        """POST /api/analytics/export/excel must dispatch Celery task."""
        self._set_analyst(client)
        mock_task = MagicMock()
        mock_task.delay.return_value = MagicMock(id="excel-task-789")

        with patch("api.routes.analytics.export_incidents_excel_task", mock_task):
            response = client.post("/api/analytics/export/excel", json={
                "filters": {},
                "columns": ["incident_id", "notification_dt"],
            })

        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data
        assert data["task_id"] == "excel-task-789"

    def test_export_excel_rejects_regional_encoder(self, client: TestClient):
        """REGIONAL_ENCODER must receive 403 on Excel export."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user("REGIONAL_ENCODER")
        response = client.post("/api/analytics/export/excel", json={
            "filters": {},
            "columns": ["incident_id"],
        })
        assert response.status_code == 403

    # -- AQ-11: Export audit trail ----------------------------------------

    def test_export_creates_audit_log(self, client: TestClient):
        """Every export (CSV/PDF/Excel) must log to analytics_export_log."""
        self._set_analyst(client)
        mock_task = MagicMock()
        mock_task.delay.return_value = MagicMock(id="audit-test-task")

        with patch("api.routes.analytics.export_incidents_csv_task", mock_task):
            response = client.post("/api/analytics/export/csv", json={
                "filters": {"start_date": "2024-01-01"},
                "columns": ["incident_id"],
            })

        assert response.status_code == 200
        # The task must be called with user_id for audit trail
        assert mock_task.delay.called
        call_kwargs = mock_task.delay.call_args[1] or mock_task.delay.call_args[0]
        assert "user_id" in str(call_kwargs)

    def test_export_log_table_exists(self):
        """analytics_export_log table must be defined in migration."""
        # Check that the migration file exists
        import os
        migrations_dir = os.path.join(
            os.path.dirname(__file__), "..", "..", "..", "postgres-init"
        )
        migration_files = os.listdir(migrations_dir) if os.path.isdir(migrations_dir) else []
        has_export_log_migration = any(
            "export_log" in f.lower() for f in migration_files
        )
        # Alternative: check if the model/table is defined
        try:
            from services.analytics_read_model import EXPORT_LOG_TABLE
            assert EXPORT_LOG_TABLE == "analytics_export_log"
        except ImportError:
            assert has_export_log_migration, \
                "analytics_export_log table must exist in postgres-init migrations"


# ===========================================================================
# PHASE 4: Extensions (AQ-12 through AQ-15)
# ===========================================================================

class TestPhase4Extensions:
    """Multi-region, cross-region, top-N, scheduled reports."""

    # -- AQ-12: Multi-region select --------------------------------------

    def test_heatmap_accepts_multiple_region_ids(self, client: TestClient):
        """GET /api/analytics/heatmap must accept comma-separated region_ids."""
        mock_db = _set_analyst(client)
        response = client.get("/api/analytics/heatmap", params={
            "region_ids": "1,2,3",
        })
        assert response.status_code == 200
        call_args = mock_db.execute.call_args
        sql = str(call_args[0][0]) if call_args else ""
        # Must use ANY or IN clause for multi-region
        assert "ANY" in sql.upper() or "IN" in sql.upper(), \
            "Multi-region must use ANY(:ids) or IN clause"

    def test_trends_accepts_multiple_region_ids(self, client: TestClient):
        """GET /api/analytics/trends must accept comma-separated region_ids."""
        mock_db = _set_analyst(client)
        response = client.get("/api/analytics/trends", params={
            "region_ids": "1,5,7",
        })
        assert response.status_code == 200

    def test_region_ids_must_be_valid_integers(self, client: TestClient):
        """region_ids must reject non-integer values."""
        _set_analyst(client)
        response = client.get("/api/analytics/heatmap", params={
            "region_ids": "abc,def",
        })
        assert response.status_code == 422

    # -- AQ-13: Cross-region comparison ----------------------------------

    def test_compare_regions_endpoint_exists(self, client: TestClient):
        """GET /api/analytics/compare-regions must exist and return per-region stats."""
        mock_db = _set_analyst(client)
        mock_db.execute.return_value.fetchall.return_value = [
            (1, "NCR", 120, 12.5, 5, 3, "STRUCTURAL"),
            (2, "Region III", 85, 18.2, 2, 1, "VEHICULAR"),
        ]
        response = client.get("/api/analytics/compare-regions", params={
            "region_ids": "1,2",
            "start_date": "2024-01-01",
            "end_date": "2024-12-31",
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2
        item = data[0]
        assert "region_id" in item
        assert "region_name" in item
        assert "total_incidents" in item
        assert "avg_response_time" in item

    def test_compare_regions_requires_at_least_two_regions(self, client: TestClient):
        """Cross-region comparison must require at least 2 region_ids."""
        _set_analyst(client)
        response = client.get("/api/analytics/compare-regions", params={
            "region_ids": "1",
        })
        assert response.status_code == 422

    def test_compare_regions_rejects_regional_encoder(self, client: TestClient):
        """REGIONAL_ENCODER must receive 403 on compare-regions."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user("REGIONAL_ENCODER")
        response = client.get("/api/analytics/compare-regions", params={
            "region_ids": "1,2",
        })
        assert response.status_code == 403

    # -- AQ-14: Top-N configurable analysis ------------------------------

    def test_top_n_endpoint_exists(self, client: TestClient):
        """GET /api/analytics/top-n must accept metric, dimension, limit."""
        mock_db = _set_analyst(client)
        mock_db.execute.return_value.fetchall.return_value = [
            ("Barangay A", 120),
            ("Barangay B", 95),
        ]
        response = client.get("/api/analytics/top-n", params={
            "metric": "incidents",
            "dimension": "barangay",
            "limit": 10,
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2

    def test_top_n_supports_all_metrics(self, client: TestClient):
        """Top-N must support incidents, response_time, casualties metrics."""
        mock_db = _set_analyst(client)
        mock_db.execute.return_value.fetchall.return_value = []
        for metric in ("incidents", "response_time", "casualties"):
            response = client.get("/api/analytics/top-n", params={
                "metric": metric,
                "dimension": "barangay",
            })
            assert response.status_code == 200, f"metric={metric} must be accepted"

    def test_top_n_supports_all_dimensions(self, client: TestClient):
        """Top-N must support barangay, fire_station, region dimensions."""
        mock_db = _set_analyst(client)
        mock_db.execute.return_value.fetchall.return_value = []
        for dim in ("barangay", "fire_station", "region"):
            response = client.get("/api/analytics/top-n", params={
                "metric": "incidents",
                "dimension": dim,
            })
            assert response.status_code == 200, f"dimension={dim} must be accepted"

    def test_top_n_invalid_metric_rejected(self, client: TestClient):
        """Invalid metric must return 422."""
        _set_analyst(client)
        response = client.get("/api/analytics/top-n", params={
            "metric": "invalid_metric",
            "dimension": "barangay",
        })
        assert response.status_code == 422

    def test_top_n_invalid_dimension_rejected(self, client: TestClient):
        """Invalid dimension must return 422."""
        _set_analyst(client)
        response = client.get("/api/analytics/top-n", params={
            "metric": "incidents",
            "dimension": "invalid_dim",
        })
        assert response.status_code == 422

    def test_top_n_rejects_regional_encoder(self, client: TestClient):
        """REGIONAL_ENCODER must receive 403 on top-n."""
        app.dependency_overrides[auth.get_current_wims_user] = _mock_user("REGIONAL_ENCODER")
        response = client.get("/api/analytics/top-n", params={
            "metric": "incidents",
            "dimension": "barangay",
        })
        assert response.status_code == 403

    # -- AQ-15: Scheduled reports ----------------------------------------

    def test_scheduled_reports_crud_exists(self, client: TestClient):
        """Admin must be able to create/list/delete scheduled reports."""
        app.dependency_overrides[auth.get_system_admin] = _mock_user("SYSTEM_ADMIN")
        mock_db = _set_analyst(client)

        # Create
        response = client.post("/api/admin/scheduled-reports", json={
            "name": "Weekly NCR Report",
            "cron_expr": "0 8 * * 1",
            "format": "pdf",
            "filters": {"region_id": 1},
            "recipients": ["admin@bfp.gov.ph"],
            "enabled": True,
        })
        assert response.status_code in (200, 201)

        # List
        response = client.get("/api/admin/scheduled-reports")
        assert response.status_code == 200

    def test_scheduled_reports_requires_system_admin(self, client: TestClient):
        """Only SYSTEM_ADMIN can manage scheduled reports."""
        for role in ("NATIONAL_ANALYST", "REGIONAL_ENCODER", "NATIONAL_VALIDATOR", "CIVILIAN_REPORTER"):
            app.dependency_overrides[auth.get_current_wims_user] = _mock_user(role)
            response = client.get("/api/admin/scheduled-reports")
            assert response.status_code == 403, f"role={role} must not access scheduled reports"
            app.dependency_overrides.clear()

    def test_scheduled_report_invalid_cron_rejected(self, client: TestClient):
        """Invalid cron expression must be rejected."""
        app.dependency_overrides[auth.get_system_admin] = _mock_user("SYSTEM_ADMIN")
        mock_db = _set_analyst(client)
        response = client.post("/api/admin/scheduled-reports", json={
            "name": "Bad Cron",
            "cron_expr": "not-a-cron",
            "format": "pdf",
            "filters": {},
            "recipients": ["test@test.com"],
            "enabled": True,
        })
        assert response.status_code == 422

    def test_scheduled_report_invalid_format_rejected(self, client: TestClient):
        """Format must be pdf, excel, or csv."""
        app.dependency_overrides[auth.get_system_admin] = _mock_user("SYSTEM_ADMIN")
        mock_db = _set_analyst(client)
        response = client.post("/api/admin/scheduled-reports", json={
            "name": "Bad Format",
            "cron_expr": "0 8 * * *",
            "format": "docx",
            "filters": {},
            "recipients": ["test@test.com"],
            "enabled": True,
        })
        assert response.status_code == 422
