"""
SQLi Allowlist Regression Tests — Issue #395.

TDD: Tests asserting 422 for non-allowlisted sort_by values must FAIL
against the unmodified codebase (current impl silently defaults to
"notification_dt" and returns 200).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import auth
from auth import get_db_with_rls
from database import get_db
from main import app


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
    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchall.return_value = []
    mock_result.scalar.return_value = 0
    mock_db.execute.return_value = mock_result
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


def _set_analyst(client):
    mock_db, mock_get_db, mock_get_db_with_rls = _mock_analyst_db()
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("NATIONAL_ANALYST")
    app.dependency_overrides[get_db] = mock_get_db
    app.dependency_overrides[get_db_with_rls] = mock_get_db_with_rls
    return mock_db


def _set_admin(client):
    mock_db, mock_get_db, mock_get_db_with_rls = _mock_analyst_db()
    app.dependency_overrides[auth.get_current_wims_user] = _mock_user("SYSTEM_ADMIN")
    app.dependency_overrides[get_db] = mock_get_db
    app.dependency_overrides[get_db_with_rls] = mock_get_db_with_rls
    return mock_db


class TestAnalystListSortBy:
    """SQLi regression: GET /api/incidents/analyst-list?sort_by=<inject>"""

    def test_non_allowlisted_sort_by_rejected_422(self, client):
        """
        Tracer bullet (#395): SQLi payload in sort_by must be rejected with 422.

        Current behaviour (RED): non-allowlisted values silently fall back to
        "notification_dt" and return 200 — no SQL error leak, but no explicit
        rejection either. The fix must reject with 422 per acceptance criteria.
        """
        _set_analyst(client)

        response = client.get(
            "/api/incidents/analyst-list",
            params={"sort_by": "'; DROP TABLE fire_incidents--"},
        )

        assert response.status_code == 422, (
            f"Expected 422 for non-allowlisted sort_by, got {response.status_code}. "
            f"Body: {response.text[:500]}"
        )

    @pytest.mark.parametrize(
        "sort_by",
        [
            "notification_dt",
            "region",
            "municipality_name",
            "general_category",
            "sub_category",
            "alarm_level",
            "estimated_damage_php",
            "total_response_time_minutes",
            "incident_id",
            "province_name",
            "created_at",
        ],
    )
    def test_allowlisted_sort_by_accepted_200(self, client, sort_by):
        """Every allowlisted sort_by value must return 200."""
        _set_analyst(client)

        response = client.get(
            "/api/incidents/analyst-list",
            params={"sort_by": sort_by},
        )

        assert response.status_code == 200, (
            f"Expected 200 for allowlisted sort_by={sort_by}, "
            f"got {response.status_code}. Body: {response.text[:500]}"
        )

    def test_missing_sort_by_defaults_to_notification_dt(self, client):
        """Omitting sort_by entirely must return 200 (defaults to notification_dt)."""
        _set_analyst(client)

        response = client.get("/api/incidents/analyst-list")

        assert response.status_code == 200, (
            f"Expected 200 when sort_by is omitted, got {response.status_code}."
        )

    @pytest.mark.parametrize(
        "payload",
        [
            "' OR '1'='1",
            "1=1",
            "; DROP TABLE fire_incidents",
            "non_existent_column",
            "../etc/passwd",
            "%",
            "--",
            "#",
            "%27",
        ],
    )
    def test_sqli_payloads_rejected_422(self, client, payload):
        """Full SQLi payload suite: all attack classes must be rejected with 422."""
        _set_analyst(client)

        response = client.get(
            "/api/incidents/analyst-list",
            params={"sort_by": payload},
        )

        assert response.status_code == 422, (
            f"Expected 422 for SQLi payload sort_by={payload!r}, "
            f"got {response.status_code}. Body: {response.text[:500]}"
        )


class TestAdminAuditLogs:
    """Verify GET /api/admin/audit-logs uses hardcoded ORDER BY — no IDOR/SQLi risk."""

    def test_audit_logs_returns_200(self, client):
        """Admin audit-logs has no user-controlled sort_by; endpoint returns 200."""
        _set_admin(client)

        response = client.get("/api/admin/audit-logs")

        assert response.status_code == 200, (
            f"Expected 200 from audit-logs, got {response.status_code}. Body: {response.text[:500]}"
        )


class TestAdminSecurityLogs:
    """Verify GET /api/admin/security-logs uses hardcoded ORDER BY — no IDOR/SQLi risk."""

    def test_security_logs_returns_200(self, client):
        """Admin security-logs has no user-controlled sort_by; endpoint returns 200."""
        _set_admin(client)

        response = client.get("/api/admin/security-logs")

        assert response.status_code == 200, (
            f"Expected 200 from security-logs, got {response.status_code}. "
            f"Body: {response.text[:500]}"
        )
