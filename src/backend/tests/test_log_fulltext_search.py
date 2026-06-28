"""
TDD: M9b full-text search on security + audit logs.
Tests cover the q param path (websearch_to_tsquery + ts_rank) and the no-q path.
All tests are unit tests (mock DB); no stack required.
"""

import pytest
from unittest.mock import MagicMock
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


def mock_admin_user():
    return {
        "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-admin",
        "username": "admin",
        "role": "SYSTEM_ADMIN",
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SECURITY_ROW = (
    1,
    None,
    "192.168.1.1",
    "10.0.0.1",
    1001,
    "HIGH",
    "payload text",
    "xai narrative",
    0.95,
    None,  # xai_confidence_breakdown
    None,  # admin_action_taken
    None,  # resolved_at
    None,  # reviewed_by
    None,  # hitl_decision
    None,  # classification
    None,  # suricata_signature
    None,  # suricata_category
)

_AUDIT_ROW = (
    1,
    None,
    "LOGIN",
    "wims.users",
    None,
    "1.2.3.4",
    "Mozilla/5.0",
    None,
)


def _mock_security_db(rows=None, total=1):
    mock_result_rows = MagicMock()
    mock_result_rows.fetchall.return_value = rows if rows is not None else [_SECURITY_ROW]
    mock_result_count = MagicMock()
    mock_result_count.scalar.return_value = total

    mock_db = MagicMock()
    mock_db.execute.side_effect = [mock_result_rows, mock_result_count]

    def mock_get_db():
        yield mock_db

    return mock_db, mock_get_db


def _mock_audit_db(rows=None, total=1):
    mock_result_rows = MagicMock()
    mock_result_rows.fetchall.return_value = rows if rows is not None else [_AUDIT_ROW]
    mock_result_count = MagicMock()
    mock_result_count.scalar.return_value = total

    mock_db = MagicMock()
    mock_db.execute.side_effect = [mock_result_rows, mock_result_count]

    def mock_get_db():
        yield mock_db

    return mock_db, mock_get_db


def _assert_response_shape(response, expected_len=1):
    assert response.status_code == 200
    payload = response.json()
    assert set(payload.keys()) == {"items", "total", "limit", "offset"}
    assert isinstance(payload["items"], list)
    assert payload["total"] >= 0
    assert payload["limit"] > 0
    assert payload["offset"] >= 0
    assert len(payload["items"]) == expected_len
    return payload


# ---------------------------------------------------------------------------
# GET /api/admin/security-logs — full-text search path
# ---------------------------------------------------------------------------


class TestSecurityLogSearch:
    def test_q_param_appends_tsquery_filter(self, client: TestClient):
        """When q is provided, SQL must include websearch_to_tsquery."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?q=sqlinjection")

        _assert_response_shape(response)
        executed_sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("websearch_to_tsquery" in sql for sql in executed_sqls), (
            "Expected websearch_to_tsquery in SQL when q is provided"
        )

    def test_q_param_uses_ts_rank_ordering(self, client: TestClient):
        """When q is provided, ORDER BY must use ts_rank."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?q=brute+force")

        assert response.status_code == 200
        executed_sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("ts_rank" in sql for sql in executed_sqls), (
            "Expected ts_rank in ORDER BY when q is provided"
        )

    def test_q_param_bound_to_query(self, client: TestClient):
        """The q value is passed as a bound parameter, not interpolated."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?q=HIGH")

        _assert_response_shape(response)
        bound_params = [c[0][1] for c in mock_db.execute.call_args_list if len(c[0]) > 1]
        assert any(p.get("q") == "HIGH" for p in bound_params), "Expected q to be bound as HIGH"

    def test_no_q_uses_timestamp_ordering(self, client: TestClient):
        """When q is absent, ORDER BY falls back to timestamp DESC."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs")

        assert response.status_code == 200
        executed_sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("timestamp DESC" in sql for sql in executed_sqls), (
            "Expected timestamp DESC ordering when q is absent"
        )
        assert not any("ts_rank" in sql for sql in executed_sqls), (
            "ts_rank should not appear when q is absent"
        )

    def test_no_q_no_tsquery_in_where(self, client: TestClient):
        """When q is absent, search_vector @@ websearch_to_tsquery must not appear in WHERE."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs")

        assert response.status_code == 200
        executed_sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert not any("websearch_to_tsquery" in sql for sql in executed_sqls)

    def test_q_combined_with_severity_filter(self, client: TestClient):
        """q and severity can be combined; both filters appear in WHERE."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?q=scan&severity=HIGH")

        _assert_response_shape(response)
        executed_sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        main_sql = executed_sqls[0]
        assert "websearch_to_tsquery" in main_sql
        assert "severity_level" in main_sql

    def test_q_whitespace_is_trimmed_before_binding(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_security_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/security-logs?q=%20%20HIGH%20%20")

        _assert_response_shape(response)
        bound_params = [c[0][1] for c in mock_db.execute.call_args_list if len(c[0]) > 1]
        assert any(p.get("q") == "HIGH" for p in bound_params)


# ---------------------------------------------------------------------------
# GET /api/admin/audit-logs — full-text search path
# ---------------------------------------------------------------------------


class TestAuditLogSearch:
    def test_q_param_appends_tsquery_filter(self, client: TestClient):
        """When q is provided, SQL must include websearch_to_tsquery."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs?q=LOGIN")

        _assert_response_shape(response)
        executed_sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("websearch_to_tsquery" in sql for sql in executed_sqls)

    def test_q_param_uses_ts_rank_ordering(self, client: TestClient):
        """When q is provided, ORDER BY must use ts_rank."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs?q=CONFIG_UPDATE")

        _assert_response_shape(response)
        executed_sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("ts_rank" in sql for sql in executed_sqls)

    def test_no_q_uses_timestamp_ordering(self, client: TestClient):
        """When q is absent, ORDER BY falls back to timestamp DESC."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs")

        _assert_response_shape(response)
        executed_sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("timestamp DESC" in sql for sql in executed_sqls)
        assert not any("ts_rank" in sql for sql in executed_sqls)

    def test_no_q_no_tsquery_in_where(self, client: TestClient):
        """When q is absent, search_vector condition must not appear."""
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs")

        _assert_response_shape(response)
        executed_sqls = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert not any("websearch_to_tsquery" in sql for sql in executed_sqls)

    def test_q_whitespace_is_trimmed_before_binding(self, client: TestClient):
        app.dependency_overrides[auth.get_current_wims_user] = mock_admin_user
        mock_db, mock_get_db = _mock_audit_db()
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        response = client.get("/api/admin/audit-logs?q=%20%20LOGIN%20%20")

        _assert_response_shape(response)
        bound_params = [c[0][1] for c in mock_db.execute.call_args_list if len(c[0]) > 1]
        assert any(p.get("q") == "LOGIN" for p in bound_params)
