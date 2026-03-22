"""
Security-focused integration tests for /api/analytics.

Covers:
- RBAC: only NATIONAL_ANALYST, ANALYST (legacy alias), and SYSTEM_ADMIN may access
- Consistent denial across all analytics routes (no path-specific bypass)
- Unauthenticated requests (dependency chain) yield 401, not 200
- Input validation (422) where applicable; no silent acceptance of invalid interval
- Parameterized SQL: filter values are bound, not concatenated into statement text
- Error responses do not leak stack traces or internal implementation strings
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import auth
from database import get_db
from main import app

COMPARATIVE_PARAMS = {
    "range_a_start": "2024-01-01",
    "range_a_end": "2024-01-31",
    "range_b_start": "2024-02-01",
    "range_b_end": "2024-02-29",
}

# Roles that must never receive analytics data (defense-in-depth matrix).
FORBIDDEN_ANALYTICS_ROLES = (
    "REGIONAL_ENCODER",
    "ENCODER",
    "VALIDATOR",
    "ADMIN",  # legacy; distinct from SYSTEM_ADMIN
)

PRIVILEGED_ANALYTICS_ROLES = ("NATIONAL_ANALYST", "ANALYST", "SYSTEM_ADMIN")


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def _mock_user(role: str):
    async def _fn():
        return {"user_id": "00000000-0000-0000-0000-000000000001", "keycloak_id": "kid", "role": role}

    return _fn


def _mock_analyst_db():
    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchall.return_value = []
    mock_db.execute.return_value = mock_result
    mock_db.execute.return_value.scalar.return_value = 0

    def mock_get_db():
        try:
            yield mock_db
        finally:
            pass

    return mock_db, mock_get_db


def _call_analytics(client: TestClient, method: str, path: str, **kwargs):
    if method == "GET":
        return client.get(path, **kwargs)
    if method == "POST":
        return client.post(path, **kwargs)
    raise ValueError(method)


@pytest.mark.parametrize("role", FORBIDDEN_ANALYTICS_ROLES)
@pytest.mark.parametrize(
    "method,path,request_kwargs",
    [
        ("GET", "/api/analytics/heatmap", {}),
        ("GET", "/api/analytics/trends", {}),
        (
            "GET",
            "/api/analytics/comparative",
            {"params": COMPARATIVE_PARAMS},
        ),
        ("GET", "/api/analytics/execution-plans", {}),
        (
            "POST",
            "/api/analytics/export/csv",
            {"json": {"filters": {}, "columns": ["incident_id"]}},
        ),
    ],
)
def test_analytics_all_routes_reject_forbidden_roles(
    client: TestClient,
    role: str,
    method: str,
    path: str,
    request_kwargs: dict,
):
    """Non-analyst roles must receive 403 on every analytics endpoint (no bypass by path)."""
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user(role)

    response = _call_analytics(client, method, path, **request_kwargs)

    assert response.status_code == 403, f"expected 403 for role={role} {method} {path}"
    body = response.json()
    detail = str(body.get("detail") or "")
    assert "NATIONAL_ANALYST" in detail or "analyst" in detail.lower()
    assert response.headers.get("content-type", "").startswith("application/json")


@pytest.mark.parametrize("role", FORBIDDEN_ANALYTICS_ROLES)
def test_analytics_403_response_has_no_stack_trace_or_sql_leak(client: TestClient, role: str):
    """403 bodies must not expose internal errors or SQL/engine strings."""
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user(role)

    response = client.get("/api/analytics/heatmap")
    assert response.status_code == 403
    text = response.text.lower()
    assert "traceback" not in text
    assert "file \"" not in text
    assert "sqlalchemy" not in text
    assert "postgres" not in text


def test_analytics_rejects_missing_or_invalid_role(client: TestClient):
    """User dict with missing/empty role must not be treated as analyst."""

    async def mock_no_role():
        return {"user_id": "00000000-0000-0000-0000-000000000001", "keycloak_id": "kid"}

    async def mock_empty_role():
        return {"user_id": "00000000-0000-0000-0000-000000000001", "keycloak_id": "kid", "role": ""}

    for mock_fn in (mock_no_role, mock_empty_role):
        app.dependency_overrides[auth.get_current_wims_user] = mock_fn
        assert client.get("/api/analytics/heatmap").status_code == 403
        app.dependency_overrides.clear()


def test_analytics_unauthenticated_yields_401_not_200(client: TestClient):
    """If authentication fails before role resolution, endpoints must not return 200."""

    async def raise_unauthorized():
        raise HTTPException(status_code=401, detail="Authentication credentials missing")

    app.dependency_overrides[auth.get_current_wims_user] = raise_unauthorized

    for path, kwargs in (
        ("/api/analytics/heatmap", {}),
        ("/api/analytics/trends", {}),
        ("/api/analytics/comparative", {"params": COMPARATIVE_PARAMS}),
        ("/api/analytics/execution-plans", {}),
    ):
        r = client.get(path, **kwargs)
        assert r.status_code == 401, path
        assert r.json().get("detail")

    r = client.post(
        "/api/analytics/export/csv",
        json={"filters": {}, "columns": ["incident_id"]},
    )
    assert r.status_code == 401


@pytest.mark.parametrize("role", PRIVILEGED_ANALYTICS_ROLES)
def test_analytics_heatmap_allows_all_privileged_roles(client: TestClient, role: str):
    """NATIONAL_ANALYST, ANALYST alias, and SYSTEM_ADMIN must access heatmap."""
    mock_db, mock_get_db = _mock_analyst_db()
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user(role)
    app.dependency_overrides[get_db] = mock_get_db

    response = client.get("/api/analytics/heatmap")
    assert response.status_code == 200
    assert response.json().get("type") == "FeatureCollection"


def test_analytics_comparative_missing_required_range_params_returns_422(client: TestClient):
    """Comparative endpoint must not run with incomplete query (validation)."""
    mock_db, mock_get_db = _mock_analyst_db()
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("NATIONAL_ANALYST")
    app.dependency_overrides[get_db] = mock_get_db

    response = client.get(
        "/api/analytics/comparative",
        params={
            "range_a_start": "2024-01-01",
            # omit range_a_end, range_b_*
        },
    )
    assert response.status_code == 422


def test_analytics_trends_invalid_interval_rejected(client: TestClient):
    """Trends interval must match allowed enum (injection / abuse hardening)."""
    mock_db, mock_get_db = _mock_analyst_db()
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("NATIONAL_ANALYST")
    app.dependency_overrides[get_db] = mock_get_db

    response = client.get("/api/analytics/trends", params={"interval": "yearly"})
    assert response.status_code == 422


def test_analytics_region_id_non_integer_rejected(client: TestClient):
    """region_id must coerce to int; garbage must not reach SQL as raw string."""
    mock_db, mock_get_db = _mock_analyst_db()
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("NATIONAL_ANALYST")
    app.dependency_overrides[get_db] = mock_get_db

    response = client.get("/api/analytics/heatmap", params={"region_id": "not-an-int"})
    assert response.status_code == 422


def test_heatmap_incident_type_and_alarm_level_passed_as_bound_parameters_not_sql_concat(
    client: TestClient,
):
    """
    Malicious-looking filter strings must be bound as parameters, not spliced into SQL text.
    Prevents classic SQL injection via query parameters.
    """
    mock_db, mock_get_db = _mock_analyst_db()
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("NATIONAL_ANALYST")
    app.dependency_overrides[get_db] = mock_get_db

    malicious = "'; DELETE FROM wims.analytics_incident_facts WHERE '1'='1"
    client.get(
        "/api/analytics/heatmap",
        params={
            "incident_type": malicious,
            "alarm_level": "1' OR '1'='1",
        },
    )

    assert mock_db.execute.called
    call = mock_db.execute.call_args
    sql_fragment = str(call[0][0])
    params = call[0][1] if len(call[0]) > 1 else call[1]

    assert ":incident_type" in sql_fragment
    assert ":alarm_level" in sql_fragment
    assert malicious not in sql_fragment
    assert "DELETE FROM" not in sql_fragment.upper()
    assert isinstance(params, dict)
    assert params.get("incident_type") == malicious
    assert params.get("alarm_level") == "1' OR '1'='1"


def test_comparative_count_in_range_receives_bound_range_strings(client: TestClient):
    """Date range filters for comparative counts must be passed as parameters to the read model."""
    mock_db, mock_get_db = _mock_analyst_db()
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("NATIONAL_ANALYST")
    app.dependency_overrides[get_db] = mock_get_db

    with patch("api.routes.analytics.count_in_range", return_value=0) as mock_count:
        client.get(
            "/api/analytics/comparative",
            params={
                **COMPARATIVE_PARAMS,
                "incident_type": "STRUCTURAL",
                "alarm_level": "2",
            },
        )

    assert mock_count.call_count == 2
    for c in mock_count.call_args_list:
        assert c.args[1] in (COMPARATIVE_PARAMS["range_a_start"], COMPARATIVE_PARAMS["range_b_start"])
        assert c.args[2] in (COMPARATIVE_PARAMS["range_a_end"], COMPARATIVE_PARAMS["range_b_end"])
        assert c.kwargs.get("incident_type") == "STRUCTURAL"
        assert c.kwargs.get("alarm_level") == "2"


def test_export_csv_rejects_forbidden_role_even_with_valid_payload(client: TestClient):
    """POST body must not bypass RBAC — encoder cannot export national analytics."""
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("ENCODER")

    response = client.post(
        "/api/analytics/export/csv",
        json={
            "filters": {"start_date": "2024-01-01", "region_id": 1},
            "columns": ["incident_id", "notification_dt", "alarm_level"],
        },
    )
    assert response.status_code == 403


def test_export_csv_privileged_dispatches_task(client: TestClient):
    """Authorized user: export still requires analyst; task is queued (no raw row leak in response)."""
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("NATIONAL_ANALYST")
    mock_task = MagicMock()
    mock_task.delay.return_value = MagicMock(id="task-secure-1")

    with patch("api.routes.analytics.export_incidents_csv_task", mock_task):
        response = client.post(
            "/api/analytics/export/csv",
            json={"filters": {}, "columns": ["incident_id"]},
        )

    assert response.status_code == 200
    data = response.json()
    assert set(data.keys()) == {"task_id"}
    assert data["task_id"] == "task-secure-1"


def test_execution_plans_requires_same_rbac_as_heatmap(client: TestClient):
    """EXPLAIN / execution-plans must not be weaker than heatmap (information disclosure)."""
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("REGIONAL_ENCODER")
    assert client.get("/api/analytics/execution-plans").status_code == 403

    mock_db, mock_get_db = _mock_analyst_db()
    app.dependency_overrides.clear()
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("SYSTEM_ADMIN")
    app.dependency_overrides[get_db] = mock_get_db

    with patch("api.routes.analytics.verify_indexed_access", return_value={"heatmap": "Seq"}):
        r = client.get("/api/analytics/execution-plans")
    assert r.status_code == 200
