"""
TDD: Validator civilian profile endpoint (issue #577).

Covers:
- GET /api/civilian/contributor/{user_id}  (NATIONAL_VALIDATOR) returns combined profile + reports
- RBAC: non-validator roles are rejected
- Invalid user_id UUID returns 400
"""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import database
from auth import get_current_wims_user
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def mock_validator_user():
    return {
        "user_id": "22222222-2222-4222-8222-222222222222",
        "keycloak_id": "kid-validator",
        "username": "validator",
        "role": "NATIONAL_VALIDATOR",
    }


def mock_civilian_user():
    return {
        "user_id": "cccc2222-2222-4222-8222-222222222222",
        "keycloak_id": "kid-civ",
        "username": "civ",
        "role": "CIVILIAN_REPORTER",
    }


def _mock_db():
    mock_result = MagicMock()
    mock_result.fetchone.return_value = (None,)
    mock_db = MagicMock()
    mock_db.execute.return_value = mock_result

    def mock_get_db():
        yield mock_db

    return mock_db, mock_get_db


VALIDATOR_PROFILE = {
    "trust_score": 60,
    "badge": "TRUSTED",
    "total_reports": 10,
    "actioned_reports": 4,
    "pending_reports": 2,
    "volume_progress": 0.5,
    "outcome_accuracy": 0.4,
    "evidence_quality": 0.6,
    "consistency": 0.3,
    "decay": 0,
    "formula_version": "reliability-v1",
    "decided_reports": 4,
    "active_months": 3,
    "first_report_at": None,
    "last_report_at": None,
}

VALIDATOR_REPORTS = {
    **VALIDATOR_PROFILE,
    "reports": [
        {
            "report_id": 1,
            "created_at": "2026-01-01T00:00:00+00:00",
            "category": "STRUCTURAL",
            "sub_category": None,
            "status": "PENDING",
            "latitude": 0.0,
            "longitude": 0.0,
        }
    ],
    "total": 10,
    "page": 1,
    "limit": 20,
    "pages": 1,
}


class TestValidatorCivilianProfile:
    def test_returns_combined_profile_and_reports(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_validator_user
        _, mock_get_db = _mock_db()
        app.dependency_overrides[database.get_db] = mock_get_db

        uid = uuid.uuid4()
        with patch(
            "api.routes.civilian.contributor_profile", return_value=dict(VALIDATOR_PROFILE)
        ) as mock_profile, patch(
            "api.routes.civilian.get_contributor_reports", return_value=dict(VALIDATOR_REPORTS)
        ) as mock_reports:
            resp = client.get(f"/api/civilian/contributor/{uid}")

        assert resp.status_code == 200
        data = resp.json()
        assert "profile" in data and "reports" in data
        assert data["profile"]["trust_score"] == 60
        assert data["reports"]["total"] == 10
        assert data["reports"]["reports"][0]["report_id"] == 1
        mock_profile.assert_called_once_with(str(uid), mock_get_db().__next__())
        mock_reports.assert_called_once()

    def test_rejects_non_validator(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_civilian_user
        _, mock_get_db = _mock_db()
        app.dependency_overrides[database.get_db] = mock_get_db

        resp = client.get(f"/api/civilian/contributor/{uuid.uuid4()}")
        assert resp.status_code in (401, 403)

    def test_invalid_uuid_returns_400(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_validator_user
        _, mock_get_db = _mock_db()
        app.dependency_overrides[database.get_db] = mock_get_db

        resp = client.get("/api/civilian/contributor/not-a-uuid")
        assert resp.status_code == 400

    def test_static_contributor_routes_still_resolve(self, client: TestClient):
        """Regression: /api/civilian/contributor/{user_id} must not shadow /contributor/me etc."""
        # /contributor/me requires CIVILIAN_REPORTER; a validator should 403 on /me,
        # proving the static route still resolves separately from the {user_id} route.
        app.dependency_overrides[get_current_wims_user] = mock_validator_user
        _, mock_get_db = _mock_db()
        app.dependency_overrides[database.get_db] = mock_get_db

        resp = client.get("/api/civilian/contributor/me")
        assert resp.status_code == 403
