"""
Optimistic Concurrency Control — Integration Tests.

Tests for PUT /api/regional/incidents/{id}:
  - Stale write with client_updated_at older than server → 409
  - Force override with force_update=True → 200
  - No client_updated_at sent → 200 (legacy path, no check)

Also tests GET /api/regional/validator/incidents/{id}/diff:
  - alarm_level unchanged between snapshot and current → not in changed_fields
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from main import app
from auth import get_current_wims_user


# ---------------------------------------------------------------------------
# Fixtures (mirrors test_regional_crud.py pattern)
# ---------------------------------------------------------------------------


@pytest.fixture
def db_session():
    from database import _SessionLocal  # noqa: SLF001

    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def encoder_user(db_session: Session):
    keycloak_id = uuid.uuid4()
    username = f"encoder_occ_{keycloak_id.hex[:8]}"
    region = db_session.execute(text("SELECT region_id FROM wims.ref_regions LIMIT 1")).fetchone()
    if not region:
        region = db_session.execute(
            text(
                "INSERT INTO wims.ref_regions (region_name, region_code) VALUES ('Test OCC Region', 'TOCC') RETURNING region_id"
            )
        ).fetchone()
        db_session.commit()
    region_id = region[0]
    row = db_session.execute(
        text("""
            INSERT INTO wims.users (keycloak_id, username, role, assigned_region_id)
            VALUES (:kid, :username, 'REGIONAL_ENCODER', :rid)
            RETURNING user_id
        """),
        {"kid": keycloak_id, "username": username, "rid": region_id},
    ).fetchone()
    db_session.commit()
    return {"user_id": row[0], "region_id": region_id}


@pytest.fixture
def validator_user(db_session: Session):
    keycloak_id = uuid.uuid4()
    username = f"validator_occ_{keycloak_id.hex[:8]}"
    region = db_session.execute(text("SELECT region_id FROM wims.ref_regions LIMIT 1")).fetchone()
    region_id = region[0] if region else None
    row = db_session.execute(
        text("""
            INSERT INTO wims.users (keycloak_id, username, role, assigned_region_id)
            VALUES (:kid, :username, 'NATIONAL_VALIDATOR', :rid)
            RETURNING user_id
        """),
        {"kid": keycloak_id, "username": username, "rid": region_id},
    ).fetchone()
    db_session.commit()
    return {"user_id": row[0]}


@pytest.fixture
def mock_encoder(encoder_user):
    async def _mock():
        return {
            "user_id": encoder_user["user_id"],
            "keycloak_id": str(uuid.uuid4()),
            "role": "REGIONAL_ENCODER",
            "assigned_region_id": encoder_user["region_id"],
        }

    return _mock


@pytest.fixture
def mock_validator(validator_user):
    async def _mock():
        return {
            "user_id": validator_user["user_id"],
            "keycloak_id": str(uuid.uuid4()),
            "role": "NATIONAL_VALIDATOR",
        }

    return _mock


@pytest.fixture
def encoder_client(mock_encoder):
    app.dependency_overrides[get_current_wims_user] = mock_encoder
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_current_wims_user, None)


@pytest.fixture
def validator_client(mock_validator):
    app.dependency_overrides[get_current_wims_user] = mock_validator
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_current_wims_user, None)


@pytest.fixture
def draft_incident(encoder_client):
    """Create a minimal DRAFT incident and return its incident_id."""
    resp = encoder_client.post(
        "/api/regional/incidents",
        json={"latitude": 14.5995, "longitude": 120.9842, "alarm_level": "FIRST_ALARM"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["incident_id"]


# ---------------------------------------------------------------------------
# OCC tests
# ---------------------------------------------------------------------------


class TestOptimisticConcurrencyControl:
    def test_stale_write_returns_409(self, encoder_client, db_session, draft_incident):
        """PUT with client_updated_at older than server updated_at → 409 with server_version."""
        # Advance updated_at on the server to simulate a concurrent save
        db_session.execute(
            text(
                "UPDATE wims.fire_incidents SET updated_at = now() + interval '10 seconds' WHERE incident_id = :iid"
            ),
            {"iid": draft_incident},
        )
        db_session.commit()

        # Client sends a timestamp from *before* the concurrent update
        stale_ts = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()

        resp = encoder_client.put(
            f"/api/regional/incidents/{draft_incident}",
            json={
                "alarm_level": "SECOND_ALARM",
                "client_updated_at": stale_ts,
            },
        )

        assert resp.status_code == 409, resp.text
        data = resp.json()
        detail = data.get("detail", {})
        assert "message" in detail
        assert "server_version" in detail
        assert isinstance(detail["server_version"], dict)

    def test_force_update_bypasses_occ(self, encoder_client, db_session, draft_incident):
        """PUT with force_update=True skips the concurrency check and succeeds."""
        db_session.execute(
            text(
                "UPDATE wims.fire_incidents SET updated_at = now() + interval '10 seconds' WHERE incident_id = :iid"
            ),
            {"iid": draft_incident},
        )
        db_session.commit()

        stale_ts = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()

        resp = encoder_client.put(
            f"/api/regional/incidents/{draft_incident}",
            json={
                "alarm_level": "SECOND_ALARM",
                "client_updated_at": stale_ts,
                "force_update": True,
            },
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "updated"

    def test_no_client_updated_at_always_succeeds(self, encoder_client, db_session, draft_incident):
        """PUT without client_updated_at (legacy clients) always succeeds."""
        db_session.execute(
            text(
                "UPDATE wims.fire_incidents SET updated_at = now() + interval '10 seconds' WHERE incident_id = :iid"
            ),
            {"iid": draft_incident},
        )
        db_session.commit()

        resp = encoder_client.put(
            f"/api/regional/incidents/{draft_incident}",
            json={"alarm_level": "SECOND_ALARM"},
        )

        assert resp.status_code == 200, resp.text

    def test_fresh_client_updated_at_succeeds(self, encoder_client, db_session, draft_incident):
        """PUT with client_updated_at matching or after server updated_at succeeds."""
        future_ts = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()

        resp = encoder_client.put(
            f"/api/regional/incidents/{draft_incident}",
            json={
                "alarm_level": "SECOND_ALARM",
                "client_updated_at": future_ts,
            },
        )

        assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# Diff endpoint normalization tests
# ---------------------------------------------------------------------------


class TestDiffEndpointNormalization:
    def _create_incident_with_snapshot(self, encoder_client, db_session, alarm_level: str) -> int:
        """Create incident, then set a submitted_snapshot with the given alarm_level."""
        resp = encoder_client.post(
            "/api/regional/incidents",
            json={
                "latitude": 14.5995,
                "longitude": 120.9842,
                "alarm_level": alarm_level,
            },
        )
        assert resp.status_code == 201, resp.text
        iid = resp.json()["incident_id"]

        # Write a snapshot that matches the submitted value — simulates first PENDING transition
        db_session.execute(
            text("""
                UPDATE wims.fire_incidents
                SET submitted_snapshot = jsonb_build_object('alarm_level', :alarm)
                WHERE incident_id = :iid
            """),
            {"alarm": alarm_level, "iid": iid},
        )
        db_session.commit()
        return iid

    def test_alarm_level_unchanged_not_in_changed_fields(
        self, mock_encoder, mock_validator, db_session
    ):
        """alarm_level that matches snapshot should NOT appear in changed_fields.

        Uses sequential override management to avoid fixture conflict:
        encoder_client and validator_client both write to the same
        app.dependency_overrides key and cannot coexist in one test.
        """
        # Phase 1 — create incident + snapshot under encoder role
        app.dependency_overrides[get_current_wims_user] = mock_encoder
        with TestClient(app) as enc_client:
            resp = enc_client.post(
                "/api/regional/incidents",
                json={"latitude": 14.5995, "longitude": 120.9842, "alarm_level": "1st Alarm"},
            )
            assert resp.status_code == 201, resp.text
            iid = resp.json()["incident_id"]

        db_session.execute(
            text("""
                UPDATE wims.fire_incidents
                SET submitted_snapshot = jsonb_build_object('alarm_level', :alarm)
                WHERE incident_id = :iid
            """),
            {"alarm": "1st Alarm", "iid": iid},
        )
        db_session.execute(
            text("""
                UPDATE wims.incident_nonsensitive_details
                SET alarm_level = '1st Alarm'
                WHERE incident_id = :iid
            """),
            {"iid": iid},
        )
        db_session.execute(
            text(
                "UPDATE wims.fire_incidents SET verification_status = 'PENDING' WHERE incident_id = :iid"
            ),
            {"iid": iid},
        )
        db_session.commit()

        # Phase 2 — diff check under validator role
        app.dependency_overrides[get_current_wims_user] = mock_validator
        with TestClient(app) as val_client:
            resp = val_client.get(f"/api/regional/validator/incidents/{iid}/diff")
        app.dependency_overrides.pop(get_current_wims_user, None)

        assert resp.status_code == 200, f"Got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "alarm_level" not in data.get("changed_fields", [])
