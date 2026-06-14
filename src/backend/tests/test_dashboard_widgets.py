"""Tests for GET /api/dashboard/widgets — widget endpoint (#235)."""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import text

from main import app
from auth import get_current_user, get_db_with_rls


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ── Helper: mock a DB session that returns canned SQL results ────────────


def _mock_db(rows_by_query_prefix: dict[str, list]):
    """Return a MagicMock Session whose execute().fetchall() returns the given rows
    based on the SQL query text prefix.
    """
    db = MagicMock()

    def _execute(sql, params=None):
        stmt = str(sql) if hasattr(sql, "__str__") else str(text(sql))
        for prefix, rows in rows_by_query_prefix.items():
            if prefix in stmt:
                mock_result = MagicMock()
                mock_result.fetchall.return_value = rows
                mock_result.scalar.return_value = rows[0][0] if rows and len(rows[0]) > 0 else 0
                return mock_result
        # Default: empty result
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_result.scalar.return_value = 0
        return mock_result

    db.execute.side_effect = _execute
    return db


# ── User fixtures ──────────────────────────────────────────────────────


def _validator_user():
    return {
        "user_id": "v-11111111-1111-1111-1111-111111111111",
        "keycloak_id": "kid-validator",
        "username": "validator",
        "role": "NATIONAL_VALIDATOR",
    }


def _encoder_user():
    return {
        "user_id": "e-11111111-1111-1111-1111-111111111111",
        "keycloak_id": "kid-encoder",
        "username": "encoder1",
        "role": "REGIONAL_ENCODER",
        "assigned_region_id": 1,
    }


def _analyst_user():
    return {
        "user_id": "a-11111111-1111-1111-1111-111111111111",
        "keycloak_id": "kid-analyst",
        "username": "analyst",
        "role": "NATIONAL_ANALYST",
    }


# ========================================================================
# Tests
# ========================================================================


class TestAuthRequired:
    def test_requires_auth(self, client: TestClient):
        """Widget endpoint requires authentication."""
        resp = client.get("/api/dashboard/widgets?ids=awaiting_validation")
        assert resp.status_code in (401, 403)


class TestEmptyRequest:
    def test_empty_ids_returns_empty(self, client: TestClient):
        """Empty ids parameter returns empty object."""
        app.dependency_overrides[get_current_user] = _validator_user
        db = _mock_db({})
        app.dependency_overrides[get_db_with_rls] = lambda: db

        resp = client.get("/api/dashboard/widgets?ids=")
        assert resp.status_code == 200
        assert resp.json() == {}

    def test_no_ids_param_returns_empty(self, client: TestClient):
        """Missing ids parameter returns empty object."""
        app.dependency_overrides[get_current_user] = _validator_user
        db = _mock_db({})
        app.dependency_overrides[get_db_with_rls] = lambda: db

        resp = client.get("/api/dashboard/widgets")
        assert resp.status_code == 200
        assert resp.json() == {}


