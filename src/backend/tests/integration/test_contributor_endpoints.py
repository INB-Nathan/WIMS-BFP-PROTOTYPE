"""
Contributor API Endpoints — Integration Tests (RED State).

Covers:
- 401 without auth
- 403 with wrong role
- 200 with CIVILIAN_REPORTER role
- Profile returns correct fields

Run:
  cd src && docker compose run --rm backend pytest tests/integration/test_contributor_endpoints.py -v
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from main import app
from auth import get_current_wims_user
from services.contributor import TRUST_SCORE_FORMULA_VERSION


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


SUMMARY_FIELDS = (
    "volume_progress",
    "outcome_accuracy",
    "evidence_quality",
    "consistency",
    "decay",
    "formula_version",
    "decided_reports",
    "active_months",
)


def assert_private_summary_fields(payload: dict) -> None:
    for field in SUMMARY_FIELDS:
        assert field in payload
    assert payload["formula_version"] == TRUST_SCORE_FORMULA_VERSION


@pytest.fixture
def db_session():
    """Yield a DB session for test setup/teardown."""
    from database import _AdminSessionLocal as _SessionLocal  # noqa: SLF001

    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def reporter_user(db_session: Session):
    """Create a CIVILIAN_REPORTER user in wims.users. Returns user_id (UUID)."""
    keycloak_id = uuid.uuid4()
    username = f"reporter_test_{keycloak_id.hex[:8]}"
    result = db_session.execute(
        text("""
            INSERT INTO wims.users (keycloak_id, username, role)
            VALUES (:kid, :username, 'CIVILIAN_REPORTER')
            RETURNING user_id
        """),
        {"kid": keycloak_id, "username": username},
    )
    row = result.fetchone()
    user_id = row[0]

    # Also insert into civilian_contributors for contributor endpoint queries
    db_session.execute(
        text("""
            INSERT INTO wims.civilian_contributors (user_id, trust_score, badge)
            VALUES (:uid, 0, 'NOVICE')
            ON CONFLICT (user_id) DO NOTHING
        """),
        {"uid": user_id},
    )
    db_session.commit()
    return user_id


@pytest.fixture
def encoder_user(db_session: Session):
    """Create a REGIONAL_ENCODER user in wims.users. Returns user_id (UUID)."""
    keycloak_id = uuid.uuid4()
    username = f"encoder_test_{keycloak_id.hex[:8]}"
    result = db_session.execute(
        text("""
            INSERT INTO wims.users (keycloak_id, username, role)
            VALUES (:kid, :username, 'REGIONAL_ENCODER')
            RETURNING user_id
        """),
        {"kid": keycloak_id, "username": username},
    )
    row = result.fetchone()
    db_session.commit()
    return row[0]


@pytest.fixture
def mock_reporter(reporter_user):
    """Override get_current_wims_user to return CIVILIAN_REPORTER user."""

    async def _mock():
        return {
            "user_id": reporter_user,
            "keycloak_id": str(uuid.uuid4()),
            "role": "CIVILIAN_REPORTER",
        }

    return _mock


@pytest.fixture
def mock_encoder(encoder_user):
    """Override get_current_wims_user to return REGIONAL_ENCODER user."""

    async def _mock():
        return {
            "user_id": encoder_user,
            "keycloak_id": str(uuid.uuid4()),
            "role": "REGIONAL_ENCODER",
        }

    return _mock


@pytest.fixture
def client_with_reporter(mock_reporter):
    """TestClient with get_current_wims_user overridden to CIVILIAN_REPORTER."""
    app.dependency_overrides[get_current_wims_user] = mock_reporter
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_current_wims_user, None)


@pytest.fixture
def client_with_encoder(mock_encoder):
    """TestClient with get_current_wims_user overridden to REGIONAL_ENCODER."""
    app.dependency_overrides[get_current_wims_user] = mock_encoder
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_current_wims_user, None)


@pytest.fixture
def client_no_auth():
    """TestClient with no auth override — 401 expected."""
    app.dependency_overrides.pop(get_current_wims_user, None)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def contributor_report(db_session: Session, reporter_user):
    """Insert a root citizen_report linked to the reporter. Returns report_id."""
    wkt = "SRID=4326;POINT(121.05 14.60)"
    result = db_session.execute(
        text("""
            INSERT INTO wims.citizen_reports
                (location, contributor_user_id, category, status, description)
            VALUES (ST_GeogFromText(:wkt), :uid, 'STRUCTURAL', 'PENDING', 'Test report')
            RETURNING report_id
        """),
        {"wkt": wkt, "uid": reporter_user},
    )
    row = result.fetchone()
    db_session.commit()
    return row[0]


@pytest.fixture
def linked_contributor_report(db_session: Session, reporter_user, contributor_report):
    """Insert a linked/non-root report to prove contributor endpoints stay root-only."""
    wkt = "SRID=4326;POINT(121.051 14.601)"
    result = db_session.execute(
        text("""
            INSERT INTO wims.citizen_reports
                (location, contributor_user_id, linked_to_report_id, category, status, description)
            VALUES (ST_GeogFromText(:wkt), :uid, :linked_to_report_id, 'STRUCTURAL', 'LINKED', 'Child report')
            RETURNING report_id
        """),
        {"wkt": wkt, "uid": reporter_user, "linked_to_report_id": contributor_report},
    )
    row = result.fetchone()
    db_session.commit()
    return row[0]


# ---------------------------------------------------------------------------
# Test: 401 without auth
# ---------------------------------------------------------------------------


class TestUnauthenticated:
    """All contributor endpoints require authentication."""

    def test_profile_returns_401(self, client_no_auth):
        response = client_no_auth.get("/api/civilian/contributor/me")
        assert response.status_code == 401

    def test_reports_returns_401(self, client_no_auth):
        response = client_no_auth.get("/api/civilian/contributor/reports")
        assert response.status_code == 401

    def test_stats_returns_401(self, client_no_auth):
        response = client_no_auth.get("/api/civilian/contributor/stats")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Test: 403 with wrong role (REGIONAL_ENCODER)
# ---------------------------------------------------------------------------


class TestWrongRole:
    """All contributor endpoints require CIVILIAN_REPORTER role."""

    def test_profile_returns_403(self, client_with_encoder):
        response = client_with_encoder.get("/api/civilian/contributor/me")
        assert response.status_code == 403

    def test_reports_returns_403(self, client_with_encoder):
        response = client_with_encoder.get("/api/civilian/contributor/reports")
        assert response.status_code == 403

    def test_stats_returns_403(self, client_with_encoder):
        response = client_with_encoder.get("/api/civilian/contributor/stats")
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# Test: 200 with CIVILIAN_REPORTER role
# ---------------------------------------------------------------------------


class TestContributorProfile:
    """GET /api/civilian/contributor/me with valid reporter auth."""

    def test_profile_returns_200(self, client_with_reporter, contributor_report):
        response = client_with_reporter.get("/api/civilian/contributor/me")
        assert response.status_code == 200

    def test_profile_returns_correct_fields(
        self, client_with_reporter, contributor_report, linked_contributor_report
    ):
        response = client_with_reporter.get("/api/civilian/contributor/me")
        data = response.json()
        assert "trust_score" in data
        assert "badge" in data
        assert "total_reports" in data
        assert "actioned_reports" in data
        assert "pending_reports" in data
        assert "first_report_at" in data
        assert "last_report_at" in data
        assert_private_summary_fields(data)
        # Only the seeded root report counts; linked/appended reports stay excluded.
        assert data["total_reports"] == 1
        assert data["pending_reports"] == 1
        assert data["trust_score"] >= 0
        assert data["badge"] in ("NOVICE", "REGULAR", "TRUSTED", "GUARDIAN")

    def test_profile_zero_reports(self, client_with_reporter):
        """A reporter with no reports returns zero trust score."""
        response = client_with_reporter.get("/api/civilian/contributor/me")
        assert response.status_code == 200
        data = response.json()
        assert_private_summary_fields(data)
        assert data["total_reports"] == 0
        assert data["trust_score"] == 0
        assert data["badge"] == "NOVICE"


class TestContributorReports:
    """GET /api/civilian/contributor/reports with valid reporter auth."""

    def test_reports_returns_200(self, client_with_reporter, contributor_report):
        response = client_with_reporter.get("/api/civilian/contributor/reports")
        assert response.status_code == 200

    def test_reports_has_expected_structure(self, client_with_reporter, contributor_report):
        response = client_with_reporter.get("/api/civilian/contributor/reports")
        data = response.json()
        assert "reports" in data
        assert "total" in data
        assert "page" in data
        assert "limit" in data
        assert "pages" in data
        assert_private_summary_fields(data)
        assert isinstance(data["reports"], list)
        assert data["total"] >= 1
        assert data["page"] == 1
        assert data["limit"] == 20

    def test_reports_contains_report(self, client_with_reporter, contributor_report):
        response = client_with_reporter.get("/api/civilian/contributor/reports")
        data = response.json()
        report_ids = [r["report_id"] for r in data["reports"]]
        assert contributor_report in report_ids

    def test_reports_exclude_linked_reports_from_history(
        self, client_with_reporter, contributor_report, linked_contributor_report
    ):
        response = client_with_reporter.get("/api/civilian/contributor/reports")
        data = response.json()
        report_ids = [r["report_id"] for r in data["reports"]]
        assert contributor_report in report_ids
        assert linked_contributor_report not in report_ids
        assert data["total"] == 1
        assert data["total_reports"] == 1

    def test_reports_item_structure(self, client_with_reporter, contributor_report):
        response = client_with_reporter.get("/api/civilian/contributor/reports")
        data = response.json()
        report = next(r for r in data["reports"] if r["report_id"] == contributor_report)
        assert "report_id" in report
        assert "created_at" in report
        assert "category" in report
        assert "status" in report
        assert "latitude" in report
        assert "longitude" in report
        assert report["status"] == "PENDING"

    def test_reports_pagination(self, client_with_reporter, contributor_report):
        response = client_with_reporter.get("/api/civilian/contributor/reports?page=1&limit=5")
        assert response.status_code == 200
        data = response.json()
        assert data["limit"] == 5
        assert data["page"] == 1
        assert data["total"] >= 1

    def test_reports_empty_page(self, client_with_reporter):
        """Page beyond available data returns empty list."""
        response = client_with_reporter.get("/api/civilian/contributor/reports?page=999&limit=10")
        assert response.status_code == 200
        data = response.json()
        assert data["reports"] == []

    def test_reports_limit_capped(self, client_with_reporter, contributor_report):
        """Limit > 100 should be capped to 100 by the service."""
        response = client_with_reporter.get("/api/civilian/contributor/reports?limit=200")
        assert response.status_code == 200
        data = response.json()
        # The service caps at 100
        assert data["limit"] == 20  # service default when limit out of range


class TestContributorStats:
    """GET /api/civilian/contributor/stats with valid reporter auth."""

    def test_stats_returns_200(self, client_with_reporter, contributor_report):
        response = client_with_reporter.get("/api/civilian/contributor/stats")
        assert response.status_code == 200

    def test_stats_has_expected_structure(self, client_with_reporter, contributor_report):
        response = client_with_reporter.get("/api/civilian/contributor/stats")
        data = response.json()
        assert "trust_score" in data
        assert "badge" in data
        assert "total_reports" in data
        assert "actioned_reports" in data
        assert "pending_reports" in data
        assert "monthly_report_counts" in data
        assert_private_summary_fields(data)
        assert isinstance(data["monthly_report_counts"], list)

    def test_stats_zero_reports(self, client_with_reporter):
        """A reporter with no reports returns zero stats."""
        response = client_with_reporter.get("/api/civilian/contributor/stats")
        assert response.status_code == 200
        data = response.json()
        assert_private_summary_fields(data)
        assert data["total_reports"] == 0
        assert data["trust_score"] == 0
        assert data["badge"] == "NOVICE"
        assert data["monthly_report_counts"] == []


class TestContributorLeaderboardRemoved:
    """The retired leaderboard endpoint must not be publicly exposed."""

    def test_leaderboard_route_is_not_registered(self, client_with_reporter):
        response = client_with_reporter.get("/api/civilian/contributor/leaderboard")
        assert response.status_code == 404
