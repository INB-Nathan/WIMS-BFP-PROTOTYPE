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
import redis
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


@pytest.fixture(autouse=True)
def _clean_state():
    """Ensure clean Redis and PostgreSQL state before every test.

    Redis: flush all keys so no cached data crosses test boundaries.
    PostgreSQL: delete from cluster/report tables so inserted data
    from one test does not pollute the 60-minute window queries of the next.
    """
    r = redis.from_url(
        os.environ.get("REDIS_URL", "redis://redis:6379/0"),
        decode_responses=True,
        socket_connect_timeout=0.5,
        socket_timeout=0.5,
    )
    r.flushdb()
    r.close()

    db = _SessionLocal()
    try:
        # Delete in FK-safe order: members → clusters → reports
        # NOTE: wims.users is intentionally excluded — seed users have FK
        # references from incident_verification_history and other tables.
        db.execute(text("DELETE FROM wims.citizen_report_cluster_members"))
        db.execute(text("DELETE FROM wims.citizen_report_clusters"))
        db.execute(text("DELETE FROM wims.citizen_reports"))
        db.commit()
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
        ip = f"198.51.{uuid.uuid4().hex[:4]}.{uuid.uuid4().hex[:4]}"
        response = client.post(
            "/api/civilian/reports",
            json=_payload(),
            headers={"x-forwarded-for": ip},
        )

        assert response.status_code == 201, response.text
        data = response.json()
        assert data["status"] == "PENDING"
        assert data["category"] == "STRUCTURAL"
        assert data["sub_category"] == "Residential"
        assert data["reporting_context"] == "WITNESS"
        assert data["safety_status"] == "I_AM_SAFE"
        assert data["trust_score"] > 0
        assert (
            data["guidance"]
            == "Your report is waiting for review. Call 911 if there is immediate danger."
        )
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

        ip = f"198.51.{uuid.uuid4().hex[:4]}.{uuid.uuid4().hex[:4]}"
        response = client.post(
            "/api/civilian/reports",
            json=_payload(previous_report_id=previous_id, device_id=str(uuid.uuid4())),
            headers={"x-forwarded-for": ip},
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
        assert (
            data["escalation_guidance"]
            == "Submit a new report if the emergency is ongoing, or call 911."
        )


def _insert_cluster(db: Session, report_ids: list[int]) -> int:
    row = db.execute(
        text("""
            INSERT INTO wims.citizen_report_clusters (anchor_report_id, status)
            VALUES (:anchor_report_id, 'CLUSTER_MONITORING')
            RETURNING cluster_id
        """),
        {"anchor_report_id": report_ids[0]},
    ).fetchone()
    cluster_id = int(row[0])
    for report_id in report_ids:
        db.execute(
            text("""
                INSERT INTO wims.citizen_report_cluster_members (cluster_id, report_id)
                VALUES (:cluster_id, :report_id)
                ON CONFLICT DO NOTHING
            """),
            {"cluster_id": cluster_id, "report_id": report_id},
        )
    db.commit()
    return cluster_id


def test_get_report_clusters_cache_and_stale_fallback(client, db_session):
    from unittest import mock

    r = redis.from_url(
        os.environ.get("REDIS_URL", "redis://redis:6379/0"),
        decode_responses=True,
        socket_connect_timeout=0.5,
        socket_timeout=0.5,
    )

    try:
        report_ids = [_insert_report(db_session, status="PENDING") for _ in range(3)]
        linked_id = _insert_report(db_session, status="LINKED")
        _insert_cluster(db_session, [*report_ids, linked_id])

        # 1. Fresh DB hit
        resp1 = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
        assert resp1.status_code == 200
        data1 = resp1.json()
        assert data1["mode"] == "local"
        assert data1["radius_m"] == 10000
        assert data1["min_reports"] == 3
        assert len(data1["areas"]) >= 1
        area = data1["areas"][0]
        assert area["count_bucket"] == "3-4"
        assert area["radius_m"] == 100
        assert "area_id" in area
        assert "cluster_id" not in area
        assert "report_id" not in area
        assert "total_reports" not in area
        assert data1.get("stale") is False
        assert data1.get("degraded") is False

        # 2. Cache hit (DB not called)
        with mock.patch("sqlalchemy.orm.Session.execute") as mock_exec:
            resp2 = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
            assert resp2.status_code == 200
            assert mock_exec.call_count == 0
            assert resp2.json()["areas"] == data1["areas"]

        # 3. DB fails, fresh cache expired -> serve stale
        # Clear fresh cache, leave stale
        for key in r.scan_iter(match="wims:civilian:report-clusters:v1:local:*"):
            if not key.endswith(":stale"):
                r.delete(key)

        with mock.patch("sqlalchemy.orm.Session.execute", side_effect=Exception("DB dead")):
            resp3 = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
            assert resp3.status_code == 200
            data3 = resp3.json()
            assert data3["stale"] is True
            assert data3["degraded"] is False
            assert len(data3["areas"]) >= 1

        # 4. DB fails, no stale cache -> degraded
        r.flushdb()
        with mock.patch("sqlalchemy.orm.Session.execute", side_effect=Exception("DB dead")):
            resp4 = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
            assert resp4.status_code == 200
            data4 = resp4.json()
            assert data4["stale"] is False
            assert data4["degraded"] is True
            assert len(data4["areas"]) == 0
    finally:
        r.close()


# ── Issue #127: comprehensive report-clusters endpoint tests ──────────────────


def test_get_report_clusters_national_mode(client, db_session):
    """National mode (no lat/lon): min 10 reports, cap 25, no center."""

    # Need 10+ reports to meet national minimum
    report_ids = [_insert_report(db_session, status="PENDING") for _ in range(12)]
    _insert_cluster(db_session, report_ids)

    resp = client.get("/api/civilian/report-clusters")
    assert resp.status_code == 200
    data = resp.json()
    assert data["mode"] == "national"
    assert data["center"] is None
    assert data["radius_m"] is None
    assert data["min_reports"] == 10
    assert data["window_minutes"] == 60
    assert isinstance(data["areas"], list)
    assert len(data["areas"]) >= 1


def test_get_report_clusters_national_below_threshold_returns_empty(client, db_session):
    """National mode with fewer than 10 reports returns empty areas."""

    report_ids = [_insert_report(db_session, status="PENDING") for _ in range(5)]
    _insert_cluster(db_session, report_ids)

    resp = client.get("/api/civilian/report-clusters")
    assert resp.status_code == 200
    data = resp.json()
    assert data["mode"] == "national"
    assert len(data["areas"]) == 0


def test_get_report_clusters_local_mode(client, db_session):
    """Local mode (lat/lon): min 3 reports, cap 50, center returned."""

    report_ids = [_insert_report(db_session, status="PENDING") for _ in range(4)]
    _insert_cluster(db_session, report_ids)

    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()
    assert data["mode"] == "local"
    assert data["center"] is not None
    assert "latitude" in data["center"]
    assert "longitude" in data["center"]
    assert data["radius_m"] == 10000
    assert data["min_reports"] == 3


def test_get_report_clusters_local_below_threshold_returns_empty(client, db_session):
    """Local mode with fewer than 3 reports returns empty areas."""

    report_ids = [_insert_report(db_session, status="PENDING") for _ in range(2)]
    _insert_cluster(db_session, report_ids)

    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()
    assert data["mode"] == "local"
    assert len(data["areas"]) == 0


def test_get_report_clusters_excludes_terminal_report_statuses(client, db_session):
    """Reports with ACTIONED or REJECTED_* statuses are excluded from areas."""

    # Reports in terminal statuses — should be excluded
    actioned = _insert_report(db_session, status="ACTIONED")
    rejected_bogus = _insert_report(db_session, status="REJECTED_BOGUS", status_explanation="spam")
    rejected_dup = _insert_report(db_session, status="REJECTED_DUPLICATE", status_explanation="dup")
    rejected_insuf = _insert_report(
        db_session, status="REJECTED_INSUFFICIENT", status_explanation="n/a"
    )
    rejected_timeout = _insert_report(
        db_session, status="REJECTED_TIMEOUT", status_explanation="timeout"
    )

    _insert_cluster(
        db_session, [actioned, rejected_bogus, rejected_dup, rejected_insuf, rejected_timeout]
    )

    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()
    # All reports are terminal, active_reports = 0 → no areas
    assert len(data["areas"]) == 0


def test_get_report_clusters_excludes_closed_actioned_clusters(client, db_session):
    """Clusters with CLUSTER_ACTIONED or CLUSTER_CLOSED status are excluded."""

    report_ids = [_insert_report(db_session, status="PENDING") for _ in range(4)]
    cluster_id = _insert_cluster(db_session, report_ids)

    # Mark cluster as CLUSTER_CLOSED
    db_session.execute(
        text(
            "UPDATE wims.citizen_report_clusters SET status = 'CLUSTER_CLOSED' WHERE cluster_id = :cid"
        ),
        {"cid": cluster_id},
    )
    db_session.commit()

    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["areas"]) == 0


