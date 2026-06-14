"""
Integration tests: M8 anomaly ACK/RESOLVE API endpoints.

Tests the GET /api/admin/anomalies and PATCH /api/admin/anomalies/{id} routes
with mock DB sessions — no running database required.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import auth
from main import app

_NOW = datetime(2026, 6, 14, 10, 0, 0, tzinfo=timezone.utc)


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


def _mock_admin_user():
    """Return a SYSTEM_ADMIN user dict."""
    return {
        "user_id": "00000000-0000-0000-0000-000000000001",
        "keycloak_id": "kid",
        "username": "admin",
        "role": "SYSTEM_ADMIN",
    }


def _make_anomaly_row(
    anomaly_id=1,
    anomaly_type="BULK_DELETE",
    severity="HIGH",
    status="NEW",
    details=None,
    detected_at=None,
):
    """Return a tuple matching the SELECT column order in the anomalies API.

    GET /anomalies SELECT order: anomaly_id, anomaly_type, subject_user_id,
                                severity, details, detected_at, status, dedup_key
    PATCH /anomalies SELECT order: anomaly_id, anomaly_type, severity, status,
                                   subject_user_id
    """
    details = details or {"count": 12}
    detected_at = detected_at or _NOW
    return (
        anomaly_id,
        anomaly_type,
        "aaaaaaaa-0000-4000-8000-000000000001",  # subject_user_id
        severity,
        json.dumps(details),
        detected_at,
        status,
        f"{anomaly_type}:test:{anomaly_id}",
    )


def _make_patch_row(anomaly_id=1, anomaly_type="BULK_DELETE", severity="HIGH", status="NEW"):
    """Return a tuple matching the PATCH SELECT column order.

    SELECT anomaly_id, anomaly_type, severity, status, subject_user_id
    """
    return (
        anomaly_id,
        anomaly_type,
        severity,
        status,
        "aaaaaaaa-0000-4000-8000-000000000001",  # subject_user_id
    )


# ---------------------------------------------------------------------------
# GET /api/admin/anomalies
# ---------------------------------------------------------------------------


class TestListAnomalies:
    def test_non_admin_rejected(self, client):
        """REGIONAL_ENCODER must get 403."""

        async def _mock_encoder():
            return {"user_id": "uuid", "role": "REGIONAL_ENCODER"}

        app.dependency_overrides[auth.get_current_wims_user] = _mock_encoder

        resp = client.get("/api/admin/anomalies")
        assert resp.status_code == 403

    def test_empty_list(self, client):
        """Return empty items when no anomalies exist."""

        async def _admin():
            return _mock_admin_user()

        mock_db = MagicMock()
        mock_fetch = MagicMock()
        mock_fetch.fetchall.return_value = []
        mock_db.execute.return_value = mock_fetch
        # Second call (COUNT) also returns 0
        mock_db.execute.side_effect = [mock_fetch, MagicMock(scalar=MagicMock(return_value=0))]

        def _get_db():
            try:
                yield mock_db
            finally:
                pass

        app.dependency_overrides[auth.get_current_wims_user] = _admin
        app.dependency_overrides[auth.get_system_admin] = _admin
        app.dependency_overrides[auth.get_db_with_rls] = _get_db

        resp = client.get("/api/admin/anomalies")
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_with_items(self, client):
        """Return paginated anomaly items."""

        async def _admin():
            return _mock_admin_user()

        mock_db = MagicMock()
        fetch_result = MagicMock()
        fetch_result.fetchall.return_value = [_make_anomaly_row(1)]
        count_result = MagicMock()
        count_result.scalar.return_value = 5
        mock_db.execute.side_effect = [fetch_result, count_result]

        def _get_db():
            try:
                yield mock_db
            finally:
                pass

        app.dependency_overrides[auth.get_current_wims_user] = _admin
        app.dependency_overrides[auth.get_system_admin] = _admin
        app.dependency_overrides[auth.get_db_with_rls] = _get_db

        resp = client.get("/api/admin/anomalies")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 5
        assert len(data["items"]) == 1
        item = data["items"][0]
        assert item["anomaly_id"] == 1
        assert item["anomaly_type"] == "BULK_DELETE"
        assert item["severity"] == "HIGH"
        assert item["status"] == "NEW"

    def test_status_filter(self, client):
        """Filter by status=ACKNOWLEDGED."""

        async def _admin():
            return _mock_admin_user()

        mock_db = MagicMock()
        fetch_result = MagicMock()
        ack_row = _make_anomaly_row(2, "OFF_HOURS", "MEDIUM", "ACKNOWLEDGED")
        fetch_result.fetchall.return_value = [ack_row]
        count_result = MagicMock()
        count_result.scalar.return_value = 1
        mock_db.execute.side_effect = [fetch_result, count_result]

        def _get_db():
            try:
                yield mock_db
            finally:
                pass

        app.dependency_overrides[auth.get_current_wims_user] = _admin
        app.dependency_overrides[auth.get_system_admin] = _admin
        app.dependency_overrides[auth.get_db_with_rls] = _get_db

        resp = client.get("/api/admin/anomalies?status=ACKNOWLEDGED")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["status"] == "ACKNOWLEDGED"

        # Verify SQL includes status filter
        executed_sql = str(mock_db.execute.call_args_list[0][0][0])
        assert "status" in executed_sql.lower()

    def test_type_filter(self, client):
        """Filter by anomaly_type=RAPID_IP_SWITCH."""

        async def _admin():
            return _mock_admin_user()

        mock_db = MagicMock()
        fetch_result = MagicMock()
        ip_row = _make_anomaly_row(
            3,
            "RAPID_IP_SWITCH",
            "MEDIUM",
            details={"distinct_ip_count": 2, "ips": ["1.1.1.1", "2.2.2.2"]},
        )
        fetch_result.fetchall.return_value = [ip_row]
        count_result = MagicMock()
        count_result.scalar.return_value = 1
        mock_db.execute.side_effect = [fetch_result, count_result]

        def _get_db():
            try:
                yield mock_db
            finally:
                pass

        app.dependency_overrides[auth.get_current_wims_user] = _admin
        app.dependency_overrides[auth.get_system_admin] = _admin
        app.dependency_overrides[auth.get_db_with_rls] = _get_db

        resp = client.get("/api/admin/anomalies?anomaly_type=RAPID_IP_SWITCH")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["anomaly_type"] == "RAPID_IP_SWITCH"

    def test_pagination_offset(self, client):
        """Verify limit and offset are passed through."""

        async def _admin():
            return _mock_admin_user()

        mock_db = MagicMock()
        fetch_result = MagicMock()
        fetch_result.fetchall.return_value = []
        count_result = MagicMock()
        count_result.scalar.return_value = 100
        mock_db.execute.side_effect = [fetch_result, count_result]

        def _get_db():
            try:
                yield mock_db
            finally:
                pass

        app.dependency_overrides[auth.get_current_wims_user] = _admin
        app.dependency_overrides[auth.get_system_admin] = _admin
        app.dependency_overrides[auth.get_db_with_rls] = _get_db

        resp = client.get("/api/admin/anomalies?limit=10&offset=20")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 100
        # Verify SQL received correct params
        first_call_params = mock_db.execute.call_args_list[0][0][1]
        assert first_call_params["limit"] == 10
        assert first_call_params["offset"] == 20


# ---------------------------------------------------------------------------
# PATCH /api/admin/anomalies/{anomaly_id}
# ---------------------------------------------------------------------------


class TestUpdateAnomalyStatus:
    def test_non_admin_rejected(self, client):
        """REGIONAL_ENCODER must get 403."""

        async def _mock_encoder():
            return {"user_id": "uuid", "role": "REGIONAL_ENCODER"}

        app.dependency_overrides[auth.get_current_wims_user] = _mock_encoder

        resp = client.patch("/api/admin/anomalies/1", json={"status": "ACKNOWLEDGED"})
        assert resp.status_code == 403

    def test_not_found(self, client):
        """Nonexistent anomaly_id returns 404."""

        async def _admin():
            return _mock_admin_user()

        mock_db = MagicMock()
        mock_db.execute.return_value.fetchone.return_value = None

        def _get_db():
            try:
                yield mock_db
            finally:
                pass

        app.dependency_overrides[auth.get_current_wims_user] = _admin
        app.dependency_overrides[auth.get_system_admin] = _admin
        app.dependency_overrides[auth.get_db_with_rls] = _get_db

        resp = client.patch("/api/admin/anomalies/9999", json={"status": "ACKNOWLEDGED"})
        assert resp.status_code == 404

    def test_invalid_status_value(self, client):
        """Reject status values not in {NEW, ACKNOWLEDGED, RESOLVED}."""

        async def _admin():
            return _mock_admin_user()

        mock_db = MagicMock()
        row = _make_patch_row(1, status="NEW")
        mock_db.execute.return_value.fetchone.return_value = row

        def _get_db():
            try:
                yield mock_db
            finally:
                pass

        app.dependency_overrides[auth.get_current_wims_user] = _admin
        app.dependency_overrides[auth.get_system_admin] = _admin
        app.dependency_overrides[auth.get_db_with_rls] = _get_db

        resp = client.patch("/api/admin/anomalies/1", json={"status": "INVALID"})
        assert resp.status_code == 422  # Pydantic validation error

    def test_invalid_transition_resolve_from_new(self, client):
        """NEW → RESOLVED is not allowed (must go through ACKNOWLEDGED)."""

        async def _admin():
            return _mock_admin_user()

        mock_db = MagicMock()
        row = _make_patch_row(1, status="NEW")
        mock_db.execute.return_value.fetchone.return_value = row

        def _get_db():
            try:
                yield mock_db
            finally:
                pass

        app.dependency_overrides[auth.get_current_wims_user] = _admin
        app.dependency_overrides[auth.get_system_admin] = _admin
        app.dependency_overrides[auth.get_db_with_rls] = _get_db

        resp = client.patch("/api/admin/anomalies/1", json={"status": "RESOLVED"})
        assert resp.status_code == 409
        assert "NEW" in resp.json()["detail"]
        assert "ACKNOWLEDGED" in resp.json()["detail"]

    def test_invalid_transition_from_resolved(self, client):
        """RESOLVED → anything is not allowed (terminal status)."""

        async def _admin():
            return _mock_admin_user()

        mock_db = MagicMock()
        row = _make_patch_row(1, status="RESOLVED")
        mock_db.execute.return_value.fetchone.return_value = row

        def _get_db():
            try:
                yield mock_db
            finally:
                pass

        app.dependency_overrides[auth.get_current_wims_user] = _admin
        app.dependency_overrides[auth.get_system_admin] = _admin
        app.dependency_overrides[auth.get_db_with_rls] = _get_db

        resp = client.patch("/api/admin/anomalies/1", json={"status": "ACKNOWLEDGED"})
        assert resp.status_code == 409

    def test_acknowledge_from_new(self, client):
        """NEW → ACKNOWLEDGED succeeds, orm UPDATE + audit INSERT + commit."""

        async def _admin():
            return _mock_admin_user()

        mock_db = MagicMock()
        # First call: SELECT fetches the row
        fetch_result = MagicMock()
        fetch_result.fetchone.return_value = _make_patch_row(1, status="NEW")

        # Second and third calls: UPDATE and INSERT (audit)
        update_result = MagicMock()
        audit_result = MagicMock()

        mock_db.execute.side_effect = [fetch_result, update_result, audit_result]

        def _get_db():
            try:
                yield mock_db
            finally:
                pass

        app.dependency_overrides[auth.get_current_wims_user] = _admin
        app.dependency_overrides[auth.get_system_admin] = _admin
        app.dependency_overrides[auth.get_db_with_rls] = _get_db

        resp = client.patch("/api/admin/anomalies/1", json={"status": "ACKNOWLEDGED"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["previous_status"] == "NEW"
        assert data["new_status"] == "ACKNOWLEDGED"

        # db.commit() was called
        mock_db.commit.assert_called_once()

        # Verify UPDATE executed with ACKNOWLEDGED
        update_sql = str(mock_db.execute.call_args_list[1][0][0])
        assert "UPDATE" in update_sql
        update_params = mock_db.execute.call_args_list[1][0][1]
        assert update_params["status"] == "ACKNOWLEDGED"

        # Verify audit INSERT
        audit_sql = str(mock_db.execute.call_args_list[2][0][0])
        assert "system_audit_trails" in audit_sql
        audit_params = mock_db.execute.call_args_list[2][0][1]
        assert audit_params["action_type"] == "ANOMALY_ACK"

    def test_resolve_from_acknowledged(self, client):
        """ACKNOWLEDGED → RESOLVED succeeds and writes ANOMALY_RESOLVE audit."""

        async def _admin():
            return _mock_admin_user()

        mock_db = MagicMock()
        fetch_result = MagicMock()
        fetch_result.fetchone.return_value = _make_patch_row(1, status="ACKNOWLEDGED")

        update_result = MagicMock()
        audit_result = MagicMock()

        mock_db.execute.side_effect = [fetch_result, update_result, audit_result]

        def _get_db():
            try:
                yield mock_db
            finally:
                pass

        app.dependency_overrides[auth.get_current_wims_user] = _admin
        app.dependency_overrides[auth.get_system_admin] = _admin
        app.dependency_overrides[auth.get_db_with_rls] = _get_db

        resp = client.patch("/api/admin/anomalies/1", json={"status": "RESOLVED"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["previous_status"] == "ACKNOWLEDGED"
        assert data["new_status"] == "RESOLVED"

        # Verify audit INSERT has ANOMALY_RESOLVE
        audit_params = mock_db.execute.call_args_list[2][0][1]
        assert audit_params["action_type"] == "ANOMALY_RESOLVE"
