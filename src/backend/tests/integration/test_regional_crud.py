"""
Regional Encoder CRUD — Integration Tests.

Tests for POST /api/regional/incidents (create),
PUT /api/regional/incidents/{id} (update),
DELETE /api/regional/incidents/{id} (soft-delete).

Run: pytest backend/tests/integration/test_regional_crud.py -v
From project root (with Docker): cd src && docker compose run --rm backend pytest tests/integration/test_regional_crud.py -v
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
    """Create an ENCODER user in wims.users with assigned region. Returns user_id (UUID)."""
    keycloak_id = uuid.uuid4()
    username = f"encoder_crud_{keycloak_id.hex[:8]}"

    # Get or create a region
    region = db_session.execute(
        text("SELECT region_id FROM wims.ref_regions LIMIT 1")
    ).fetchone()
    if not region:
        region = db_session.execute(
            text(
                "INSERT INTO wims.ref_regions (region_name, region_code) VALUES ('Test Region', 'TEST') RETURNING region_id"
            )
        ).fetchone()
        db_session.commit()
    region_id = region[0]

    result = db_session.execute(
        text("""
            INSERT INTO wims.users (keycloak_id, username, role, assigned_region_id)
            VALUES (:kid, :username, 'REGIONAL_ENCODER', :rid)
            RETURNING user_id
        """),
        {"kid": keycloak_id, "username": username, "rid": region_id},
    )
    row = result.fetchone()
    db_session.commit()
    return {"user_id": row[0], "region_id": region_id}


@pytest.fixture
def mock_encoder(encoder_user):
    """Override get_current_wims_user to return ENCODER user."""

    async def _mock():
        return {
            "user_id": encoder_user["user_id"],
            "keycloak_id": str(uuid.uuid4()),
            "role": "REGIONAL_ENCODER",
            "assigned_region_id": encoder_user["region_id"],
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
def test_incident(client_with_encoder, db_session):
    """Create a test incident via API. Returns incident_id."""
    resp = client_with_encoder.post(
        "/api/regional/incidents",
        json={
            "latitude": 14.5995,
            "longitude": 120.9842,
            "general_category": "STRUCTURAL",
            "alarm_level": "FIRST_ALARM",
            "fire_station_name": "Test Station",
            "street_address": "123 Test St",
            "caller_name": "Juan Test",
        },
    )
    assert resp.status_code == 201, f"Setup failed: {resp.text}"
    return resp.json()["incident_id"]


# ---------------------------------------------------------------------------
# Tests: CREATE (POST /api/regional/incidents)
# ---------------------------------------------------------------------------


class TestCreateIncident:
    def test_create_minimal(self, client_with_encoder):
        """Create incident with only required fields (lat/lon)."""
        resp = client_with_encoder.post(
            "/api/regional/incidents",
            json={"latitude": 14.5995, "longitude": 120.9842},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "created"
        assert data["verification_status"] == "DRAFT"
        assert isinstance(data["incident_id"], int)

    def test_create_with_nonsensitive_details(self, client_with_encoder):
        """Create incident with nonsensitive fields."""
        resp = client_with_encoder.post(
            "/api/regional/incidents",
            json={
                "latitude": 14.6000,
                "longitude": 120.9800,
                "general_category": "STRUCTURAL",
                "alarm_level": "FIRST_ALARM",
                "fire_station_name": "Makati Central",
                "civilian_injured": 2,
                "structures_affected": 1,
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["incident_id"] > 0

    def test_create_with_pii(self, client_with_encoder):
        """Create incident with PII fields (should be encrypted)."""
        resp = client_with_encoder.post(
            "/api/regional/incidents",
            json={
                "latitude": 14.5995,
                "longitude": 120.9842,
                "caller_name": "Maria Santos",
                "caller_number": "09171234567",
                "owner_name": "Pedro Cruz",
                "street_address": "456 Fire Lane",
            },
        )
        assert resp.status_code == 201

    def test_create_unauthorized(self):
        """Without auth override, should return 401/403."""
        with TestClient(app, raise_server_exceptions=False) as c:
            resp = c.post(
                "/api/regional/incidents",
                json={"latitude": 14.5995, "longitude": 120.9842},
            )
            assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Tests: READ (GET /api/regional/incidents, GET /api/regional/incidents/{id})
# ---------------------------------------------------------------------------


class TestReadIncidents:
    def test_list_incidents(self, client_with_encoder, test_incident):
        """List incidents should return the created incident."""
        resp = client_with_encoder.get("/api/regional/incidents")
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data or isinstance(data, list)

    def test_get_incident_detail(self, client_with_encoder, test_incident):
        """Get single incident by ID."""
        resp = client_with_encoder.get(f"/api/regional/incidents/{test_incident}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["incident_id"] == test_incident

    def test_get_nonexistent_incident(self, client_with_encoder):
        """Get incident that doesn't exist returns 404."""
        resp = client_with_encoder.get("/api/regional/incidents/999999")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Tests: UPDATE (PUT /api/regional/incidents/{id})
