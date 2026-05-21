"""Tests for system monitoring endpoints and Prometheus metrics."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from auth import get_current_wims_user
from main import app

_ENCODER_UID = uuid.UUID("11111111-1111-4111-8111-111111111111")
_ADMIN_UID = uuid.UUID("00000000-0000-0000-0000-000000000099")


def _encoder_override():
    return {
        "user_id": _ENCODER_UID,
        "keycloak_id": str(_ENCODER_UID),
        "role": "REGIONAL_ENCODER",
        "assigned_region_id": 1,
    }


def _admin_override():
    return {
        "user_id": _ADMIN_UID,
        "keycloak_id": str(_ADMIN_UID),
        "role": "SYSTEM_ADMIN",
        "assigned_region_id": 1,
    }


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# /metrics endpoint
# ---------------------------------------------------------------------------


def test_metrics_endpoint_returns_200():
    """GET /metrics returns 200 with prometheus text format."""
    client = TestClient(app)
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert "text/plain" in resp.headers.get("content-type", "")


def test_metrics_endpoint_contains_api_duration_metric():
    """GET /metrics response contains api_request_duration_seconds metric."""
    client = TestClient(app)
    resp = client.get("/metrics")
    body = resp.text
    assert "api_request_duration_seconds" in body


def test_metrics_endpoint_contains_system_metrics():
    """GET /metrics response contains system CPU, memory, disk gauges."""
    client = TestClient(app)
    resp = client.get("/metrics")
    body = resp.text
    assert "system_cpu_percent" in body
    assert "system_memory_percent" in body
    assert "system_disk_percent" in body


# ---------------------------------------------------------------------------
# /api/admin/monitoring/workers
# ---------------------------------------------------------------------------


def test_worker_status_requires_admin():
    """GET /api/admin/monitoring/workers returns 403 for non-admin."""
    app.dependency_overrides[get_current_wims_user] = _encoder_override
    client = TestClient(app)
    resp = client.get("/api/admin/monitoring/workers")
    assert resp.status_code == 403


def test_worker_status_returns_list_for_admin():
    """GET /api/admin/monitoring/workers returns 200 with list for admin."""
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)
    resp = client.get("/api/admin/monitoring/workers")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ---------------------------------------------------------------------------
# /api/admin/monitoring/system
# ---------------------------------------------------------------------------


def test_system_metrics_requires_admin():
    """GET /api/admin/monitoring/system returns 403 for non-admin."""
    app.dependency_overrides[get_current_wims_user] = _encoder_override
    client = TestClient(app)
    resp = client.get("/api/admin/monitoring/system")
    assert resp.status_code == 403


def test_system_metrics_returns_cpu_memory_disk():
    """GET /api/admin/monitoring/system returns CPU, memory, disk for admin."""
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)
    resp = client.get("/api/admin/monitoring/system")
    assert resp.status_code == 200
    data = resp.json()

    assert "cpu_percent" in data
    assert "memory" in data
    assert "disk" in data
    assert "memory" in data and "percent" in data["memory"]
    assert "disk" in data and "percent" in data["disk"]

    assert isinstance(data["cpu_percent"], (int, float))
    assert 0 <= data["cpu_percent"] <= 100
    assert isinstance(data["memory"]["percent"], (int, float))
    assert 0 <= data["memory"]["percent"] <= 100
    assert isinstance(data["disk"]["percent"], (int, float))
    assert 0 <= data["disk"]["percent"] <= 100
