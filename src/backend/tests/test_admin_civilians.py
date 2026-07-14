"""
TDD: Admin civilian contributor management (issue #576).

Covers:
- GET  /api/admin/civilians            (list + search + status filter)
- POST /api/admin/civilians/{id}/suspend   (idempotent)
- POST /api/admin/civilians/{id}/activate  (idempotent)
- GET  /api/admin/civilians/{id}/audit     (paginated, civilian-scoped)
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from auth import get_current_wims_user, get_db_with_rls
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ── helpers ──────────────────────────────────────────────────────────────────


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


def _mock_db():
    mock_result = MagicMock()
    mock_result.fetchone.return_value = None
    mock_result.fetchall.return_value = []
    mock_result.scalar.return_value = 0
    mock_db = MagicMock()
    mock_db.execute.return_value = mock_result

    def mock_get_db():
        yield mock_db

    return mock_db, mock_get_db


# ── GET /api/admin/civilians ─────────────────────────────────────────────────


class TestListCivilians:
    def test_returns_items_mapped_correctly(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_admin_user
        uid = uuid.uuid4()
        kc = uuid.uuid4()
        now = datetime.now(timezone.utc)
        row = (uid, kc, "jane_doe", 72, "TRUSTED", False, 5, now, now)
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [row]
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get("/api/admin/civilians")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["user_id"] == str(uid)
        assert data[0]["keycloak_id"] == str(kc)
        assert data[0]["name"] == "jane_doe"
        assert data[0]["trust_score"] == 72
        assert data[0]["badge"] == "TRUSTED"
        assert data[0]["status"] == "active"
        assert data[0]["report_count"] == 5

    def test_search_uses_ilike(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get("/api/admin/civilians?search=jane")
        assert resp.status_code == 200
        sql = str(mock_db.execute.call_args_list[0][0][0])
        assert "ILIKE" in sql
        params = mock_db.execute.call_args_list[0][0][1]
        assert params["search"] == "%jane%"

    def test_status_suspended_filter(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get("/api/admin/civilians?status=suspended")
        assert resp.status_code == 200
        sql = str(mock_db.execute.call_args_list[0][0][0])
        assert "cc.suspended = TRUE" in sql

    def test_status_active_filter(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get("/api/admin/civilians?status=active")
        assert resp.status_code == 200
        sql = str(mock_db.execute.call_args_list[0][0][0])
        assert "cc.suspended = FALSE" in sql

    def test_requires_admin(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        _, mock_get_db = _mock_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get("/api/admin/civilians")
        assert resp.status_code in (401, 403)


# ── POST suspend / activate ──────────────────────────────────────────────────


class TestSuspendActivate:
    def test_suspend_success_writes_audit_and_calls_keycloak(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_admin_user
        uid = uuid.uuid4()
        kc = uuid.uuid4()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = (str(kc), False)  # keycloak_id, suspended=False
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch(
            "api.routes.admin.civilians.set_user_enabled"
        ) as mock_kc, patch(
            "api.routes.admin.civilians.log_system_audit"
        ) as mock_audit:
            resp = client.post(f"/api/admin/civilians/{uid}/suspend")

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "suspended"
        assert body["suspended"] is True
        assert body["user_id"] == str(uid)
        mock_kc.assert_called_once_with(str(kc), enabled=False)
        assert mock_audit.call_count == 1
        assert mock_audit.call_args.kwargs["action_type"] == "CIVILIAN_SUSPEND"

    def test_suspend_idempotent_no_audit(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_admin_user
        uid = uuid.uuid4()
        kc = uuid.uuid4()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = (str(kc), True)  # already suspended
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch(
            "api.routes.admin.civilians.set_user_enabled"
        ) as mock_kc, patch(
            "api.routes.admin.civilians.log_system_audit"
        ) as mock_audit:
            resp = client.post(f"/api/admin/civilians/{uid}/suspend")

        assert resp.status_code == 200
        assert resp.json()["status"] == "suspended"
        mock_kc.assert_not_called()
        mock_audit.assert_not_called()

    def test_suspend_404_when_not_a_civilian(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_admin_user
        mock_result = MagicMock()
        mock_result.fetchone.return_value = None
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.post(f"/api/admin/civilians/{uuid.uuid4()}/suspend")
        assert resp.status_code == 404

    def test_suspend_invalid_uuid(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_admin_user
        _, mock_get_db = _mock_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.post("/api/admin/civilians/not-a-uuid/suspend")
        assert resp.status_code == 400

    def test_suspend_requires_admin(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        _, mock_get_db = _mock_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.post(f"/api/admin/civilians/{uuid.uuid4()}/suspend")
        assert resp.status_code in (401, 403)

    def test_activate_success(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_admin_user
        uid = uuid.uuid4()
        kc = uuid.uuid4()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = (str(kc), True)  # currently suspended
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch(
            "api.routes.admin.civilians.set_user_enabled"
        ) as mock_kc, patch(
            "api.routes.admin.civilians.log_system_audit"
        ) as mock_audit:
            resp = client.post(f"/api/admin/civilians/{uid}/activate")

        assert resp.status_code == 200
        assert resp.json()["status"] == "active"
        assert resp.json()["suspended"] is False
        mock_kc.assert_called_once_with(str(kc), enabled=True)
        assert mock_audit.call_args.kwargs["action_type"] == "CIVILIAN_ACTIVATE"


# ── GET audit ────────────────────────────────────────────────────────────────


class TestCivilianAudit:
    def test_returns_paginated_civilian_scoped_audit(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_admin_user
        uid = uuid.uuid4()
        now = datetime.now(timezone.utc)
        mock_result = MagicMock()
        mock_result.scalar.return_value = 2
        mock_result.fetchall.return_value = [
            ("CIVILIAN_SUSPEND", now, {"user_id": str(uid), "suspended": True}, uuid.uuid4()),
            ("SOME_OTHER", now, {"user_id": str(uid)}, uuid.uuid4()),
        ]
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get(f"/api/admin/civilians/{uid}/audit?page=1&limit=20")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["page"] == 1
        assert data["limit"] == 20
        assert len(data["items"]) == 2
        assert data["items"][0]["action_type"] == "CIVILIAN_SUSPEND"
        assert data["items"][0]["new_values"]["suspended"] is True

        # The civilian-scoped WHERE clause must be present in both queries.
        for call in mock_db.execute.call_args_list:
            sql = str(call[0][0])
            assert "table_affected ILIKE" in sql
            assert "new_values->>'user_id'" in sql

    def test_audit_requires_admin(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        _, mock_get_db = _mock_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get(f"/api/admin/civilians/{uuid.uuid4()}/audit")
        assert resp.status_code in (401, 403)