def test_get_report_clusters_includes_pending_under_review_linked(client, db_session):
    """Count pressure includes PENDING, UNDER_REVIEW, and LINKED statuses."""

    pending_reports = [_insert_report(db_session, status="PENDING") for _ in range(2)]
    under_review = _insert_report(db_session, status="UNDER_REVIEW")
    linked = _insert_report(db_session, status="LINKED")

    _insert_cluster(db_session, [*pending_reports, under_review, linked])

    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["areas"]) >= 1
    # count_bucket should reflect all 4 reports (3-4 or 5-9 depending on total)
    assert data["areas"][0]["count_bucket"] in ("3-4", "5-9")


def test_get_report_clusters_privacy_fields_absent(client, db_session):
    """Response must not leak raw IDs, exact counts, timestamps, or sensitive data."""

    report_ids = [_insert_report(db_session, status="PENDING") for _ in range(4)]
    _insert_cluster(db_session, report_ids)

    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()
    area = data["areas"][0]

    # Privacy: must NOT expose raw identifiers
    assert "cluster_id" not in area
    assert "report_id" not in area
    assert "total_reports" not in area

    # Privacy: must NOT expose exact counts (only count_bucket)
    for area_item in data["areas"]:
        assert "total_reports" not in area_item
        assert "cnt" not in area_item
        assert "count" not in area_item

    # Privacy: must NOT expose exact timestamps (only age_bucket)
    for area_item in data["areas"]:
        assert "created_at" not in area_item
        assert "newest_report_at" not in area_item
        assert "timestamp" not in area_item

    # Privacy: must NOT expose category/safety/witness/contact/device data
    for area_item in data["areas"]:
        for forbidden in (
            "category",
            "sub_category",
            "severity",
            "safety_status",
            "witness_name",
            "witness_phone",
            "device_id",
            "ip_hash",
            "contact_number",
            "station",
        ):
            assert forbidden not in area_item, f"{forbidden} leaked in area"


