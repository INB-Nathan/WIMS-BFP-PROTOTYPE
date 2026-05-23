"""
Triage Queue and Promotion Workflow — Integration Tests (RED State).

Test 1: GET /api/triage/pending — returns citizen_reports where status == 'PENDING'.
Test 2: POST /api/triage/{report_id}/promote — 201 Created, citizen_report VERIFIED,
        validated_by set, new fire_incident with matching coordinates.

Run: pytest backend/tests/integration/test_triage_api.py -v
From project root (with Docker): cd src && docker compose run --rm backend pytest tests/integration/test_triage_api.py -v
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from main import app
from auth import get_current_wims_user


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def db_session():
    """Yield a DB session for test setup/teardown."""
    from database import _SessionLocal  # noqa: SLF001

    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def encoder_user(db_session: Session):
    """Create an ENCODER user in wims.users. Returns user_id (UUID)."""
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
def mock_encoder(encoder_user):
    """Override get_current_wims_user to return ENCODER user."""

    async def _mock():
        return {
            "user_id": encoder_user,
            "keycloak_id": str(uuid.uuid4()),
            "role": "REGIONAL_ENCODER",
        }

    return _mock


@pytest.fixture
def client_with_encoder(mock_encoder):
    """TestClient with get_current_wims_user overridden to ENCODER."""
    app.dependency_overrides[get_current_wims_user] = mock_encoder
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_current_wims_user, None)


@pytest.fixture
def pending_report(db_session: Session):
    """Insert a PENDING citizen_report. Returns (report_id, lat, lon)."""
    wkt = "SRID=4326;POINT(121.05 14.60)"
    result = db_session.execute(
        text("""
            INSERT INTO wims.citizen_reports (location, description, status, category)
            VALUES (ST_GeogFromText(:wkt), 'Fire incident', 'PENDING', 'STRUCTURAL')
            RETURNING report_id
        """),
        {"wkt": wkt},
    )
    row = result.fetchone()
    db_session.commit()
    report_id = row[0]
    coord = db_session.execute(
        text(
            "SELECT ST_Y(location::geometry), ST_X(location::geometry) FROM wims.citizen_reports WHERE report_id = :rid"
        ),
        {"rid": report_id},
    ).fetchone()
    return report_id, float(coord[0]), float(coord[1])


# ---------------------------------------------------------------------------
# Test 1: GET /api/triage/pending
# ---------------------------------------------------------------------------


def test_get_triage_pending_returns_pending_reports(
    client_with_encoder, pending_report, db_session
):
    """
    GET /api/triage/pending with ENCODER token returns list of citizen_reports
    where status == 'PENDING'.
    """
    report_id, lat, lon = pending_report

    response = client_with_encoder.get("/api/triage/pending")

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    ids = [r["report_id"] for r in data]
    assert report_id in ids
    for r in data:
        assert r["status"] == "PENDING"
    # Find our report
    ours = next(r for r in data if r["report_id"] == report_id)
    assert ours["status"] == "PENDING"


def test_get_triage_pending_excludes_non_pending(client_with_encoder, db_session, encoder_user):
    """PENDING reports only; UNDER_REVIEW/LINKED/ACTIONED excluded."""
    wkt = "SRID=4326;POINT(121.10 14.65)"
    db_session.execute(
        text("""
            INSERT INTO wims.citizen_reports (location, description, status, validated_by, category)
            VALUES (ST_GeogFromText(:wkt), 'Already under review', 'UNDER_REVIEW', :uid, 'STRUCTURAL')
        """),
        {"wkt": wkt, "uid": encoder_user},
    )
    db_session.execute(
        text("""
            INSERT INTO wims.citizen_reports (location, description, status, category)
            VALUES (ST_GeogFromText('SRID=4326;POINT(121.11 14.66)'), 'Still pending', 'PENDING', 'STRUCTURAL')
        """),
    )
    db_session.commit()

    response = client_with_encoder.get("/api/triage/pending")

    assert response.status_code == 200
    data = response.json()
    assert all(r["status"] == "PENDING" for r in data)
    assert not any(r.get("description") == "Already under review" for r in data)
    assert any(r.get("description") == "Still pending" for r in data)


# ---------------------------------------------------------------------------
# Test 2: POST /api/triage/{report_id}/promote
# ---------------------------------------------------------------------------


def test_promote_report_returns_410_gone(client_with_encoder, pending_report):
    """
    POST /api/triage/{report_id}/promote is deprecated (Phase 2).
    Returns 410 Gone for all requests.
    """
    report_id, lat, lon = pending_report

    response = client_with_encoder.post(f"/api/triage/{report_id}/promote")

    assert response.status_code == 410
    assert "disabled" in response.json()["detail"].lower()


def test_promote_nonexistent_report_returns_410(client_with_encoder):
    """POST /api/triage/99999/promote for non-existent report returns 410 (deprecated)."""
    response = client_with_encoder.post("/api/triage/99999/promote")
    assert response.status_code == 410


def test_promote_already_reviewed_report_returns_410(client_with_encoder, db_session, encoder_user):
    """Promoting an already UNDER_REVIEW report returns 410 (deprecated endpoint)."""
    wkt = "SRID=4326;POINT(121.20 14.70)"
    result = db_session.execute(
        text("""
            INSERT INTO wims.citizen_reports (location, description, status, validated_by, category)
            VALUES (ST_GeogFromText(:wkt), 'Already under review', 'UNDER_REVIEW', :uid, 'STRUCTURAL')
            RETURNING report_id
        """),
        {"wkt": wkt, "uid": encoder_user},
    )
    report_id = result.fetchone()[0]
    db_session.commit()

    response = client_with_encoder.post(f"/api/triage/{report_id}/promote")

    assert response.status_code == 410
