"""
TDD: New Admin Routes — issues #108, #109, #110.

Covers:
- PATCH /admin/scheduled-reports/{report_id}     (GAP-A10)
- POST /admin/restore                            (Issue #108)
- GET  /admin/sessions/{user_id}                 (GAP-A13)
- DELETE /admin/sessions/{user_id}/{session_id}   (GAP-A13)
"""

import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

import auth
from auth import get_db_with_rls
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# =============================================================================
# Helpers
# =============================================================================


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


# =============================================================================
# PATCH /admin/scheduled-reports/{report_id}
# =============================================================================


class TestUpdateScheduledReport:
    def test_patch_disables_report(self, client: TestClient):
        """PATCH with enabled=false returns 200 and the report is disabled."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = (5, "Weekly PDF", False)
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/scheduled-reports/5",
            json={"enabled": False},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is False
        assert data["id"] == 5

    def test_patch_enables_report(self, client: TestClient):
        """PATCH with enabled=true returns 200 and the report is enabled."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = (3, "Monthly CSV", True)
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/scheduled-reports/3",
            json={"enabled": True},
        )
        assert response.status_code == 200
        assert response.json()["enabled"] is True

    def test_patch_returns_404_when_report_missing(self, client: TestClient):
        """PATCH against a non-existent report_id returns 404."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = None
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/scheduled-reports/999999",
            json={"enabled": False},
        )
        assert response.status_code == 404

    def test_patch_requires_admin(self, client: TestClient):
        """PATCH with REGIONAL_ENCODER token returns 403."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_encoder_user

        response = client.patch(
            "/api/admin/scheduled-reports/1",
            json={"enabled": False},
        )
        assert response.status_code in (401, 403)


# =============================================================================
# POST /admin/restore
# =============================================================================


class TestRestoreBackup:
    def test_rejects_invalid_filename(self, client: TestClient):
        """Uploading a file whose name does not match ^wims_\\d{8}_\\d{6}\\.sql\\.enc$ returns 400."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        response = client.post(
            "/api/admin/restore",
            files={"file": ("evil.txt", b"not a backup", "text/plain")},
        )
        assert response.status_code == 400
        assert "Invalid" in response.json().get("detail", "")

    def test_rejects_missing_file(self, client: TestClient):
        """POST /admin/restore with no file part returns 422."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        response = client.post("/api/admin/restore")
        assert response.status_code == 422


# =============================================================================
# GET /admin/sessions/{user_id}
# =============================================================================


class TestGetUserSessions:
    def test_returns_404_for_unknown_user(self, client: TestClient):
        """GET /admin/sessions/{uuid} where no user matches returns 404."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = None
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/sessions/00000000-0000-0000-0000-000000000000")
        assert response.status_code == 404

    def test_returns_sessions_list(self, client: TestClient):
        """GET returns the sessions list returned by the mocked Keycloak client."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = ("kid-abc123",)
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        fake_sessions = [
            {
                "id": "sess-001",
                "ipAddress": "1.1.1.1",
                "start": 1747000000,
                "lastAccess": 1747000100,
                "clients": {"web": "Chrome"},
            }
        ]

        with patch("services.keycloak_admin._get_admin_client") as mock_get_adm:
            mock_adm = MagicMock()
            mock_adm.get_sessions.return_value = fake_sessions
            mock_get_adm.return_value = mock_adm

            response = client.get("/api/admin/sessions/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")

        assert response.status_code == 200
        data = response.json()
        assert "sessions" in data
        assert isinstance(data["sessions"], list)
        assert len(data["sessions"]) == 1
        assert data["sessions"][0]["id"] == "sess-001"


# =============================================================================
# DELETE /admin/sessions/{user_id}/{session_id}
# =============================================================================


