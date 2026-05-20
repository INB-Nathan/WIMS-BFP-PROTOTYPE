"""
Civilian Reporting Phase 2 API integration tests.

Run:
  cd src && docker compose run --rm backend pytest tests/integration/test_civilian_api.py -v
"""

from __future__ import annotations

import os
import sys
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from database import _SessionLocal  # noqa: E402, SLF001
from main import app  # noqa: E402


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db_session():
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _payload(**overrides):
    payload = {
        "latitude": 14.5995,
        "longitude": 120.9842,
        "category": "STRUCTURAL",
        "sub_category": "Residential",
        "reported_at": "2026-05-20T10:00:00+08:00",
        "device_id": str(uuid.uuid4()),
        "reporting_context": "WITNESS",
        "safety_status": "I_AM_SAFE",
        "phone_latitude": 14.5995,
        "phone_longitude": 120.9842,
        "gps_distance_m": 0,
        "gps_warning_confirmed": False,
        "witness_name": "Juan Dela Cruz",
        "witness_phone": "09170000000",
    }
    payload.update(overrides)
    return payload


def _insert_report(
    db: Session,
    *,
    status: str = "PENDING",
    status_explanation: str | None = None,
) -> int:
    validated_by = None
    if status == "ACTIONED":
        user_row = db.execute(
            text("""
                INSERT INTO wims.users (keycloak_id, username, role)
                VALUES (:keycloak_id, :username, 'NATIONAL_VALIDATOR')
                RETURNING user_id
            """),
            {
                "keycloak_id": str(uuid.uuid4()),
                "username": f"validator_{uuid.uuid4().hex[:10]}",
            },
        ).fetchone()
        validated_by = user_row[0]

    row = db.execute(
        text("""
            INSERT INTO wims.citizen_reports (
                location, category, sub_category, reporting_context, safety_status,
                device_id, status, status_explanation, validated_by
            )
            VALUES (
                ST_GeogFromText('SRID=4326;POINT(120.9842 14.5995)'),
                'STRUCTURAL', 'Residential', 'WITNESS', 'I_AM_SAFE',
                :device_id, :status, :status_explanation, :validated_by
            )
            RETURNING report_id
        """),
        {
            "device_id": str(uuid.uuid4()),
            "status": status,
            "status_explanation": status_explanation,
            "validated_by": validated_by,
        },
    ).fetchone()
    db.commit()
    return int(row[0])