class TestValidatorWidgets:
    def test_validator_count_widgets(self, client: TestClient):
        """NATIONAL_VALIDATOR gets count widgets."""
        app.dependency_overrides[get_current_user] = _validator_user
        db = _mock_db(
            {
                "PENDING": [(5,)],
                "citizen_reports": [(3,)],
                "VERIFIED": [(12,)],
            }
        )
        app.dependency_overrides[get_db_with_rls] = lambda: db

        resp = client.get(
            "/api/dashboard/widgets?ids=awaiting_validation,citizen_reports,verified_today",
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "awaiting_validation" in data
        assert "citizen_reports" in data
        assert "verified_today" in data

    def test_validator_categorical_widget(self, client: TestClient):
        """by_category widget returns categories array."""
        app.dependency_overrides[get_current_user] = _validator_user
        db = _mock_db(
            {
                "general_category": [
                    ("Structural", 8),
                    ("Non-Structural", 3),
                ],
            }
        )
        app.dependency_overrides[get_db_with_rls] = lambda: db

        resp = client.get("/api/dashboard/widgets?ids=by_category")
        assert resp.status_code == 200
        data = resp.json()
        assert "by_category" in data
        assert "categories" in data["by_category"]
        assert len(data["by_category"]["categories"]) == 2

    def test_validator_cannot_request_encoder_widget(self, client: TestClient):
        """NATIONAL_VALIDATOR cannot access REGIONAL_ENCODER widgets."""
        app.dependency_overrides[get_current_user] = _validator_user
        db = _mock_db({})
        app.dependency_overrides[get_db_with_rls] = lambda: db

        resp = client.get(
            "/api/dashboard/widgets?ids=drafts,submitted_today",
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "drafts" not in data
        assert "submitted_today" not in data


class TestEncoderWidgets:
    def test_encoder_count_widgets(self, client: TestClient):
        """REGIONAL_ENCODER gets encoder count widgets."""
        app.dependency_overrides[get_current_user] = _encoder_user
        db = _mock_db(
            {
                "region_id": [(42,)],
                "DRAFT": [(7,)],
                "created_at": [(3,)],
            }
        )
        app.dependency_overrides[get_db_with_rls] = lambda: db

        resp = client.get(
            "/api/dashboard/widgets?ids=total_incidents,drafts,submitted_today,pending_validation",
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "total_incidents" in data
        assert "drafts" in data
        assert "submitted_today" in data

    def test_encoder_categorical_widget(self, client: TestClient):
        """by_alarm_level returns categories for encoder."""
        app.dependency_overrides[get_current_user] = _encoder_user
        db = _mock_db(
            {
                "alarm_level": [
                    ("3", 5),
                    ("5", 2),
                ],
            }
        )
        app.dependency_overrides[get_db_with_rls] = lambda: db

        resp = client.get("/api/dashboard/widgets?ids=by_alarm_level")
        assert resp.status_code == 200
        data = resp.json()
        assert "by_alarm_level" in data
        assert "categories" in data["by_alarm_level"]


class TestAnalystWidgets:
    def test_analyst_widgets(self, client: TestClient):
        """NATIONAL_ANALYST gets analyst widgets."""
        app.dependency_overrides[get_current_user] = _analyst_user
        db = _mock_db(
            {
                "region_id": [(100,)],
                "date_trunc": [(45,)],
                "region_name": [
                    ("NCR", 30),
                    ("Region IV-A", 25),
                    ("Region III", 20),
                    ("Region VII", 15),
                    ("Region XI", 10),
                ],
                "total_response_time": [(12.5,)],
            }
        )
        app.dependency_overrides[get_db_with_rls] = lambda: db

        resp = client.get(
            "/api/dashboard/widgets?ids=total_incidents,verified_month,by_region,by_category,avg_response_time",
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "total_incidents" in data
        assert "verified_month" in data
        assert "by_region" in data
        assert "avg_response_time" in data

    def test_analyst_by_region_returns_top5(self, client: TestClient):
        """by_region widget returns at most 5 categories."""
        app.dependency_overrides[get_current_user] = _analyst_user
        db = _mock_db(
            {
                "region_name": [
                    ("NCR", 30),
                    ("Region IV-A", 25),
                    ("Region III", 20),
                    ("Region VII", 15),
                    ("Region XI", 10),
                ],
            }
        )
        app.dependency_overrides[get_db_with_rls] = lambda: db

        resp = client.get("/api/dashboard/widgets?ids=by_region")
        assert resp.status_code == 200
        data = resp.json()
        categories = data["by_region"]["categories"]
        assert len(categories) == 5


class TestMixedIds:
    def test_mixed_valid_and_invalid_ids(self, client: TestClient):
        """Mixed valid/invalid IDs return only valid ones."""
        app.dependency_overrides[get_current_user] = _validator_user
        db = _mock_db(
            {
                "PENDING": [(10,)],
            }
        )
        app.dependency_overrides[get_db_with_rls] = lambda: db

        resp = client.get(
            "/api/dashboard/widgets?ids=awaiting_validation,invalid_widget,another_fake",
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "awaiting_validation" in data
        assert "invalid_widget" not in data

    def test_db_error_handled_gracefully(self, client: TestClient):
        """DB errors are caught and returned as error values."""
        app.dependency_overrides[get_current_user] = _validator_user
        db = MagicMock()
        db.execute.side_effect = RuntimeError("DB connection lost")
        app.dependency_overrides[get_db_with_rls] = lambda: db

        resp = client.get("/api/dashboard/widgets?ids=awaiting_validation")
        assert resp.status_code == 200
        data = resp.json()
        assert "awaiting_validation" in data
        assert "error" in data["awaiting_validation"]