class TestRevokeUserSession:
    def test_returns_404_for_unknown_user(self, client: TestClient):
        """DELETE against a non-existent user returns 404."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = None
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.delete(
            "/api/admin/sessions/00000000-0000-0000-0000-000000000000/sess-xyz"
        )
        assert response.status_code == 404

    def test_revoke_session_success(self, client: TestClient):
        """DELETE /sessions/{user_id}/{session_id} returns 200 on success."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = ("kid-abc123",)
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("services.keycloak_admin._get_admin_client") as mock_get_adm:
            mock_adm = MagicMock()
            mock_adm.get_sessions.return_value = [
                {
                    "id": "sess-abc",
                    "ipAddress": "1.2.3.4",
                    "start": 0,
                    "lastAccess": 0,
                    "clients": {},
                }
            ]
            mock_adm.delete_user_session.return_value = None
            mock_get_adm.return_value = mock_adm

            response = client.delete(
                "/api/admin/sessions/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/sess-abc"
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["session_id"] == "sess-abc"

    def test_delete_session_wrong_ownership(self, client: TestClient):
        """DELETE /sessions/{user_id}/{session_id} returns 404 when session belongs to another user."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchone.return_value = ("kid-abc123",)
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("services.keycloak_admin._get_admin_client") as mock_get_adm:
            mock_adm = MagicMock()
            mock_adm.get_sessions.return_value = [
                {
                    "id": "other-session",
                    "ipAddress": "1.2.3.4",
                    "start": 0,
                    "lastAccess": 0,
                    "clients": {},
                }
            ]
            mock_get_adm.return_value = mock_adm

            response = client.delete(
                "/api/admin/sessions/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/sess-not-mine"
            )

        assert response.status_code == 404


# =============================================================================
# GET /admin/security-logs
# =============================================================================


class TestGetSecurityLogsPagination:
    def test_get_security_logs_pagination(self, client: TestClient):
        """GET /admin/security-logs?limit=5&offset=0 returns correct pagination fields."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_result.scalar.return_value = 0
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?limit=5&offset=0")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "limit" in data
        assert "offset" in data
        assert data["limit"] == 5


# =============================================================================
# GET /admin/audit-logs — filtered queries
# =============================================================================


def _mock_audit_log_db(fetchall_rows=None, scalar_count=0):
    mock_result = MagicMock()
    mock_result.fetchall.return_value = fetchall_rows or []
    mock_result.scalar.return_value = scalar_count
    mock_db = MagicMock()
    mock_db.execute.return_value = mock_result

    def mock_get_db():
        yield mock_db

    return mock_db, mock_get_db


class TestGetAuditLogsFiltered:
    def test_no_filters_produces_no_where_clause(self, client: TestClient):
        """GET /admin/audit-logs with no filter params produces the same un-filtered query."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs?limit=50&offset=0")
        assert response.status_code == 200
        calls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        for call_sql in calls:
            assert "WHERE" not in call_sql

    def test_filter_by_user_id(self, client: TestClient):
        """GET /admin/audit-logs?user_id=42 adds WHERE user_id = :user_id."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs?user_id=42")
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "user_id = :user_id" in sql
        assert params["user_id"] == 42

    def test_filter_by_action_type(self, client: TestClient):
        """GET /admin/audit-logs?action_type=CREATE adds WHERE action_type = :action_type."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs?action_type=CREATE")
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "action_type = :action_type" in sql
        assert params["action_type"] == "CREATE"

    def test_filter_by_table_affected(self, client: TestClient):
        """GET /admin/audit-logs?table_affected=fire_incidents adds WHERE table_affected = :table_affected."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs?table_affected=fire_incidents")
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "table_affected = :table_affected" in sql
        assert params["table_affected"] == "fire_incidents"

    def test_filter_by_ip_address(self, client: TestClient):
        """GET /admin/audit-logs?ip_address=192.168.1.1 adds WHERE ip_address = :ip_address."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs?ip_address=192.168.1.1")
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "ip_address = :ip_address" in sql
        assert params["ip_address"] == "192.168.1.1"

    def test_filter_by_date_from(self, client: TestClient):
        """GET /admin/audit-logs?date_from=2026-01-01T00:00:00 adds CAST timestamp filter."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs?date_from=2026-01-01T00:00:00")
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "timestamp >= CAST(:date_from AS timestamptz)" in sql
        assert params["date_from"] == "2026-01-01T00:00:00"

    def test_filter_by_date_to(self, client: TestClient):
        """GET /admin/audit-logs?date_to=2026-06-01T00:00:00 adds CAST timestamp filter."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs?date_to=2026-06-01T00:00:00")
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "timestamp <= CAST(:date_to AS timestamptz)" in sql
        assert params["date_to"] == "2026-06-01T00:00:00"

    def test_multiple_filters_combined_with_and(self, client: TestClient):
        """Multiple filter params combine with AND (not OR)."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get(
            "/api/admin/audit-logs?action_type=DELETE&table_affected=fire_incidents&user_id=7"
        )
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "action_type = :action_type" in sql
        assert "table_affected = :table_affected" in sql
        assert "user_id = :user_id" in sql
        assert params["action_type"] == "DELETE"
        assert params["table_affected"] == "fire_incidents"
        assert params["user_id"] == 7

    def test_filtered_count_uses_same_where_clause(self, client: TestClient):
        """The COUNT(*) query uses the same WHERE clause as the data query."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs?action_type=CREATE")
        assert response.status_code == 200
        # Two execute calls: one for data, one for count
        assert mock_db.execute.call_count == 2
        count_call = mock_db.execute.call_args_list[1]
        count_sql = str(count_call[0][0])
        assert "COUNT(*)" in count_sql
        assert "action_type = :action_type" in count_sql


# =============================================================================
# GET /admin/security-logs — filtered queries
# =============================================================================


class TestGetSecurityLogsFiltered:
    def test_security_no_filters_produces_no_where_clause(self, client: TestClient):
        """GET /admin/security-logs with no filter params produces the same un-filtered query."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?limit=20&offset=0")
        assert response.status_code == 200
        calls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        for call_sql in calls:
            assert "WHERE" not in call_sql

    def test_filter_by_source_ip(self, client: TestClient):
        """GET /admin/security-logs?source_ip=10.0.0.1 adds WHERE source_ip = :source_ip."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?source_ip=10.0.0.1")
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "source_ip = :source_ip" in sql
        assert params["source_ip"] == "10.0.0.1"

    def test_filter_by_severity(self, client: TestClient):
        """GET /admin/security-logs?severity=HIGH maps to severity_level column."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?severity=HIGH")
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "severity_level = :severity" in sql
        assert params["severity"] == "HIGH"

    def test_filter_by_date_from(self, client: TestClient):
        """GET /admin/security-logs?date_from=2026-01-01T00:00:00 adds CAST timestamp filter."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?date_from=2026-01-01T00:00:00")
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "timestamp >= CAST(:date_from AS timestamptz)" in sql
        assert params["date_from"] == "2026-01-01T00:00:00"

    def test_filter_by_date_to(self, client: TestClient):
        """GET /admin/security-logs?date_to=2026-06-01T00:00:00 adds CAST timestamp filter."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?date_to=2026-06-01T00:00:00")
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "timestamp <= CAST(:date_to AS timestamptz)" in sql
        assert params["date_to"] == "2026-06-01T00:00:00"

    def test_security_multiple_filters_combined_with_and(self, client: TestClient):
        """Multiple security filter params combine with AND."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get(
            "/api/admin/security-logs?source_ip=10.0.0.1&severity=HIGH&date_from=2026-01-01T00:00:00"
        )
        assert response.status_code == 200
        call_args = mock_db.execute.call_args_list[0]
        sql = str(call_args[0][0])
        params = call_args[0][1]
        assert "source_ip = :source_ip" in sql
        assert "severity_level = :severity" in sql
        assert "timestamp >= CAST(:date_from AS timestamptz)" in sql
        assert params["source_ip"] == "10.0.0.1"
        assert params["severity"] == "HIGH"

    def test_security_filtered_count_uses_same_where_clause(self, client: TestClient):
        """The COUNT(*) query uses the same WHERE clause."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?severity=HIGH")
        assert response.status_code == 200
        assert mock_db.execute.call_count == 2
        count_call = mock_db.execute.call_args_list[1]
        count_sql = str(count_call[0][0])
        assert "COUNT(*)" in count_sql
        assert "severity_level = :severity" in count_sql


