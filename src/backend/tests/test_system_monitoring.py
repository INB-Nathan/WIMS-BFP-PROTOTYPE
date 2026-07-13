"""Tests for system monitoring endpoints and Prometheus metrics."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from auth import get_current_wims_user
from database import get_db
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


def test_worker_status_returns_paginated_for_admin():
    """GET /api/admin/monitoring/workers returns 200 with paginated response for admin."""
    from unittest.mock import MagicMock

    mock_db = MagicMock()
    # First execute: COUNT(*) → scalar() returns 0
    # Second execute: SELECT with LIMIT/OFFSET → fetchall() returns []
    mock_count = MagicMock()
    mock_count.scalar.return_value = 0
    mock_rows = MagicMock()
    mock_rows.fetchall.return_value = []
    mock_db.execute.side_effect = [mock_count, mock_rows]
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)
    resp = client.get("/api/admin/monitoring/workers")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert "limit" in data
    assert "offset" in data
    assert isinstance(data["items"], list)
    assert isinstance(data["total"], int)
    assert data["limit"] == 20  # default
    assert data["offset"] == 0


def test_worker_status_respects_limit_offset():
    """GET /api/admin/monitoring/workers respects limit and offset query params."""
    from unittest.mock import MagicMock

    mock_db = MagicMock()
    mock_count = MagicMock()
    mock_count.scalar.return_value = 0
    mock_rows = MagicMock()
    mock_rows.fetchall.return_value = []
    mock_db.execute.side_effect = [mock_count, mock_rows]
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)
    resp = client.get("/api/admin/monitoring/workers?limit=5&offset=0")
    assert resp.status_code == 200
    data = resp.json()
    assert data["limit"] == 5
    assert data["offset"] == 0
    assert len(data["items"]) <= 5


def test_worker_status_rejects_invalid_limit():
    """GET /api/admin/monitoring/workers returns 422 for invalid limit."""
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)
    resp = client.get("/api/admin/monitoring/workers?limit=0")
    assert resp.status_code == 422


def test_worker_status_rejects_excessive_limit():
    """GET /api/admin/monitoring/workers returns 422 for limit > 200."""
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)
    resp = client.get("/api/admin/monitoring/workers?limit=999")
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# /api/admin/monitoring/workers/prune
# ---------------------------------------------------------------------------


class TestWorkerPrune:
    """Suite: POST /admin/monitoring/workers/prune — retention, protection, audit."""

    @pytest.fixture(autouse=True)
    def _setup_overrides(self):
        app.dependency_overrides[get_current_wims_user] = _admin_override
        # We'll provide a fresh DB session manually, so override get_db
        # but the test methods set up their own override as needed.
        yield
        app.dependency_overrides.clear()

    def test_prune_requires_admin(self):
        """POST /api/admin/monitoring/workers/prune returns 403 for non-admin."""
        app.dependency_overrides[get_current_wims_user] = _encoder_override
        client = TestClient(app)
        resp = client.post("/api/admin/monitoring/workers/prune")
        assert resp.status_code == 403

    def test_prune_deletes_only_old_offline(self, monkeypatch):
        """Prune only deletes OFFLINE rows older than retention threshold."""
        from unittest import mock

        now = datetime.now(timezone.utc)
        now - timedelta(days=9)
        now - timedelta(days=3)

        mock_db = mock.MagicMock()

        # First execute call: config fetch → returns None (use default 7)
        config_result = mock.MagicMock()
        config_result.fetchone.return_value = None

        # Second execute call: DELETE → rowcount = 1
        delete_result = mock.MagicMock()
        delete_result.rowcount = 1

        mock_db.execute.side_effect = [config_result, delete_result]

        # Override get_db to return our mock
        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_current_wims_user] = _admin_override

        # Patch log_system_audit to avoid real DB writes
        with mock.patch("api.routes.admin.monitoring.log_system_audit") as mock_audit:
            client = TestClient(app)
            resp = client.post("/api/admin/monitoring/workers/prune")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["deleted_count"] == 1
        assert data["retention_days"] == 7

        # Verify DELETE was called only for OFFLINE with retention
        # Second execute call should be the DELETE
        delete_calls = [
            c
            for c in mock_db.execute.call_args_list
            if "DELETE FROM wims.worker_heartbeat" in str(c[0][0])
        ]
        assert len(delete_calls) == 1
        delete_sql = str(delete_calls[0][0][0])
        assert "OFFLINE" in delete_sql
        # Check bound params (parameterized query)
        assert delete_calls[0][0][1]["retention_days"] == "7"

        # Audit was called
        mock_audit.assert_called_once()
        audit_kwargs = mock_audit.call_args[1]
        assert audit_kwargs["action_type"] == "WORKER_PRUNE"
        assert audit_kwargs["table_affected"] == "worker_heartbeat"
        assert audit_kwargs["new_values"]["deleted_count"] == 1
        assert audit_kwargs["new_values"]["retention_days"] == 7

    def test_prune_uses_config_retention_days(self, monkeypatch):
        """Prune reads retention days from system_config when set to non-default."""
        from unittest import mock

        mock_db = mock.MagicMock()

        # First execute call: config fetch returns row with value '14'
        config_result = mock.MagicMock()
        config_result.fetchone.return_value = ("14",)

        # Second execute call: DELETE → rowcount = 3
        delete_result = mock.MagicMock()
        delete_result.rowcount = 3

        mock_db.execute.side_effect = [config_result, delete_result]

        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_current_wims_user] = _admin_override

        with mock.patch("api.routes.admin.monitoring.log_system_audit"):
            client = TestClient(app)
            resp = client.post("/api/admin/monitoring/workers/prune")

        assert resp.status_code == 200
        data = resp.json()
        assert data["retention_days"] == 14
        assert data["deleted_count"] == 3

        # Verify DELETE uses retention_days=14 in bound params
        delete_calls = [
            c
            for c in mock_db.execute.call_args_list
            if "DELETE FROM wims.worker_heartbeat" in str(c[0][0])
        ]
        assert len(delete_calls) == 1
        assert delete_calls[0][0][1]["retention_days"] == "14"

    def test_prune_rejects_invalid_config_defaults_to_7(self, monkeypatch):
        """Prune falls back to 7 days when config value is invalid."""
        from unittest import mock

        mock_db = mock.MagicMock()

        # First execute call: config fetch returns non-numeric value
        config_result = mock.MagicMock()
        config_result.fetchone.return_value = ("not-a-number",)

        # Second execute call: DELETE → rowcount = 0
        delete_result = mock.MagicMock()
        delete_result.rowcount = 0

        mock_db.execute.side_effect = [config_result, delete_result]

        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_current_wims_user] = _admin_override

        with mock.patch("api.routes.admin.monitoring.log_system_audit"):
            client = TestClient(app)
            resp = client.post("/api/admin/monitoring/workers/prune")

        assert resp.status_code == 200
        data = resp.json()
        assert data["retention_days"] == 7  # fallback

    def test_prune_audit_includes_request_metadata(self, monkeypatch):
        """Prune audit log includes client IP and user agent from request."""
        from unittest import mock

        mock_db = mock.MagicMock()

        # First execute call: config fetch → None (default 7)
        config_result = mock.MagicMock()
        config_result.fetchone.return_value = None

        # Second execute call: DELETE → rowcount = 0
        delete_result = mock.MagicMock()
        delete_result.rowcount = 0

        mock_db.execute.side_effect = [config_result, delete_result]

        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_current_wims_user] = _admin_override

        with mock.patch("api.routes.admin.monitoring.log_system_audit") as mock_audit:
            client = TestClient(app)
            resp = client.post(
                "/api/admin/monitoring/workers/prune",
                headers={"User-Agent": "TestAgent/1.0", "X-Forwarded-For": "10.0.0.1"},
            )

        assert resp.status_code == 200
        mock_audit.assert_called_once()
        # The request object should be passed
        call_kwargs = mock_audit.call_args[1]
        assert call_kwargs["request"] is not None


# ---------------------------------------------------------------------------
# Auto-prune in tasks/monitoring.py worker_heartbeat
# ---------------------------------------------------------------------------


class TestWorkerHeartbeatAutoPrune:
    """Suite: worker_heartbeat Celery task auto-prunes old OFFLINE rows."""

    def test_auto_prune_deletes_old_offline_rows(self):
        """worker_heartbeat task prunes OFFLINE rows older than retention days."""
        from unittest import mock
        from tasks.monitoring import worker_heartbeat

        mock_session = mock.MagicMock()

        # Execute call order in worker_heartbeat() after PR #375:
        # 0. _read_worker_timeout_config → fetchall() (use defaults 60/300)
        # 1. INSERT
        # 2. UPDATE STALE
        # 3. UPDATE OFFLINE
        # 4. SELECT worker_heartbeat_retention_days → fetchone()
        # 5. DELETE

        call_results = []

        def _make_result(rowcount=0):
            r = mock.MagicMock()
            r.rowcount = rowcount
            return r

        # 0. Timeout config fetch → empty list (defaults 60/300)
        timeout_cfg = mock.MagicMock()
        timeout_cfg.fetchall.return_value = []
        call_results.append(timeout_cfg)
        # 1. INSERT
        call_results.append(_make_result(1))
        # 2. UPDATE STALE
        call_results.append(_make_result(0))
        # 3. UPDATE OFFLINE
        call_results.append(_make_result(0))
        # 4. Retention config fetch
        config_fetch = mock.MagicMock()
        config_fetch.fetchone.return_value = None  # config key absent, use default 7
        call_results.append(config_fetch)
        # 5. DELETE (2 rows pruned)
        call_results.append(_make_result(2))

        mock_session.execute.side_effect = call_results

        with mock.patch("tasks.monitoring.get_session", return_value=mock_session):
            with mock.patch("tasks.monitoring.log_system_audit") as mock_audit:
                with mock.patch("tasks.monitoring.publish_system_event_sync") as mock_publish:
                    result = worker_heartbeat()

        assert result == 1
        assert mock_session.commit.called

        # Verify DELETE was called for old OFFLINE (6th execute call, index 5)
        delete_calls = [
            c
            for c in mock_session.execute.call_args_list
            if "DELETE FROM wims.worker_heartbeat" in str(c[0][0])
        ]
        assert len(delete_calls) == 1
        delete_sql = str(delete_calls[0][0][0])
        assert "OFFLINE" in delete_sql
        # Check bound params (parameterized query with :retention_days)
        assert delete_calls[0][0][1]["retention_days"] == "7"

        # Audit was called for the prune
        mock_audit.assert_called_once()
        audit_kwargs = mock_audit.call_args[1]
        assert audit_kwargs["action_type"] == "WORKER_PRUNE_AUTO"
        assert audit_kwargs["new_values"]["deleted_count"] == 2

        # system.worker_status fires since rows were pruned
        mock_publish.assert_called_once()
        assert mock_publish.call_args[0][0] == "system.worker_status"

    def test_auto_prune_skips_audit_when_nothing_deleted(self):
        """worker_heartbeat does not audit-log when no rows are deleted."""
        from unittest import mock
        from tasks.monitoring import worker_heartbeat

        mock_session = mock.MagicMock()

        call_results = []
        # 0. Timeout config fetch → empty (defaults)
        timeout_cfg = mock.MagicMock()
        timeout_cfg.fetchall.return_value = []
        call_results.append(timeout_cfg)
        call_results.append(mock.MagicMock())  # INSERT
        stale_result = mock.MagicMock()
        stale_result.rowcount = 0
        call_results.append(stale_result)  # STALE — no transitions
        offline_result = mock.MagicMock()
        offline_result.rowcount = 0
        call_results.append(offline_result)  # OFFLINE — no transitions
        config_fetch = mock.MagicMock()
        config_fetch.fetchone.return_value = None
        call_results.append(config_fetch)
        r = mock.MagicMock()
        r.rowcount = 0
        call_results.append(r)  # DELETE

        mock_session.execute.side_effect = call_results

        with mock.patch("tasks.monitoring.get_session", return_value=mock_session):
            with mock.patch("tasks.monitoring.log_system_audit") as mock_audit:
                with mock.patch("tasks.monitoring.publish_system_event_sync") as mock_publish:
                    result = worker_heartbeat()

        assert result == 1
        # No audit when nothing deleted
        mock_audit.assert_not_called()
        # No status change and nothing pruned → no event
        mock_publish.assert_not_called()

    def test_auto_prune_respects_config_retention(self):
        """Auto-prune reads retention days from system_config."""
        from unittest import mock
        from tasks.monitoring import worker_heartbeat

        mock_session = mock.MagicMock()

        call_results = []
        # 0. Timeout config fetch → empty (defaults)
        timeout_cfg = mock.MagicMock()
        timeout_cfg.fetchall.return_value = []
        call_results.append(timeout_cfg)
        call_results.append(mock.MagicMock())  # INSERT
        stale_result = mock.MagicMock()
        stale_result.rowcount = 0
        call_results.append(stale_result)  # STALE
        offline_result = mock.MagicMock()
        offline_result.rowcount = 0
        call_results.append(offline_result)  # OFFLINE
        config_fetch = mock.MagicMock()
        config_fetch.fetchone.return_value = ("3",)  # config value = 3 days
        call_results.append(config_fetch)
        r = mock.MagicMock()
        r.rowcount = 5
        call_results.append(r)  # DELETE

        mock_session.execute.side_effect = call_results

        with mock.patch("tasks.monitoring.get_session", return_value=mock_session):
            with mock.patch("tasks.monitoring.log_system_audit"):
                with mock.patch("tasks.monitoring.publish_system_event_sync") as mock_publish:
                    worker_heartbeat()

        # Rows were pruned → event fires
        mock_publish.assert_called_once()

        # Verify DELETE uses retention_days=3 in bound params
        delete_calls = [
            c
            for c in mock_session.execute.call_args_list
            if "DELETE FROM wims.worker_heartbeat" in str(c[0][0])
        ]
        assert len(delete_calls) == 1
        assert delete_calls[0][0][1]["retention_days"] == "3"


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


# ---------------------------------------------------------------------------
# Worker timeout config consumer (#354) — _read_worker_timeout_config
# ---------------------------------------------------------------------------


class TestReadWorkerTimeoutConfig:
    """Verify _read_worker_timeout_config reads from system_config with safe fallback."""

    def test_returns_defaults_when_config_table_empty(self):
        """Empty config table returns (60, 300) defaults."""
        from unittest import mock
        from tasks.monitoring import _read_worker_timeout_config

        mock_db = mock.MagicMock()
        mock_result = mock.MagicMock()
        mock_result.fetchall.return_value = []
        mock_db.execute.return_value = mock_result

        stale, offline = _read_worker_timeout_config(mock_db)
        assert stale == 60
        assert offline == 300

    def test_returns_configured_values(self):
        """Returns configured values when both keys are present."""
        from unittest import mock
        from tasks.monitoring import _read_worker_timeout_config

        mock_db = mock.MagicMock()
        mock_result = mock.MagicMock()
        mock_result.fetchall.return_value = [
            ("worker_stale_timeout_seconds", "45"),
            ("worker_offline_timeout_seconds", "600"),
        ]
        mock_db.execute.return_value = mock_result

        stale, offline = _read_worker_timeout_config(mock_db)
        assert stale == 45
        assert offline == 600

    def test_falls_back_when_offline_le_stale(self):
        """When offline <= stale, fall back to defaults (60, 300)."""
        from unittest import mock
        from tasks.monitoring import _read_worker_timeout_config

        mock_db = mock.MagicMock()
        mock_result = mock.MagicMock()
        mock_result.fetchall.return_value = [
            ("worker_stale_timeout_seconds", "100"),
            ("worker_offline_timeout_seconds", "80"),
        ]
        mock_db.execute.return_value = mock_result

        stale, offline = _read_worker_timeout_config(mock_db)
        assert stale == 60
        assert offline == 300

    def test_falls_back_when_values_equal(self):
        """When offline == stale, fall back to defaults (60, 300)."""
        from unittest import mock
        from tasks.monitoring import _read_worker_timeout_config

        mock_db = mock.MagicMock()
        mock_result = mock.MagicMock()
        mock_result.fetchall.return_value = [
            ("worker_stale_timeout_seconds", "120"),
            ("worker_offline_timeout_seconds", "120"),
        ]
        mock_db.execute.return_value = mock_result

        stale, offline = _read_worker_timeout_config(mock_db)
        assert stale == 60
        assert offline == 300

    def test_ignores_malformed_config_values(self):
        """Non-numeric config values are ignored; defaults used for those keys."""
        from unittest import mock
        from tasks.monitoring import _read_worker_timeout_config

        mock_db = mock.MagicMock()
        mock_result = mock.MagicMock()
        mock_result.fetchall.return_value = [
            ("worker_stale_timeout_seconds", "not_a_number"),
            ("worker_offline_timeout_seconds", "300"),
        ]
        mock_db.execute.return_value = mock_result

        stale, offline = _read_worker_timeout_config(mock_db)
        # stale falls back to 60 (malformed); offline is 300; 300 > 60 is valid
        assert stale == 60
        assert offline == 300

    def test_falls_back_on_db_exception(self):
        """If the DB query raises, return safe defaults (60, 300)."""
        from unittest import mock
        from tasks.monitoring import _read_worker_timeout_config

        mock_db = mock.MagicMock()
        mock_db.execute.side_effect = RuntimeError("DB connection lost")

        stale, offline = _read_worker_timeout_config(mock_db)
        assert stale == 60
        assert offline == 300


# ---------------------------------------------------------------------------
# /api/admin/monitoring/health — Suricata EVE log mtime heartbeat (GH #364)
# ---------------------------------------------------------------------------


def _make_mock_db(recent: int = 0, total: int = 0):
    """Build a mock DB session whose execute().scalar() returns recent then total.

    The first execute() call is always the DB health check (SELECT 1), so we
    prepend a scalar value of 1 for it.
    """
    from unittest import mock

    db = mock.MagicMock()
    # First execute() = DB health SELECT 1, then suricata recent, then suricata total
    scalar_returns = [1, recent, total]

    def _execute_side_effect(*_args, **_kwargs):
        result = mock.MagicMock()
        result.scalar.return_value = scalar_returns.pop(0) if scalar_returns else 0
        return result

    db.execute.side_effect = _execute_side_effect
    return db


def _health_mocks(mock_db, *, mtime=100.0, mtime_error=None, time_now=None):
    """Set up the standard mocks for health endpoint tests.

    Returns a context-manager stack that patches:
    - os.path.getmtime (Suricata heartbeat)
    - time.time (for consistent mtime age calculations)
    - redis.from_url (prevents real Redis connection attempts)
    - services.keycloak_admin._get_admin_client (prevents real Keycloak attempts)
    - httpx.Client (prevents real Ollama connection attempts)
    """
    from unittest import mock

    patches = []

    # Mock EVE log mtime
    if mtime_error:
        patches.append(mock.patch("os.path.getmtime", side_effect=mtime_error))
    else:
        patches.append(mock.patch("os.path.getmtime", return_value=mtime))

    # Mock time
    if time_now is not None:
        patches.append(mock.patch("time.time", return_value=time_now))

    # Mock Redis — make ping() succeed so it doesn't hang
    mock_redis = mock.MagicMock()
    mock_redis.ping.return_value = True
    patches.append(mock.patch("redis.from_url", return_value=mock_redis))

    # Mock Keycloak admin client
    mock_kc = mock.MagicMock()
    mock_kc.users_count.return_value = 5
    patches.append(mock.patch("services.keycloak_admin._get_admin_client", return_value=mock_kc))

    # Mock Ollama HTTP client — make it raise so it falls through gracefully
    mock_httpx = mock.MagicMock()
    mock_httpx.get.side_effect = Exception("mock ollama unavailable")
    patches.append(mock.patch("httpx.Client", return_value=mock_httpx))

    # Override DB dependency
    app.dependency_overrides[get_db] = lambda: mock_db

    return patches


def test_suricata_healthy_with_recent_alerts():
    """Recent threats > 0 → HEALTHY with 'alerting' detail."""
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)

    mock_db = _make_mock_db(recent=3, total=50)
    patches = _health_mocks(mock_db)
    for p in patches:
        p.start()

    try:
        resp = client.get("/api/admin/health")
    finally:
        for p in reversed(patches):
            p.stop()

    assert resp.status_code == 200
    suricata = resp.json()["components"]["suricata"]
    assert suricata["status"] == "HEALTHY"
    assert "alerting" in suricata["detail"]


def test_suricata_quiet_fresh_mtime_no_recent_threats():
    """EVE mtime < 60s old, 0 recent, total > 0 → QUIET."""
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)

    mock_db = _make_mock_db(recent=0, total=100)
    # mtime=170, now=200 → 30s old (< 60)
    patches = _health_mocks(mock_db, mtime=170.0, time_now=200.0)
    for p in patches:
        p.start()

    try:
        resp = client.get("/api/admin/health")
    finally:
        for p in reversed(patches):
            p.stop()

    assert resp.status_code == 200
    suricata = resp.json()["components"]["suricata"]
    assert suricata["status"] == "QUIET"
    assert "no recent alerts" in suricata["detail"]


def test_suricata_fresh_deployment_no_threat_data():
    """Total = 0 → FRESH regardless of mtime."""
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)

    mock_db = _make_mock_db(recent=0, total=0)
    patches = _health_mocks(mock_db)
    for p in patches:
        p.start()

    try:
        resp = client.get("/api/admin/health")
    finally:
        for p in reversed(patches):
            p.stop()

    assert resp.status_code == 200
    suricata = resp.json()["components"]["suricata"]
    assert suricata["status"] == "FRESH"
    assert "no threat data yet" in suricata["detail"]


def test_suricata_degraded_stale_mtime_with_total():
    """EVE mtime 60-600s old, 0 recent, total > 0 → DEGRADED."""
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)

    mock_db = _make_mock_db(recent=0, total=200)
    # mtime=50, now=200 → 150s old (between 60 and 600)
    patches = _health_mocks(mock_db, mtime=50.0, time_now=200.0)
    for p in patches:
        p.start()

    try:
        resp = client.get("/api/admin/health")
    finally:
        for p in reversed(patches):
            p.stop()

    assert resp.status_code == 200
    suricata = resp.json()["components"]["suricata"]
    assert suricata["status"] == "DEGRADED"
    assert "EVE log is" in suricata["detail"]


def test_suricata_unhealthy_very_stale_mtime():
    """EVE mtime > 600s old, 0 recent, total > 0 → UNHEALTHY."""
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)

    mock_db = _make_mock_db(recent=0, total=200)
    # mtime=50, now=1000 → 950s old (> 600)
    patches = _health_mocks(mock_db, mtime=50.0, time_now=1000.0)
    for p in patches:
        p.start()

    try:
        resp = client.get("/api/admin/health")
    finally:
        for p in reversed(patches):
            p.stop()

    assert resp.status_code == 200
    suricata = resp.json()["components"]["suricata"]
    assert suricata["status"] == "UNHEALTHY"
    assert "stalled" in suricata["detail"]


def test_suricata_unhealthy_query_failure():
    """DB query raises → UNHEALTHY with error, overall status DEGRADED."""
    from unittest import mock

    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)

    mock_db = mock.MagicMock()
    mock_db.execute.side_effect = RuntimeError("DB connection lost")
    patches = _health_mocks(mock_db)
    for p in patches:
        p.start()

    try:
        resp = client.get("/api/admin/health")
    finally:
        for p in reversed(patches):
            p.stop()

    assert resp.status_code == 200
    data = resp.json()
    suricata = data["components"]["suricata"]
    assert suricata["status"] == "UNHEALTHY"
    assert "DB connection lost" in suricata["error"]
    assert data["status"] == "DEGRADED"


def test_suricata_health_uses_configured_eve_log_path(monkeypatch):
    """SURICATA_EVE_PATH controls the EVE heartbeat path used by admin health."""
    from unittest import mock

    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)

    mock_db = _make_mock_db(recent=0, total=100)
    monkeypatch.setenv("SURICATA_EVE_PATH", "/mounted/suricata/eve.json")
    patches = _health_mocks(mock_db, mtime=170.0, time_now=200.0)
    getmtime = mock.MagicMock(return_value=170.0)
    patches[0] = mock.patch("os.path.getmtime", getmtime)
    for p in patches:
        p.start()

    try:
        resp = client.get("/api/admin/health")
    finally:
        for p in reversed(patches):
            p.stop()

    assert resp.status_code == 200
    getmtime.assert_called_once_with("/mounted/suricata/eve.json")
    suricata = resp.json()["components"]["suricata"]
    assert suricata["status"] == "QUIET"


class _StatefulFakeRedis:
    """Minimal stateful fake standing in for the last-known-health-status key."""

    def __init__(self):
        self.store: dict[str, bytes] = {}

    def ping(self):
        return True

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value):
        self.store[key] = value.encode() if isinstance(value, str) else value


def _all_components_healthy_patches(mock_db, fake_redis):
    """Patch every external health-check dependency to succeed, so overall
    status is HEALTHY. Deliberately does NOT reuse `_health_mocks`, which
    hardcodes an Ollama failure (making overall status permanently DEGRADED)
    — this test needs a real HEALTHY↔DEGRADED transition to observe."""
    import time
    from unittest import mock

    patches = [
        mock.patch("os.path.getmtime", return_value=time.time()),
        mock.patch("redis.from_url", return_value=fake_redis),
    ]

    mock_kc = mock.MagicMock()
    mock_kc.users_count.return_value = 5
    patches.append(mock.patch("services.keycloak_admin._get_admin_client", return_value=mock_kc))

    mock_response = mock.MagicMock()
    mock_response.status_code = 200
    mock_httpx_ctx = mock.MagicMock()
    mock_httpx_ctx.__enter__.return_value.get.return_value = mock_response
    patches.append(mock.patch("httpx.Client", return_value=mock_httpx_ctx))

    app.dependency_overrides[get_db] = lambda: mock_db
    return patches


def test_health_changed_event_fires_only_on_status_transition():
    """system.health_changed is published only when overall status changes,
    never on the first-ever check, and never when status is unchanged."""
    from unittest import mock

    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)
    fake_redis = _StatefulFakeRedis()

    with mock.patch("api.routes.admin.monitoring.publish_system_event_sync") as mock_publish:
        # 1st check: every component healthy (total=0 → suricata FRESH, which
        # does not degrade overall status). No prior Redis value yet, so no
        # event should fire even though this is technically a "change" from
        # nothing to HEALTHY.
        mock_db = _make_mock_db(recent=0, total=0)
        patches = _all_components_healthy_patches(mock_db, fake_redis)
        for p in patches:
            p.start()
        try:
            resp1 = client.get("/api/admin/health")
        finally:
            for p in reversed(patches):
                p.stop()
        assert resp1.status_code == 200
        assert resp1.json()["status"] == "HEALTHY"
        mock_publish.assert_not_called()

        # 2nd check with the same status: no event should fire (no transition).
        mock_db = _make_mock_db(recent=0, total=0)
        patches = _all_components_healthy_patches(mock_db, fake_redis)
        for p in patches:
            p.start()
        try:
            resp2 = client.get("/api/admin/health")
        finally:
            for p in reversed(patches):
                p.stop()
        assert resp2.json()["status"] == "HEALTHY"
        mock_publish.assert_not_called()

        # 3rd check with a DB failure → DEGRADED: status changed, event should fire.
        mock_db = mock.MagicMock()
        mock_db.execute.side_effect = RuntimeError("DB connection lost")
        patches = _all_components_healthy_patches(mock_db, fake_redis)
        for p in patches:
            p.start()
        try:
            resp3 = client.get("/api/admin/health")
        finally:
            for p in reversed(patches):
                p.stop()
        assert resp3.json()["status"] == "DEGRADED"
        mock_publish.assert_called_once_with(
            "system.health_changed",
            {"status": "DEGRADED", "previous_status": "HEALTHY"},
        )


def test_suricata_unhealthy_eve_log_unreadable():
    """EVE log file not accessible → UNHEALTHY with OS error detail."""
    app.dependency_overrides[get_current_wims_user] = _admin_override
    client = TestClient(app)

    mock_db = _make_mock_db(recent=0, total=50)
    patches = _health_mocks(mock_db, mtime_error=OSError("No such file"))
    for p in patches:
        p.start()

    try:
        resp = client.get("/api/admin/health")
    finally:
        for p in reversed(patches):
            p.stop()

    assert resp.status_code == 200
    suricata = resp.json()["components"]["suricata"]
    assert suricata["status"] == "UNHEALTHY"
    assert "cannot access EVE log" in suricata["detail"]
    assert "No such file" in suricata["detail"]
