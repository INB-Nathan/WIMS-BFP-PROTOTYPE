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


def test_system_metrics_returns_ai_inference_and_network():
    """GET /api/admin/monitoring/system includes ai_inference and network fields with valid shapes."""
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)
    resp = client.get("/api/admin/monitoring/system")
    assert resp.status_code == 200
    data = resp.json()

    assert "ai_inference" in data
    ai = data["ai_inference"]
    assert "avg_latency_ms" in ai
    assert "count" in ai
    assert isinstance(ai["count"], int) and ai["count"] >= 0
    assert ai["avg_latency_ms"] is None or isinstance(ai["avg_latency_ms"], (int, float))

    assert "network" in data
    net = data["network"]
    assert "bytes_sent" in net
    assert "bytes_recv" in net
    assert isinstance(net["bytes_sent"], int)
    assert isinstance(net["bytes_recv"], int)


def test_system_metrics_ai_inference_populated_from_redis():
    """avg_latency_ms is non-null and count matches when Redis has prior observation data."""
    import unittest.mock as mock

    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)

    mock_r = mock.MagicMock()
    mock_r.get.side_effect = lambda k: b"3" if k == "wims:ai:inference:count" else b"9600.0"

    with mock.patch("redis.from_url", return_value=mock_r):
        resp = client.get("/api/admin/monitoring/system")

    assert resp.status_code == 200
    ai = resp.json()["ai_inference"]
    assert ai["count"] == 3
    assert ai["avg_latency_ms"] == 3200.0  # 9600.0 ms / 3


def test_metrics_endpoint_contains_ai_inference_histogram():
    """GET /metrics includes ai_inference_duration_seconds histogram."""
    client = TestClient(app)
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert "ai_inference_duration_seconds" in resp.text


@pytest.mark.asyncio
async def test_record_inference_metric_observes_prometheus_and_writes_redis():
    """_record_inference_metric calls Prometheus observe() and Redis pipeline execute()."""
    from unittest import mock

    from services.ai_service import _record_inference_metric

    mock_labels = mock.MagicMock()
    mock_pipe = mock.MagicMock()  # incr/incrbyfloat are sync; only execute is async
    mock_pipe.execute = mock.AsyncMock()
    mock_redis = mock.MagicMock()  # pipeline() is sync in redis.asyncio
    mock_redis.pipeline.return_value = mock_pipe
    mock_redis.aclose = mock.AsyncMock()

    with (
        mock.patch("services.ai_service.AI_INFERENCE_DURATION") as mock_hist,
        mock.patch("services.ai_service._get_metrics_redis", return_value=mock_redis),
    ):
        mock_hist.labels.return_value = mock_labels
        await _record_inference_metric("test_fn", 2.5)

    # Prometheus: labels called with function name; observe called with elapsed_s
    mock_hist.labels.assert_called_once_with(function="test_fn")
    mock_labels.observe.assert_called_once_with(2.5)

    # Redis: pipeline created, incr + incrbyfloat + execute called
    mock_redis.pipeline.assert_called_once()
    mock_pipe.incr.assert_called_once_with("wims:ai:inference:count")
    mock_pipe.incrbyfloat.assert_called_once_with("wims:ai:inference:sum_ms", 2500.0)
    mock_pipe.execute.assert_called_once()
    mock_redis.aclose.assert_awaited_once()


def test_system_metrics_network_none_fallback():
    """network bytes_sent/bytes_recv fall back to 0 when psutil.net_io_counters returns None."""
    from unittest import mock

    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)

    with mock.patch("psutil.net_io_counters", return_value=None):
        resp = client.get("/api/admin/monitoring/system")

    assert resp.status_code == 200
    net = resp.json()["network"]
    assert net["bytes_sent"] == 0
    assert net["bytes_recv"] == 0