# =============================================================================
# GET /admin/rate-limits
# =============================================================================


class TestGetRateLimitsDefaults:
    def test_get_rate_limits_returns_defaults(self, client: TestClient):
        """GET /admin/rate-limits (with no prior set) returns defaults with integer fields."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user

        with patch("redis.from_url") as mock_redis:
            mock_r = MagicMock()
            mock_r.hgetall.return_value = {}
            mock_redis.return_value = mock_r

            response = client.get("/api/admin/rate-limits")

        assert response.status_code == 200
        data = response.json()
        assert "login_window_seconds" in data
        assert "login_threshold" in data
        assert isinstance(data["login_window_seconds"], int)
        assert isinstance(data["login_threshold"], int)


# =============================================================================
# PATCH /admin/security-logs/{log_id} — M8d HITL decisions
# =============================================================================


def _mock_security_log_db(extra_rows=None):
    mock_result = MagicMock()
    mock_result.rowcount = 1
    if extra_rows:
        mock_result.fetchall.return_value = extra_rows
    mock_db = MagicMock()
    mock_db.execute.return_value = mock_result

    def mock_get_db():
        yield mock_db

    return mock_db, mock_get_db


class TestPatchSecurityLogHitl:
    def test_confirm_threat_sets_label_and_jsonb(self, client: TestClient):
        """PATCH { "action": "CONFIRM_THREAT" } sets admin_action_taken + hitl_decision JSONB."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_log_db()
        # Prefetch (call 1) returns LOW severity — email branch not exercised
        mock_db.execute.return_value.fetchone.return_value = ("LOW", "n/a", None)
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/security-logs/1", json={"action": "CONFIRM_THREAT"})

        assert response.status_code == 200
        # CONFIRM_THREAT: call 1 = severity prefetch, call 2 = UPDATE, call 3 = audit INSERT
        assert mock_db.execute.call_count == 3
        update_call = next(
            c for c in mock_db.execute.call_args_list if "admin_action_taken" in c[0][1]
        )
        sql = str(update_call[0][0])
        params = update_call[0][1]
        assert "admin_action_taken = :admin_action_taken" in sql
        assert params["admin_action_taken"] == "Confirmed Threat"
        assert "hitl_decision = CAST(:hitl_decision AS jsonb)" in sql
        decision = params["hitl_decision"]
        assert '"action": "CONFIRM_THREAT"' in decision
        assert '"reviewed_by": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"' in decision
        assert '"reviewed_at":' in decision
        assert "resolved_at = now()" in sql

    def test_false_positive_sets_label_and_jsonb(self, client: TestClient):
        """PATCH { "action": "FALSE_POSITIVE" } sets admin_action_taken + hitl_decision JSONB + resolved_at."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/security-logs/2", json={"action": "FALSE_POSITIVE"})

        assert response.status_code == 200
        update_call = next(
            c for c in mock_db.execute.call_args_list if "admin_action_taken" in c[0][1]
        )
        params = update_call[0][1]
        assert params["admin_action_taken"] == "False Positive (Dismissed)"
        decision = params["hitl_decision"]
        assert '"action": "FALSE_POSITIVE"' in decision
        assert "resolved_at = now()" in str(update_call[0][0])

    def test_request_more_info_sets_label_jsonb_leaves_resolved_at_null(self, client: TestClient):
        """PATCH { "action": "REQUEST_MORE_INFO" } sets label + JSONB but NOT resolved_at."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch(
            "/api/admin/security-logs/3",
            json={"action": "REQUEST_MORE_INFO", "note": "Check source IP"},
        )

        assert response.status_code == 200
        update_call = next(
            c for c in mock_db.execute.call_args_list if "admin_action_taken" in c[0][1]
        )
        params = update_call[0][1]
        assert params["admin_action_taken"] == "More Info Requested"
        decision = params["hitl_decision"]
        assert '"action": "REQUEST_MORE_INFO"' in decision
        assert '"note": "Check source IP"' in decision
        sql_str = str(update_call[0][0])
        assert "resolved_at = NULL" in sql_str
        assert "resolved_at = now()" not in sql_str

    def test_invalid_action_returns_400(self, client: TestClient):
        """PATCH with an unknown action value returns HTTP 400."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/security-logs/1", json={"action": "INVALID_ACTION"})

        assert response.status_code == 400
        assert "Invalid action" in response.json()["detail"]

    def test_no_fields_returns_400(self, client: TestClient):
        """PATCH with empty body returns 400."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_log_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/security-logs/1", json={})

        assert response.status_code == 400
        assert "No fields to update" in response.json()["detail"]

    def test_not_found_returns_404(self, client: TestClient):
        """PATCH against a non-existent log_id returns 404."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_result = MagicMock()
        mock_result.rowcount = 0
        mock_db = MagicMock()
        mock_db.execute.return_value = mock_result

        def mock_get_db():
            yield mock_db

        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.patch("/api/admin/security-logs/99999", json={"action": "CONFIRM_THREAT"})
        assert response.status_code == 404