class TestCivilianReportPublicSubmission:
    def test_public_can_submit_structured_report(self, client):
        response = client.post(
            "/api/civilian/reports",
            json=_payload(),
            headers={"x-forwarded-for": "198.51.100.10"},
        )

        assert response.status_code == 201, response.text
        data = response.json()
        assert data["status"] == "PENDING"
        assert data["category"] == "STRUCTURAL"
        assert data["sub_category"] == "Residential"
        assert data["reporting_context"] == "WITNESS"
        assert data["safety_status"] == "I_AM_SAFE"
        assert data["trust_score"] > 0
        assert data["guidance"] == "Your report is waiting for review. Call 911 if there is immediate danger."
        assert "report_id" in data

    def test_duplicate_suggestions_return_nearby_active_reports(self, client, db_session):
        existing_id = _insert_report(db_session)

        response = client.post(
            "/api/civilian/reports/duplicate-suggestions",
            json=_payload(device_id=str(uuid.uuid4())),
        )

        assert response.status_code == 200, response.text
        suggestions = response.json()["suggestions"]
        assert suggestions
        assert suggestions[0]["report_id"] == existing_id
        assert suggestions[0]["distance_m"] >= 0

    def test_life_safety_duplicate_suggestions_are_suppressed(self, client, db_session):
        _insert_report(db_session)

        response = client.post(
            "/api/civilian/reports/duplicate-suggestions",
            json=_payload(safety_status="I_NEED_HELP", device_id=str(uuid.uuid4())),
        )

        assert response.status_code == 200, response.text
        assert response.json()["suggestions"] == []

    def test_previous_report_reference_is_preserved(self, client, db_session):
        previous_id = _insert_report(
            db_session,
            status="REJECTED_INSUFFICIENT",
            status_explanation="Insufficient information was available.",
        )

        response = client.post(
            "/api/civilian/reports",
            json=_payload(previous_report_id=previous_id, device_id=str(uuid.uuid4())),
            headers={"x-forwarded-for": "198.51.100.11"},
        )

        assert response.status_code == 201, response.text
        assert response.json()["previous_report_id"] == previous_id

        previous_status = db_session.execute(
            text("SELECT status FROM wims.citizen_reports WHERE report_id = :rid"),
            {"rid": previous_id},
        ).scalar()
        assert previous_status == "REJECTED_INSUFFICIENT"

    def test_invalid_coordinates_rejected(self, client):
        response = client.post(
            "/api/civilian/reports",
            json=_payload(latitude=150.0),
            headers={"x-forwarded-for": "198.51.100.12"},
        )
        assert response.status_code == 422, response.text

    def test_append_creates_linked_child_and_increments_parent(self, client, db_session):
        parent_id = _insert_report(db_session)
        response = client.patch(
            f"/api/civilian/reports/{parent_id}/append",
            json=_payload(device_id=str(uuid.uuid4()), safety_status="SOMEONE_ELSE_NEEDS_HELP"),
        )

        assert response.status_code == 201, response.text
        data = response.json()
        assert data["status"] == "LINKED"
        assert data["safety_status"] == "SOMEONE_ELSE_NEEDS_HELP"

        link_count = db_session.execute(
            text("SELECT link_count FROM wims.citizen_reports WHERE report_id = :rid"),
            {"rid": parent_id},
        ).scalar()
        assert link_count == 1

    def test_tracking_timeline_returns_parent_and_appends(self, client, db_session):
        parent_id = _insert_report(db_session)
        append_response = client.patch(
            f"/api/civilian/reports/{parent_id}/append",
            json=_payload(device_id=str(uuid.uuid4()), safety_status="SOMEONE_ELSE_NEEDS_HELP"),
        )
        assert append_response.status_code == 201, append_response.text
        child_id = append_response.json()["report_id"]

        response = client.get(f"/api/civilian/reports/{parent_id}/timeline")

        assert response.status_code == 200, response.text
        timeline = response.json()["timeline"]
        assert [item["report_id"] for item in timeline] == [parent_id, child_id]
        assert timeline[0]["status"] == "PENDING"
        assert timeline[1]["status"] == "LINKED"

    @pytest.mark.parametrize(
        ("status", "explanation"),
        [
            ("ACTIONED", "Your report was reviewed and forwarded to your local fire station."),
            ("REJECTED_BOGUS", "The report could not be verified."),
        ],
    )
    def test_append_blocked_on_terminal_parent(self, client, db_session, status, explanation):
        parent_id = _insert_report(db_session, status=status, status_explanation=explanation)

        response = client.patch(
            f"/api/civilian/reports/{parent_id}/append",
            json=_payload(device_id=str(uuid.uuid4())),
        )

        assert response.status_code == 409, response.text
        assert "Submit a new report" in response.json()["detail"]

    def test_tracking_returns_terminal_guidance_and_station_context(self, client, db_session):
        report_id = _insert_report(
            db_session,
            status="REJECTED_TIMEOUT",
            status_explanation=(
                "This report was not verified within the 2-hour emergency review window. "
                "No validator action was recorded before timeout."
            ),
        )

        response = client.get(f"/api/civilian/reports/{report_id}")

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["status"] == "REJECTED_TIMEOUT"
        assert data["status_explanation"].startswith("This report was not verified")
        assert data["escalation_guidance"] == "Submit a new report if the emergency is ongoing, or call 911."