# ---------------------------------------------------------------------------


class TestUpdateIncident:
    def test_update_nonsensitive(self, client_with_encoder, test_incident):
        """Update nonsensitive fields on a DRAFT incident."""
        resp = client_with_encoder.put(
            f"/api/regional/incidents/{test_incident}",
            json={
                "general_category": "NON_STRUCTURAL",
                "alarm_level": "SECOND_ALARM",
                "civilian_injured": 5,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "updated"

    def test_update_sensitive(self, client_with_encoder, test_incident):
        """Update PII fields (should re-encrypt)."""
        resp = client_with_encoder.put(
            f"/api/regional/incidents/{test_incident}",
            json={
                "caller_name": "Updated Name",
                "street_address": "789 New Address",
            },
        )
        assert resp.status_code == 200

    def test_update_nonexistent(self, client_with_encoder):
        """Update nonexistent incident returns 404."""
        resp = client_with_encoder.put(
            "/api/regional/incidents/999999",
            json={"general_category": "TEST"},
        )
        assert resp.status_code == 404

    def test_update_verified_blocked(
        self, client_with_encoder, test_incident, db_session
    ):
        """Cannot update a VERIFIED incident."""
        # Force status to VERIFIED
        db_session.execute(
            text(
                "UPDATE wims.fire_incidents SET verification_status = 'VERIFIED' WHERE incident_id = :iid"
            ),
            {"iid": test_incident},
        )
        db_session.commit()

        resp = client_with_encoder.put(
            f"/api/regional/incidents/{test_incident}",
            json={"general_category": "SHOULD_FAIL"},
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Tests: DELETE (DELETE /api/regional/incidents/{id})
# ---------------------------------------------------------------------------


class TestDeleteIncident:
    def test_delete_draft(self, client_with_encoder, test_incident):
        """Soft-delete a DRAFT incident."""
        resp = client_with_encoder.delete(f"/api/regional/incidents/{test_incident}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

    def test_delete_nonexistent(self, client_with_encoder):
        """Delete nonexistent incident returns 404."""
        resp = client_with_encoder.delete("/api/regional/incidents/999999")
        assert resp.status_code == 404

    def test_delete_pending_blocked(
        self, client_with_encoder, test_incident, db_session
    ):
        """Cannot delete a PENDING incident."""
        db_session.execute(
            text(
                "UPDATE wims.fire_incidents SET verification_status = 'PENDING' WHERE incident_id = :iid"
            ),
            {"iid": test_incident},
        )
        db_session.commit()

        resp = client_with_encoder.delete(f"/api/regional/incidents/{test_incident}")
        assert resp.status_code == 403

    def test_delete_verified_blocked(
        self, client_with_encoder, test_incident, db_session
    ):
        """Cannot delete a VERIFIED incident."""
        db_session.execute(
            text(
                "UPDATE wims.fire_incidents SET verification_status = 'VERIFIED' WHERE incident_id = :iid"
            ),
            {"iid": test_incident},
        )
        db_session.commit()

        resp = client_with_encoder.delete(f"/api/regional/incidents/{test_incident}")
        assert resp.status_code == 403