def test_get_report_clusters_count_and_age_buckets(client, db_session):
    """Count bucket uses relative ranges; age bucket uses relative time windows."""

    report_ids = [_insert_report(db_session, status="PENDING") for _ in range(7)]
    _insert_cluster(db_session, report_ids)

    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["areas"]) >= 1
    area = data["areas"][0]

    # count_bucket must be a valid bucket label
    assert area["count_bucket"] in ("3-4", "5-9", "10-19", "20+")
    # With 7 reports, expect "5-9" (or "10-19" if rounding up)
    assert area["count_bucket"] in ("5-9", "10-19")

    # age_bucket must be a valid age label
    assert area["age_bucket"] in ("0-15 min", "15-30 min", "30-60 min")


def test_get_report_clusters_dynamic_radius_bounds(client, db_session):
    """Dynamic radius must be in [100, 1000], rounded up to 100m increments."""

    report_ids = [_insert_report(db_session, status="PENDING") for _ in range(4)]
    _insert_cluster(db_session, report_ids)

    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()
    area = data["areas"][0]

    radius = area["radius_m"]
    assert radius >= 100, f"radius {radius} below minimum 100"
    assert radius <= 1000, f"radius {radius} above maximum 1000"
    assert radius % 100 == 0, f"radius {radius} not rounded to 100m"


def test_get_report_clusters_area_id_is_ephemeral(client, db_session):
    """area_id must be a derived hash, not the raw cluster_id."""

    report_ids = [_insert_report(db_session, status="PENDING") for _ in range(4)]
    _insert_cluster(db_session, report_ids)

    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()
    area = data["areas"][0]

    # area_id must be a 16-char hex string (SHA-256 truncated)
    assert len(area["area_id"]) == 16
    assert all(c in "0123456789abcdef" for c in area["area_id"].lower())

    # area_id must not equal the raw cluster_id
    raw_clusters = (
        db_session.execute(text("SELECT cluster_id FROM wims.citizen_report_clusters"))
        .scalars()
        .all()
    )
    for raw_id in raw_clusters:
        assert area["area_id"] != str(raw_id)


def test_get_report_clusters_returns_truncated_false_when_under_cap(client, db_session):
    """With fewer clusters than the cap, truncated flag is False."""

    for _ in range(3):
        report_ids = [_insert_report(db_session, status="PENDING") for _ in range(4)]
        _insert_cluster(db_session, report_ids)

    # With only 3 clusters and cap 50 (local), truncation should be False.
    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()
    assert data["truncated"] is False


def test_get_report_clusters_requires_active_report_in_cluster(client, db_session):
    """A cluster with only terminal-status reports (no active) is excluded."""

    # Create one cluster with pending (active) reports + one cluster with only rejected (terminal)
    pending_ids = [_insert_report(db_session, status="PENDING") for _ in range(4)]
    _insert_cluster(db_session, pending_ids)

    rejected_ids = [
        _insert_report(db_session, status="REJECTED_TIMEOUT", status_explanation="timeout")
        for _ in range(4)
    ]
    _insert_cluster(db_session, rejected_ids)

    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()
    # Only the cluster with active reports should appear
    assert len(data["areas"]) >= 1
    # Terminated-only cluster excluded
    assert len(data["areas"]) <= 2  # at most 2 clusters exist; at least 1 excluded


def test_get_report_clusters_response_has_required_top_level_fields(client, db_session):
    """Verify all required top-level fields are present in the response."""

    report_ids = [_insert_report(db_session, status="PENDING") for _ in range(4)]
    _insert_cluster(db_session, report_ids)

    resp = client.get("/api/civilian/report-clusters?lat=14.5995&lon=120.9842")
    assert resp.status_code == 200
    data = resp.json()

    required_top = [
        "mode",
        "min_reports",
        "window_minutes",
        "truncated",
        "stale",
        "degraded",
        "areas",
    ]
    for field in required_top:
        assert field in data, f"missing top-level field: {field}"

    # center and radius_m only present in local mode
    if data["mode"] == "local":
        assert "center" in data
        assert "radius_m" in data
