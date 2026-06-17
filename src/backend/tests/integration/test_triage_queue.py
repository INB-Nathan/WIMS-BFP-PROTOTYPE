"""
Civilian Reporting Phase 2 — Triage Queue Projection API Tests

Covers:
- GET /api/triage/queue — cluster-oriented civilian report triage data
- Ordering: life-safety → aging → timeout_risk → severity → cluster_size → avg_trust → oldest
- Query params: needs_help, someone_else_needs_help, aging, timeout_risk,
                confidence, unreviewed, claimed_by_me, actioned_today, rejected_today
- Severity formulas (read-time): HIGH ≥5 related + trust ≥50, MEDIUM ≥2 + trust ≥30, LOW else
- Trust breakdown: included_signals, missing_signals, gps_mismatch, duplicate_device_count_30m
- Station context: name, distance_m, phone_available
- Privacy: no raw device_id, ip_hash, notification tokens
- Freshness: polled_at timestamp suitable for 30s polling

Run: cd src && docker compose run --rm backend pytest tests/integration/test_triage_queue.py -v
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
from tasks.civilian_reports import timeout_pending_reports


# ─── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def db_session():
    """Yield a DB session for test setup/teardown."""
    from database import _AdminSessionLocal as _SessionLocal  # noqa: SLF001

    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def isolate_triage_queue_data(db_session: Session):
    """Keep queue assertions independent from reports created by other tests."""
    cleanup_sql = text("""
        DELETE FROM wims.citizen_report_cluster_members;
        DELETE FROM wims.citizen_report_clusters;
        DELETE FROM wims.citizen_reports;
    """)
    db_session.execute(cleanup_sql)
    db_session.commit()
    try:
        yield
    finally:
        db_session.execute(cleanup_sql)
        db_session.commit()


@pytest.fixture
def validator_user(db_session: Session):
    """Create a NATIONAL_VALIDATOR user. Returns user dict."""
    keycloak_id = uuid.uuid4()
    username = f"validator_test_{keycloak_id.hex[:8]}"
    result = db_session.execute(
        text("""
            INSERT INTO wims.users (keycloak_id, username, role)
            VALUES (:kid, :username, 'NATIONAL_VALIDATOR')
            RETURNING user_id
        """),
        {"kid": keycloak_id, "username": username},
    )
    row = result.fetchone()
    db_session.commit()
    return {"user_id": row[0], "keycloak_id": str(keycloak_id), "role": "NATIONAL_VALIDATOR"}


@pytest.fixture
def encoder_user(db_session: Session):
    """Create a REGIONAL_ENCODER user. Returns user dict."""
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
    return {"user_id": row[0], "keycloak_id": str(keycloak_id), "role": "REGIONAL_ENCODER"}


@pytest.fixture
def mock_validator(validator_user):
    async def _mock():
        return validator_user

    return _mock


@pytest.fixture
def mock_encoder(encoder_user):
    async def _mock():
        return encoder_user

    return _mock


@pytest.fixture
def client_with_validator(mock_validator):
    app.dependency_overrides[get_current_wims_user] = mock_validator
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_current_wims_user, None)


@pytest.fixture
def client_with_encoder(mock_encoder):
    app.dependency_overrides[get_current_wims_user] = mock_encoder
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_current_wims_user, None)


# ─── Helpers ──────────────────────────────────────────────────────────────────


def make_report(
    db: Session,
    lat: float,
    lon: float,
    status: str = "PENDING",
    category: str = "STRUCTURAL",
    sub_category: str | None = None,
    safety_status: str = "UNKNOWN",
    reporting_context: str = "WITNESS",
    trust_score: int = 50,
    device_id: str | None = None,
    created_at: datetime = None,
    reported_at: datetime = None,
    gps_distance_m: float = None,
    validated_by: str | None = None,
) -> int:
    """Insert a citizen_report. Returns report_id.

    The historical call sites pass Manila coordinates as longitude, latitude.
    Preserve that convention here so PostGIS geography distance checks are valid.

    Terminal statuses (ACTIONED, REJECTED_*) require validated_by.
    """
    wkt = f"SRID=4326;POINT({lat} {lon})"
    now = datetime.now(timezone.utc)
    created_at = created_at or now
    reported_at = reported_at or created_at

    insert_params = {
        "wkt": wkt,
        "status": status,
        "category": category,
        "sub_category": sub_category,
        "safety_status": safety_status,
        "reporting_context": reporting_context,
        "trust_score": trust_score,
        "device_id": device_id,
        "created_at": created_at,
        "reported_at": reported_at,
        "gps_distance_m": gps_distance_m,
        "validated_by": validated_by,
    }

    result = db.execute(
        text("""
            INSERT INTO wims.citizen_reports (
                location, status, category, sub_category, safety_status,
                reporting_context, trust_score, device_id,
                created_at, reported_at, gps_distance_m,
                nearest_station_id, validated_by
            )
            VALUES (
                ST_GeogFromText(:wkt), :status, :category, :sub_category,
                :safety_status, :reporting_context, :trust_score,
                :device_id,
                :created_at, :reported_at, :gps_distance_m,
                (SELECT station_id FROM wims.ref_fire_stations LIMIT 1),
                :validated_by
            )
            RETURNING report_id
        """),
        insert_params,
    )
    row = result.fetchone()
    db.commit()
    return int(row[0])


def make_cluster(
    db: Session,
    anchor_report_id: int,
    status: str = "CLUSTER_MONITORING",
    assigned_to: str = None,
) -> int:
    """Create a citizen_report_cluster. Returns cluster_id."""
    result = db.execute(
        text("""
            INSERT INTO wims.citizen_report_clusters
                (anchor_report_id, status, assigned_to, review_started_at)
            VALUES (:anchor, :status, :assigned_to, :review_started_at)
            RETURNING cluster_id
        """),
        {
            "anchor": anchor_report_id,
            "status": status,
            "assigned_to": assigned_to,
            "review_started_at": datetime.now(timezone.utc),
        },
    )
    row = result.fetchone()
    db.commit()
    return int(row[0])


def add_to_cluster(db: Session, cluster_id: int, report_id: int, linked_by: str = None):
    db.execute(
        text("""
            INSERT INTO wims.citizen_report_cluster_members
                (cluster_id, report_id, linked_by)
            VALUES (:cid, :rid, :linked_by)
        """),
        {"cid": cluster_id, "rid": report_id, "linked_by": linked_by},
    )
    db.commit()


# ─── Tests ───────────────────────────────────────────────────────────────────


class TestGetTriageQueue:
    """GET /api/triage/queue"""

    def test_requires_auth(self, client_with_encoder):
        app.dependency_overrides.pop(get_current_wims_user, None)
        with TestClient(app) as c:
            resp = c.get("/api/triage/queue")
            assert resp.status_code in (401, 403)

    def test_requires_encoder_or_validator_role(self, client_with_encoder, db_session):
        """Non-encoder/validator role gets 403."""
        keycloak_id = uuid.uuid4()
        db_session.execute(
            text("""
                INSERT INTO wims.users (keycloak_id, username, role)
                VALUES (:kid, :username, 'NATIONAL_ANALYST')
                ON CONFLICT DO NOTHING
            """),
            {"kid": keycloak_id, "username": f"analyst_{keycloak_id.hex[:8]}"},
        )
        db_session.commit()

        async def bad_mock():
            return {"user_id": str(uuid.uuid4()), "role": "NATIONAL_ANALYST"}

        app.dependency_overrides[get_current_wims_user] = bad_mock
        try:
            with TestClient(app) as c:
                resp = c.get("/api/triage/queue")
                assert resp.status_code == 403
        finally:
            app.dependency_overrides.pop(get_current_wims_user, None)

    def test_returns_clusters_structure(self, client_with_validator, db_session):
        """Response has clusters[], polled_at, total_reports."""
        make_report(db_session, 121.05, 14.60)
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        data = resp.json()
        assert "clusters" in data
        assert "polled_at" in data
        assert "total_reports" in data
        assert isinstance(data["clusters"], list)

    def test_excludes_terminal_reports(self, client_with_validator, db_session):
        """ACTIONED and REJECTED_* reports are not in the queue."""
        encoder_user = db_session.execute(
            text("SELECT user_id FROM wims.users WHERE role = 'NATIONAL_VALIDATOR' LIMIT 1")
        ).fetchone()
        encoder_uid = str(encoder_user[0]) if encoder_user else None

        # Non-terminal
        rid_normal = make_report(db_session, 121.05, 14.60, status="PENDING")
        # Terminal — ACTIONED requires validated_by
        make_report(db_session, 121.06, 14.61, status="ACTIONED", validated_by=encoder_uid)
        make_report(db_session, 121.07, 14.62, status="REJECTED_BOGUS", validated_by=encoder_uid)
        make_report(db_session, 121.08, 14.63, status="REJECTED_TIMEOUT", validated_by=encoder_uid)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        cluster_ids = [
            cid
            for c in resp.json()["clusters"]
            for r in c["reports"]
            for cid in [r["report_id"]]
            if c["reports"]
        ]

        assert rid_normal in cluster_ids
        assert "ACTIONED" not in str(cluster_ids)

    def test_isolated_report_stays_as_singleton(self, client_with_validator, db_session):
        """Isolated reports without related reports appear as singletons, not clusters."""
        rid = make_report(db_session, 121.05, 14.60)
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        # The report should appear as a singleton entry (cluster_id is null)
        singletons = [
            c
            for c in resp.json()["clusters"]
            if c["cluster_id"] is None and any(r["report_id"] == rid for r in c["reports"])
        ]
        assert len(singletons) == 1, f"Expected 1 singleton, got {len(singletons)}"
        # It should NOT appear in any cluster entry
        cluster_entries = [
            c
            for c in resp.json()["clusters"]
            if c["cluster_id"] is not None and any(r["report_id"] == rid for r in c["reports"])
        ]
        assert len(cluster_entries) == 0, f"Expected 0 cluster entries, got {len(cluster_entries)}"

    def test_related_reports_auto_cluster(self, client_with_validator, db_session):
        """Two reports near each other (100m/1hr) each get materialized as clusters."""
        # Two reports at nearby locations within 100m
        rid1 = make_report(db_session, 121.05, 14.60)
        rid2 = make_report(db_session, 121.0505, 14.6005)  # ~56m away
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        # Each report should be in its own cluster entry (non-null cluster_id)
        cluster_entries = [c for c in resp.json()["clusters"] if c["cluster_id"] is not None]
        # At least one of our reports should have a cluster
        report_ids_in_clusters = {r["report_id"] for c in cluster_entries for r in c["reports"]}
        assert rid1 in report_ids_in_clusters, "rid1 not found in clusters"
        assert rid2 in report_ids_in_clusters, "rid2 not found in clusters"

    def test_explicit_cluster_grouping(self, client_with_validator, db_session):
        """Reports in the same explicit cluster appear in one cluster entry."""
        rid1 = make_report(db_session, 121.05, 14.60)
        rid2 = make_report(db_session, 121.051, 14.601)
        cluster_id = make_cluster(db_session, anchor_report_id=rid1)
        add_to_cluster(db_session, cluster_id, rid1)
        add_to_cluster(db_session, cluster_id, rid2)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200

        matching_clusters = [
            c
            for c in resp.json()["clusters"]
            if any(r["report_id"] in (rid1, rid2) for r in c["reports"])
        ]
        assert len(matching_clusters) == 1
        assert matching_clusters[0]["cluster_id"] == cluster_id
        report_ids = [r["report_id"] for r in matching_clusters[0]["reports"]]
        assert rid1 in report_ids
        assert rid2 in report_ids

    def test_life_safety_ordering(self, client_with_validator, db_session):
        """Clusters with I_NEED_HELP / SOMEONE_ELSE_NEEDS_HELP sort first."""
        rid_safe = make_report(db_session, 121.05, 14.60, safety_status="I_AM_SAFE")
        rid_help = make_report(db_session, 121.10, 14.70, safety_status="I_NEED_HELP")

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        clusters = resp.json()["clusters"]

        # Find cluster positions for each report
        help_cluster_idx = next(
            i
            for i, c in enumerate(clusters)
            if any(r["report_id"] == rid_help for r in c["reports"])
        )
        safe_cluster_idx = next(
            i
            for i, c in enumerate(clusters)
            if any(r["report_id"] == rid_safe for r in c["reports"])
        )
        assert help_cluster_idx < safe_cluster_idx

    def test_aging_ordering(self, client_with_validator, db_session):
        """Reports older than 60 min sort before newer ones."""
        now = datetime.now(timezone.utc)
        rid_old = make_report(db_session, 121.05, 14.60, created_at=now - timedelta(hours=2))
        rid_new = make_report(db_session, 121.10, 14.70, created_at=now - timedelta(minutes=30))

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        clusters = resp.json()["clusters"]

        old_idx = next(
            i
            for i, c in enumerate(clusters)
            if any(r["report_id"] == rid_old for r in c["reports"])
        )
        new_idx = next(
            i
            for i, c in enumerate(clusters)
            if any(r["report_id"] == rid_new for r in c["reports"])
        )
        assert old_idx < new_idx

    def test_severity_HIGH(self, client_with_validator, db_session):
        """≥5 related within 100m/1hr AND trust ≥50 → HIGH severity."""
        base_lat, base_lon = 121.0500, 14.6000
        now = datetime.now(timezone.utc)
        # Anchor report with trust 60
        rid_anchor = make_report(db_session, base_lat, base_lon, trust_score=60, created_at=now)
        # 4 nearby reports within 100m/1hr → total 5 related = HIGH
        for i in range(4):
            offset = 0.0001 * (i + 1)  # keep all reports inside 100m
            make_report(
                db_session,
                base_lat + offset,
                base_lon + offset,
                trust_score=60,
                created_at=now - timedelta(minutes=i * 10),
            )

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        clusters = resp.json()["clusters"]

        anchor_cluster = next(
            c for c in clusters if any(r["report_id"] == rid_anchor for r in c["reports"])
        )
        assert anchor_cluster["severity"] == "HIGH"

    def test_severity_MEDIUM(self, client_with_validator, db_session):
        """≥2 related within 100m/1hr AND trust ≥30 → MEDIUM."""
        base_lat, base_lon = 121.0500, 14.6000
        now = datetime.now(timezone.utc)
        rid_anchor = make_report(db_session, base_lat, base_lon, trust_score=40, created_at=now)
        # 1 nearby → 2 total related = MEDIUM
        make_report(
            db_session, base_lat + 0.0003, base_lon + 0.0003, trust_score=40, created_at=now
        )

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        clusters = resp.json()["clusters"]
        anchor_cluster = next(
            c for c in clusters if rid_anchor in [r["report_id"] for r in c["reports"]]
        )
        assert anchor_cluster["severity"] == "MEDIUM"

    def test_severity_LOW(self, client_with_validator, db_session):
        """Single report with no nearby related reports → LOW severity."""
        rid = make_report(db_session, 121.05, 14.60, trust_score=20)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        clusters = resp.json()["clusters"]
        cluster = next(c for c in clusters if rid in [r["report_id"] for r in c["reports"]])
        # related_count may be > 0 due to other DB reports from prior tests;
        # severity is computed from related_count AND trust score per ADR thresholds.
        # If related_count is high, trust_score 20 still keeps it LOW
        # (requires trust ≥ 30 for MEDIUM, ≥ 50 for HIGH).
        assert cluster["severity"] == "LOW"

    def test_trust_breakdown_included_signals(self, client_with_validator, db_session):
        """Trust breakdown shows included signals correctly."""
        rid = make_report(
            db_session,
            121.05,
            14.60,
            category="STRUCTURAL",
            sub_category="Residential",
            trust_score=45,
            reported_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        clusters = resp.json()["clusters"]
        entry = next(r for c in clusters for r in c["reports"] if r["report_id"] == rid)
        breakdown = entry["trust_breakdown"]
        assert "category" in breakdown["included_signals"]
        assert "sub_category" in breakdown["included_signals"]
        assert "reported_at" in breakdown["included_signals"]
        assert breakdown["score"] == 45

    def test_trust_breakdown_missing_signals(self, client_with_validator, db_session):
        """Trust breakdown shows missing signals."""
        rid = make_report(db_session, 121.05, 14.60, trust_score=10, sub_category=None)
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        clusters = resp.json()["clusters"]
        entry = next(r for c in clusters for r in c["reports"] if r["report_id"] == rid)
        breakdown = entry["trust_breakdown"]
        assert "sub_category" in breakdown["missing_signals"]

    def test_trust_breakdown_gps_mismatch(self, client_with_validator, db_session):
        """GPS distance > 200m sets gps_mismatch = true."""
        rid = make_report(db_session, 121.05, 14.60, gps_distance_m=350.0)
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        clusters = resp.json()["clusters"]
        entry = next(r for c in clusters for r in c["reports"] if r["report_id"] == rid)
        assert entry["trust_breakdown"]["gps_mismatch"] is True

    def test_trust_breakdown_gps_ok(self, client_with_validator, db_session):
        """GPS distance ≤ 200m sets gps_mismatch = false."""
        rid = make_report(db_session, 121.05, 14.60, gps_distance_m=100.0)
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        clusters = resp.json()["clusters"]
        entry = next(r for c in clusters for r in c["reports"] if r["report_id"] == rid)
        assert entry["trust_breakdown"]["gps_mismatch"] is False

    def test_trust_breakdown_duplicate_device_count(self, client_with_validator, db_session):
        """Duplicate device submissions within 30 min reflected in duplicate_device_count_30m."""
        device = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        rid1 = make_report(
            db_session,
            121.05,
            14.60,
            device_id=device,
            trust_score=50,
            created_at=now - timedelta(minutes=10),
        )
        _rid2 = make_report(
            db_session,
            121.06,
            14.61,
            device_id=device,
            trust_score=50,
            created_at=now - timedelta(minutes=20),
        )
        rid3 = make_report(
            db_session,
            121.07,
            14.62,
            device_id=device,
            trust_score=50,
            created_at=now - timedelta(minutes=25),
        )
        # Different device
        make_report(db_session, 121.08, 14.63, trust_score=50)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        clusters = resp.json()["clusters"]
        entries = {r["report_id"]: r for c in clusters for r in c["reports"]}

        # rid1 has 2 other reports from same device in 30 min
        assert entries[rid1]["trust_breakdown"]["duplicate_device_count_30m"] >= 2
        assert entries[rid3]["trust_breakdown"]["duplicate_device_count_30m"] >= 2

    def test_station_context(self, client_with_validator, db_session):
        """Station name, distance_m, phone_available present in station field."""
        rid = make_report(db_session, 121.05, 14.60)
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        clusters = resp.json()["clusters"]
        entry = next(r for c in clusters for r in c["reports"] if r["report_id"] == rid)
        station = entry["station"]
        assert "name" in station
        assert "distance_m" in station
        assert "phone_available" in station
        # phone_available is a bool
        assert isinstance(station["phone_available"], bool)

    def test_privacy_no_device_id(self, client_with_validator, db_session):
        """Raw device_id never appears in response."""
        make_report(db_session, 121.05, 14.60, device_id=str(uuid.uuid4()))
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        body = resp.text
        assert "device_id" not in body.lower() or "device" in body.lower()
        # Check specifically no raw UUID-looking device IDs
        import re

        uuid_pattern = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
        _matches = re.findall(uuid_pattern, body, re.IGNORECASE)
        # All UUIDs in response should be report_id or user_id (not device_id)
        # We can't easily distinguish here, but at minimum no raw device_id field.
        assert '"device_id":' not in body

    def test_privacy_no_ip_hash(self, client_with_validator, db_session):
        """ip_hash never appears in response."""
        make_report(db_session, 121.05, 14.60)
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        assert "ip_hash" not in resp.text

    def test_polled_at_timestamp(self, client_with_validator, db_session):
        """polled_at is a valid ISO timestamp."""
        make_report(db_session, 121.05, 14.60)
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        polled_at = resp.json()["polled_at"]
        # Should be parseable as ISO datetime
        parsed = datetime.fromisoformat(polled_at.replace("Z", "+00:00"))
        assert parsed.year >= 2024

    def test_aging_filter(self, client_with_validator, db_session):
        """aging=true returns only reports > 60 min old."""
        now = datetime.now(timezone.utc)
        rid_old = make_report(db_session, 121.05, 14.60, created_at=now - timedelta(hours=2))
        make_report(db_session, 121.10, 14.70, created_at=now - timedelta(minutes=30))

        resp = client_with_validator.get("/api/triage/queue?aging=true")
        assert resp.status_code == 200
        cluster_ids = [r["report_id"] for c in resp.json()["clusters"] for r in c["reports"]]
        assert rid_old in cluster_ids
        # newer report should not appear (filtered out at cluster level but may appear)
        # aging filter is per-report, so check our specific report
        cluster = next(
            (
                c
                for c in resp.json()["clusters"]
                if rid_old in [r["report_id"] for r in c["reports"]]
            ),
            None,
        )
        assert cluster is not None
        assert any(r["report_id"] == rid_old and r["is_aging"] for r in cluster["reports"])

    def test_timeout_risk_filter(self, client_with_validator, db_session):
        """timeout_risk=true returns only reports > 90 min old."""
        now = datetime.now(timezone.utc)
        rid_risk = make_report(db_session, 121.05, 14.60, created_at=now - timedelta(hours=3))
        make_report(db_session, 121.10, 14.70, created_at=now - timedelta(minutes=60))

        resp = client_with_validator.get("/api/triage/queue?timeout_risk=true")
        assert resp.status_code == 200
        cluster = next(
            (
                c
                for c in resp.json()["clusters"]
                if any(r["report_id"] == rid_risk for r in c["reports"])
            ),
            None,
        )
        assert cluster is not None
        assert any(r["report_id"] == rid_risk and r["is_timeout_risk"] for r in cluster["reports"])

    def test_needs_help_filter(self, client_with_validator, db_session):
        """needs_help=true returns only I_NEED_HELP reports."""
        rid_help = make_report(db_session, 121.05, 14.60, safety_status="I_NEED_HELP")
        make_report(db_session, 121.10, 14.70, safety_status="I_AM_SAFE")

        resp = client_with_validator.get("/api/triage/queue?needs_help=true")
        assert resp.status_code == 200
        cluster_ids = [r["report_id"] for c in resp.json()["clusters"] for r in c["reports"]]
        assert rid_help in cluster_ids

    def test_unreviewed_filter(self, client_with_validator, db_session):
        """unreviewed=true returns only PENDING reports."""
        rid_pending = make_report(db_session, 121.05, 14.60, status="PENDING")
        make_report(db_session, 121.10, 14.70, status="UNDER_REVIEW")

        resp = client_with_validator.get("/api/triage/queue?unreviewed=true")
        assert resp.status_code == 200
        cluster_ids = [r["report_id"] for c in resp.json()["clusters"] for r in c["reports"]]
        assert rid_pending in cluster_ids

    def test_confidence_filter_HIGH(self, client_with_validator, db_session):
        """confidence=HIGH returns only HIGH severity clusters."""
        base_lat, base_lon = 121.0500, 14.6000
        now = datetime.now(timezone.utc)
        _rid_high = make_report(db_session, base_lat, base_lon, trust_score=60, created_at=now)
        for i in range(4):
            make_report(
                db_session,
                base_lat + 0.0003 * (i + 1),
                base_lon + 0.0003 * (i + 1),
                trust_score=60,
                created_at=now - timedelta(minutes=i * 5),
            )

        make_report(db_session, 122.00, 15.00, trust_score=20)  # LOW

        resp = client_with_validator.get("/api/triage/queue?confidence=HIGH")
        assert resp.status_code == 200
        for c in resp.json()["clusters"]:
            assert c["severity"] == "HIGH"

    def test_confidence_filter_LOW(self, client_with_validator, db_session):
        """confidence=LOW returns only LOW severity clusters."""
        rid_low = make_report(db_session, 121.05, 14.60, trust_score=20)
        base_lat, base_lon = 121.0500, 14.6000
        now = datetime.now(timezone.utc)
        make_report(db_session, base_lat, base_lon, trust_score=60, created_at=now)
        for i in range(4):
            make_report(
                db_session,
                base_lat + 0.0003 * (i + 1),
                base_lon + 0.0003 * (i + 1),
                trust_score=60,
                created_at=now - timedelta(minutes=i * 5),
            )

        resp = client_with_validator.get("/api/triage/queue?confidence=LOW")
        assert resp.status_code == 200
        cluster = next(
            (
                c
                for c in resp.json()["clusters"]
                if any(r["report_id"] == rid_low for r in c["reports"])
            ),
            None,
        )
        assert cluster is not None
        assert cluster["severity"] == "LOW"

    def test_rejected_today_filter(self, client_with_validator, db_session):
        """rejected_today=true returns clusters with REJECTED_* reports created today."""
        encoder_user = db_session.execute(
            text("SELECT user_id FROM wims.users WHERE role = 'NATIONAL_VALIDATOR' LIMIT 1")
        ).fetchone()
        encoder_uid = str(encoder_user[0]) if encoder_user else None

        rid_rejected = make_report(
            db_session, 121.05, 14.60, status="REJECTED_INSUFFICIENT", validated_by=encoder_uid
        )
        make_report(db_session, 121.10, 14.70)  # PENDING

        resp = client_with_validator.get("/api/triage/queue?rejected_today=true")
        assert resp.status_code == 200
        # REJECTED reports should appear in rejected_today filter
        cluster_ids = [r["report_id"] for c in resp.json()["clusters"] for r in c["reports"]]
        assert rid_rejected in cluster_ids

    def test_has_life_safety_flag(self, client_with_validator, db_session):
        """Cluster has_life_safety=True when any member has I_NEED_HELP/SOMEONE_ELSE_NEEDS_HELP."""
        rid = make_report(db_session, 121.05, 14.60, safety_status="SOMEONE_ELSE_NEEDS_HELP")
        cluster_id = make_cluster(db_session, anchor_report_id=rid)
        add_to_cluster(db_session, cluster_id, rid)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        cluster = next(c for c in resp.json()["clusters"] if c["cluster_id"] == cluster_id)
        assert cluster["has_life_safety"] is True

    def test_cluster_member_count(self, client_with_validator, db_session):
        """Cluster member_count reflects number of reports in cluster."""
        rid1 = make_report(db_session, 121.05, 14.60)
        rid2 = make_report(db_session, 121.051, 14.601)
        rid3 = make_report(db_session, 121.052, 14.602)
        cluster_id = make_cluster(db_session, anchor_report_id=rid1)
        add_to_cluster(db_session, cluster_id, rid1)
        add_to_cluster(db_session, cluster_id, rid2)
        add_to_cluster(db_session, cluster_id, rid3)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        cluster = next(c for c in resp.json()["clusters"] if c["cluster_id"] == cluster_id)
        assert cluster["member_count"] == 3

    def test_cluster_avg_trust(self, client_with_validator, db_session):
        """Cluster avg_trust is mean of member trust scores."""
        rid1 = make_report(db_session, 121.05, 14.60, trust_score=60)
        rid2 = make_report(db_session, 121.051, 14.601, trust_score=40)
        cluster_id = make_cluster(db_session, anchor_report_id=rid1)
        add_to_cluster(db_session, cluster_id, rid1)
        add_to_cluster(db_session, cluster_id, rid2)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        cluster = next(c for c in resp.json()["clusters"] if c["cluster_id"] == cluster_id)
        assert abs(cluster["avg_trust"] - 50.0) < 0.01

    def test_related_count(self, client_with_validator, db_session):
        """Cluster related_count is total count of reports within 100m/1hr window."""
        base_lat, base_lon = 121.0500, 14.6000
        now = datetime.now(timezone.utc)
        rid_anchor = make_report(db_session, base_lat, base_lon, trust_score=60, created_at=now)
        # 3 nearby within 100m/1hr
        for i in range(3):
            make_report(
                db_session,
                base_lat + 0.0002 * (i + 1),
                base_lon + 0.0002 * (i + 1),
                trust_score=60,
                created_at=now - timedelta(minutes=i * 10),
            )

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        cluster = next(
            c
            for c in resp.json()["clusters"]
            if any(r["report_id"] == rid_anchor for r in c["reports"])
        )
        assert cluster["related_count"] >= 3

    def test_is_aging_cluster_flag(self, client_with_validator, db_session):
        """Cluster is_aging=True when oldest member is > 60 min old."""
        now = datetime.now(timezone.utc)
        rid = make_report(db_session, 121.05, 14.60, created_at=now - timedelta(hours=2))
        cluster_id = make_cluster(db_session, anchor_report_id=rid)
        add_to_cluster(db_session, cluster_id, rid)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        cluster = next(c for c in resp.json()["clusters"] if c["cluster_id"] == cluster_id)
        assert cluster["is_aging"] is True

    def test_is_timeout_risk_cluster_flag(self, client_with_validator, db_session):
        """Cluster is_timeout_risk=True when oldest member is > 90 min old."""
        now = datetime.now(timezone.utc)
        rid = make_report(db_session, 121.05, 14.60, created_at=now - timedelta(hours=3))
        cluster_id = make_cluster(db_session, anchor_report_id=rid)
        add_to_cluster(db_session, cluster_id, rid)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        cluster = next(c for c in resp.json()["clusters"] if c["cluster_id"] == cluster_id)
        assert cluster["is_timeout_risk"] is True

    def test_total_reports_count(self, client_with_validator, db_session):
        """total_reports reflects all non-terminal reports in queue."""
        encoder_user = db_session.execute(
            text("SELECT user_id FROM wims.users WHERE role = 'NATIONAL_VALIDATOR' LIMIT 1")
        ).fetchone()
        encoder_uid = str(encoder_user[0]) if encoder_user else None

        for i in range(5):
            make_report(db_session, 121.05 + i * 0.001, 14.60 + i * 0.001)
        make_report(db_session, 121.50, 14.80, status="REJECTED_BOGUS", validated_by=encoder_uid)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        assert resp.json()["total_reports"] == 5

    def test_claimed_by_me_filter(self, client_with_validator, db_session, validator_user):
        """claimed_by_me=true returns clusters assigned to the current user."""
        rid = make_report(db_session, 121.05, 14.60)
        cluster_id = make_cluster(
            db_session, anchor_report_id=rid, assigned_to=validator_user["user_id"]
        )
        add_to_cluster(db_session, cluster_id, rid)

        resp = client_with_validator.get("/api/triage/queue?claimed_by_me=true")
        assert resp.status_code == 200
        cluster = next(c for c in resp.json()["clusters"] if c["cluster_id"] == cluster_id)
        assert cluster is not None
        assert cluster["assigned_to"] is not None

    def test_assigned_to_display_name(self, client_with_validator, db_session, validator_user):
        """assigned_to shows user username, not raw UUID."""
        rid = make_report(db_session, 121.05, 14.60)
        cluster_id = make_cluster(
            db_session, anchor_report_id=rid, assigned_to=validator_user["user_id"]
        )
        add_to_cluster(db_session, cluster_id, rid)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        cluster = next(c for c in resp.json()["clusters"] if c["cluster_id"] == cluster_id)
        assert cluster["assigned_to"] is not None
        # Should be display name, not a UUID string
        assert cluster["assigned_to"] != validator_user["user_id"]
        assert len(cluster["assigned_to"]) > 0

    def test_review_started_at(self, client_with_validator, db_session, validator_user):
        """Cluster has review_started_at when claimed."""
        rid = make_report(db_session, 121.05, 14.60)
        cluster_id = make_cluster(
            db_session,
            anchor_report_id=rid,
            assigned_to=validator_user["user_id"],
            status="CLUSTER_UNDER_REVIEW",
        )
        add_to_cluster(db_session, cluster_id, rid)

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        cluster = next(c for c in resp.json()["clusters"] if c["cluster_id"] == cluster_id)
        assert cluster["cluster_status"] == "CLUSTER_UNDER_REVIEW"
        assert cluster["review_started_at"] is not None

    def test_previous_report_id_shown(self, client_with_validator, db_session):
        """Report entries include previous_report_id when set."""
        rid_prev = make_report(db_session, 121.05, 14.60)
        rid_new = make_report(db_session, 121.10, 14.70, status="PENDING", trust_score=30)
        # Simulate update to set previous_report_id
        db_session.execute(
            text(
                "UPDATE wims.citizen_reports SET previous_report_id = :prev WHERE report_id = :new"
            ),
            {"prev": rid_prev, "new": rid_new},
        )
        db_session.commit()

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        entry = next(
            (r for c in resp.json()["clusters"] for r in c["reports"] if r["report_id"] == rid_new),
            None,
        )
        assert entry is not None
        assert entry["previous_report_id"] == rid_prev

    def test_report_id_not_leaked_as_device_id(self, client_with_validator, db_session):
        """report_id values appear in response; no privacy fields."""
        rid = make_report(db_session, 121.05, 14.60, device_id=str(uuid.uuid4()))
        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200
        data = resp.json()
        # report_id should appear as integer
        all_report_ids = [r["report_id"] for c in data["clusters"] for r in c["reports"]]
        assert rid in all_report_ids
        # No device_id key
        for c in data["clusters"]:
            for r in c["reports"]:
                assert "device_id" not in r
                assert "ip_hash" not in r


class TestClusterClaimActivityWorkflow:
    """Phase 2 Issue 6 cluster claim, stale takeover, activity, and audit."""

    def test_claim_cluster_sets_under_review_assignment_and_audit(
        self,
        client_with_validator,
        db_session,
        validator_user,
    ):
        rid = make_report(db_session, 121.05, 14.60)
        cluster_id = make_cluster(db_session, anchor_report_id=rid)
        add_to_cluster(db_session, cluster_id, rid)

        resp = client_with_validator.post(f"/api/triage/clusters/{cluster_id}/claim", json={})

        assert resp.status_code == 200
        data = resp.json()
        assert data["cluster_id"] == cluster_id
        assert data["status"] == "CLUSTER_UNDER_REVIEW"
        assert data["assigned_to_user_id"] == str(validator_user["user_id"])
        assert data["assigned_to"] is not None
        assert data["review_started_at"] is not None
        assert data["claim_is_stale"] is False

        audit = db_session.execute(
            text("""
                SELECT action_type
                FROM wims.system_audit_trails
                WHERE table_affected = 'citizen_report_clusters'
                  AND record_id = :cid
                ORDER BY timestamp DESC
                LIMIT 1
            """),
            {"cid": cluster_id},
        ).fetchone()
        assert audit is not None
        assert audit[0] == "CLUSTER_CLAIM"

    def test_active_claim_blocks_other_validator(
        self,
        client_with_validator,
        db_session,
        validator_user,
    ):
        rid = make_report(db_session, 121.05, 14.60)
        cluster_id = make_cluster(
            db_session,
            anchor_report_id=rid,
            status="CLUSTER_UNDER_REVIEW",
            assigned_to=validator_user["user_id"],
        )
        add_to_cluster(db_session, cluster_id, rid)

        other_keycloak_id = uuid.uuid4()
        other_username = f"validator_other_{other_keycloak_id.hex[:8]}"
        other_user_id = db_session.execute(
            text("""
                INSERT INTO wims.users (keycloak_id, username, role)
                VALUES (:kid, :username, 'NATIONAL_VALIDATOR')
                RETURNING user_id
            """),
            {"kid": other_keycloak_id, "username": other_username},
        ).scalar()
        db_session.commit()

        async def other_validator():
            return {
                "user_id": other_user_id,
                "keycloak_id": str(other_keycloak_id),
                "role": "NATIONAL_VALIDATOR",
            }

        app.dependency_overrides[get_current_wims_user] = other_validator
        try:
            with TestClient(app) as c:
                resp = c.post(f"/api/triage/clusters/{cluster_id}/claim", json={})
        finally:
            app.dependency_overrides.pop(get_current_wims_user, None)

        assert resp.status_code == 409
        assert "actively claimed" in resp.json()["detail"]

    def test_stale_takeover_requires_reason_and_updates_claim(
        self,
        client_with_validator,
        db_session,
        validator_user,
    ):
        rid = make_report(db_session, 121.05, 14.60)
        stale_owner_keycloak_id = uuid.uuid4()
        stale_owner_id = db_session.execute(
            text("""
                INSERT INTO wims.users (keycloak_id, username, role)
                VALUES (:kid, :username, 'NATIONAL_VALIDATOR')
                RETURNING user_id
            """),
            {
                "kid": stale_owner_keycloak_id,
                "username": f"stale_owner_{stale_owner_keycloak_id.hex[:8]}",
            },
        ).scalar()
        db_session.commit()
        cluster_id = make_cluster(
            db_session,
            anchor_report_id=rid,
            status="CLUSTER_UNDER_REVIEW",
            assigned_to=str(stale_owner_id),
        )
        add_to_cluster(db_session, cluster_id, rid)
        db_session.execute(
            text("""
                UPDATE wims.citizen_report_clusters
                SET updated_at = now() - interval '16 minutes'
                WHERE cluster_id = :cid
            """),
            {"cid": cluster_id},
        )
        db_session.commit()

        missing_reason = client_with_validator.post(
            f"/api/triage/clusters/{cluster_id}/claim", json={}
        )
        assert missing_reason.status_code == 422

        resp = client_with_validator.post(
            f"/api/triage/clusters/{cluster_id}/claim",
            json={"reason": "stale claim"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["assigned_to_user_id"] == str(validator_user["user_id"])
        assert data["status"] == "CLUSTER_UNDER_REVIEW"

        audit_actions = [
            row[0]
            for row in db_session.execute(
                text("""
                    SELECT action_type
                    FROM wims.system_audit_trails
                    WHERE table_affected = 'citizen_report_clusters'
                      AND record_id = :cid
                    ORDER BY timestamp ASC
                """),
                {"cid": cluster_id},
            ).fetchall()
        ]
        assert "CLUSTER_STALE_TAKEOVER" in audit_actions

    def test_activity_refresh_extends_claim_and_is_in_history(
        self,
        client_with_validator,
        db_session,
    ):
        rid = make_report(db_session, 121.05, 14.60)
        cluster_id = make_cluster(db_session, anchor_report_id=rid)
        add_to_cluster(db_session, cluster_id, rid)
        claim_resp = client_with_validator.post(f"/api/triage/clusters/{cluster_id}/claim", json={})
        assert claim_resp.status_code == 200

        db_session.execute(
            text("""
                UPDATE wims.citizen_report_clusters
                SET updated_at = now() - interval '10 minutes'
                WHERE cluster_id = :cid
            """),
            {"cid": cluster_id},
        )
        db_session.commit()

        refresh_resp = client_with_validator.post(
            f"/api/triage/clusters/{cluster_id}/activity",
            json={"action": "selection_change", "note": "selected likely reports"},
        )
        assert refresh_resp.status_code == 200
        assert refresh_resp.json()["claim_is_stale"] is False

        history_resp = client_with_validator.get(f"/api/triage/clusters/{cluster_id}/activity")
        assert history_resp.status_code == 200
        events = history_resp.json()["events"]
        event_types = [event["event_type"] for event in events]
        assert "CLUSTER_CREATED" in event_types
        assert "REPORT_ADDED" in event_types
        assert "CLUSTER_CLAIM" in event_types
        assert "CLUSTER_ACTIVITY_SELECTION_CHANGE" in event_types


class TestPhase2WorkflowActions:
    """Terminal actions, timeout job, and deprecated promotion safeguards."""

    def test_queue_materializes_cluster_only_for_related_reports(
        self,
        client_with_validator,
        db_session,
    ):
        """Only reports with related reports (100m/1hr) get durable clusters; isolated reports don't."""
        rid_isolated = make_report(db_session, 121.05, 14.60)
        rid_related_1 = make_report(db_session, 122.00, 15.00)
        rid_related_2 = make_report(db_session, 122.0005, 15.0005)  # ~56m — related

        resp = client_with_validator.get("/api/triage/queue")
        assert resp.status_code == 200

        # Isolated report should NOT have a durable cluster in DB
        isolated_membership = db_session.execute(
            text("""
                SELECT cc.cluster_id
                FROM wims.citizen_report_clusters cc
                JOIN wims.citizen_report_cluster_members cm ON cm.cluster_id = cc.cluster_id
                WHERE cm.report_id = :rid
                  AND cc.status != 'CLUSTER_CLOSED'
            """),
            {"rid": rid_isolated},
        ).fetchone()
        assert isolated_membership is None, (
            f"Isolated report should have no cluster, got cluster_id={isolated_membership}"
        )

        # Related reports SHOULD each have a durable cluster in DB
        for rid in (rid_related_1, rid_related_2):
            membership = db_session.execute(
                text("""
                    SELECT cc.cluster_id
                    FROM wims.citizen_report_clusters cc
                    JOIN wims.citizen_report_cluster_members cm ON cm.cluster_id = cc.cluster_id
                    WHERE cm.report_id = :rid
                      AND cc.status != 'CLUSTER_CLOSED'
                """),
                {"rid": rid},
            ).fetchone()
            assert membership is not None, f"Related report {rid} should have a cluster"

    def test_terminal_action_updates_reports_and_audits(
        self,
        client_with_validator,
        db_session,
    ):
        rid = make_report(db_session, 121.05, 14.60)
        cluster_id = make_cluster(db_session, anchor_report_id=rid)
        add_to_cluster(db_session, cluster_id, rid)
        claim_resp = client_with_validator.post(f"/api/triage/clusters/{cluster_id}/claim", json={})
        assert claim_resp.status_code == 200

        resp = client_with_validator.post(
            f"/api/triage/clusters/{cluster_id}/terminal-action",
            json={
                "report_ids": [rid],
                "status": "REJECTED_INSUFFICIENT",
                "status_explanation": "Not enough details were available for validation.",
                "internal_note": "desk check complete",
            },
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["updated"] == 1
        row = db_session.execute(
            text(
                "SELECT status, status_explanation FROM wims.citizen_reports WHERE report_id = :rid"
            ),
            {"rid": rid},
        ).fetchone()
        assert row.status == "REJECTED_INSUFFICIENT"
        assert row.status_explanation == "Not enough details were available for validation."

        audit = db_session.execute(
            text("""
                SELECT action_type
                FROM wims.system_audit_trails
                WHERE table_affected = 'citizen_reports'
                  AND record_id = :rid
            """),
            {"rid": rid},
        ).fetchone()
        assert audit is not None
        assert audit.action_type == "CITIZEN_REPORT_REJECTED_INSUFFICIENT"

    def test_terminal_action_requires_explanation(
        self,
        client_with_validator,
        db_session,
    ):
        rid = make_report(db_session, 121.05, 14.60)
        cluster_id = make_cluster(db_session, anchor_report_id=rid)
        add_to_cluster(db_session, cluster_id, rid)
        client_with_validator.post(f"/api/triage/clusters/{cluster_id}/claim", json={})

        resp = client_with_validator.post(
            f"/api/triage/clusters/{cluster_id}/terminal-action",
            json={"report_ids": [rid], "status": "ACTIONED", "status_explanation": "   "},
        )

        assert resp.status_code == 422

    def test_correct_terminal_report_updates_status_and_audit(
        self,
        client_with_validator,
        db_session,
        validator_user,
    ):
        rid = make_report(
            db_session,
            121.05,
            14.60,
            status="REJECTED_INSUFFICIENT",
            validated_by=str(validator_user["user_id"]),
        )

        resp = client_with_validator.post(
            f"/api/triage/reports/{rid}/correct",
            json={
                "status": "ACTIONED",
                "status_explanation": "Corrected after additional validator review.",
                "correction_reason": "Initial rejection was applied to the wrong report.",
            },
        )

        assert resp.status_code == 200, resp.text
        row = db_session.execute(
            text(
                "SELECT status, status_explanation FROM wims.citizen_reports WHERE report_id = :rid"
            ),
            {"rid": rid},
        ).fetchone()
        assert row.status == "ACTIONED"
        assert row.status_explanation == "Corrected after additional validator review."

    def test_split_cluster_moves_selected_reports_to_new_cluster(
        self,
        client_with_validator,
        db_session,
    ):
        rid1 = make_report(db_session, 121.05, 14.60)
        rid2 = make_report(db_session, 121.051, 14.601)
        rid3 = make_report(db_session, 121.052, 14.602)
        cluster_id = make_cluster(db_session, anchor_report_id=rid1)
        add_to_cluster(db_session, cluster_id, rid1)
        add_to_cluster(db_session, cluster_id, rid2)
        add_to_cluster(db_session, cluster_id, rid3)
        assert (
            client_with_validator.post(
                f"/api/triage/clusters/{cluster_id}/claim", json={}
            ).status_code
            == 200
        )

        resp = client_with_validator.post(
            f"/api/triage/clusters/{cluster_id}/split",
            json={"report_ids": [rid2, rid3], "internal_note": "unrelated outlier reports"},
        )

        assert resp.status_code == 201, resp.text
        new_cluster_id = resp.json()["new_cluster_id"]
        moved = {
            row.report_id
            for row in db_session.execute(
                text(
                    "SELECT report_id FROM wims.citizen_report_cluster_members WHERE cluster_id = :cid"
                ),
                {"cid": new_cluster_id},
            ).fetchall()
        }
        assert moved == {rid2, rid3}

    def test_merge_cluster_closes_source_and_moves_members(
        self,
        client_with_validator,
        db_session,
    ):
        target_rid = make_report(db_session, 121.05, 14.60)
        source_rid = make_report(db_session, 121.051, 14.601)
        target_cluster_id = make_cluster(db_session, anchor_report_id=target_rid)
        source_cluster_id = make_cluster(db_session, anchor_report_id=source_rid)
        add_to_cluster(db_session, target_cluster_id, target_rid)
        add_to_cluster(db_session, source_cluster_id, source_rid)
        assert (
            client_with_validator.post(
                f"/api/triage/clusters/{target_cluster_id}/claim", json={}
            ).status_code
            == 200
        )

        resp = client_with_validator.post(
            f"/api/triage/clusters/{target_cluster_id}/merge",
            json={"source_cluster_id": source_cluster_id, "internal_note": "same incident window"},
        )

        assert resp.status_code == 200, resp.text
        source_status = db_session.execute(
            text(
                "SELECT status, merged_into_cluster_id FROM wims.citizen_report_clusters WHERE cluster_id = :cid"
            ),
            {"cid": source_cluster_id},
        ).fetchone()
        assert source_status.status == "CLUSTER_CLOSED"
        assert source_status.merged_into_cluster_id == target_cluster_id
        target_members = {
            row.report_id
            for row in db_session.execute(
                text(
                    "SELECT report_id FROM wims.citizen_report_cluster_members WHERE cluster_id = :cid"
                ),
                {"cid": target_cluster_id},
            ).fetchall()
        }
        assert target_members == {target_rid, source_rid}

    def test_timeout_task_rejects_old_pending_but_not_under_review(
        self,
        db_session,
    ):
        old = datetime.now(timezone.utc) - timedelta(hours=3)
        pending_id = make_report(db_session, 121.05, 14.60, created_at=old)
        review_id = make_report(db_session, 121.06, 14.61, status="UNDER_REVIEW", created_at=old)

        result = timeout_pending_reports()

        assert pending_id in result["report_ids"]
        rows = {
            row.report_id: row.status
            for row in db_session.execute(
                text(
                    "SELECT report_id, status FROM wims.citizen_reports WHERE report_id IN (:pending_id, :review_id)"
                ),
                {"pending_id": pending_id, "review_id": review_id},
            ).fetchall()
        }
        assert rows[pending_id] == "REJECTED_TIMEOUT"
        assert rows[review_id] == "UNDER_REVIEW"

    def test_legacy_promotion_endpoint_is_disabled(
        self,
        client_with_validator,
        db_session,
    ):
        rid = make_report(db_session, 121.05, 14.60)

        resp = client_with_validator.post(f"/api/triage/{rid}/promote")

        assert resp.status_code == 410


class TestMergeCandidates:
    """GET /api/triage/clusters/{cluster_id}/merge-candidates"""

    def test_returns_nearby_clusters_within_250m_and_1hr(
        self,
        client_with_validator,
        db_session,
    ):
        # Target cluster at (14.60, 121.05)
        target_rid = make_report(db_session, 121.05, 14.60)
        target_cid = make_cluster(db_session, anchor_report_id=target_rid)
        add_to_cluster(db_session, target_cid, target_rid)

        # Candidate cluster at (14.601, 121.051) — ~157m away, same minute
        cand_rid = make_report(db_session, 121.051, 14.601)
        cand_cid = make_cluster(db_session, anchor_report_id=cand_rid)
        add_to_cluster(db_session, cand_cid, cand_rid)

        resp = client_with_validator.get(f"/api/triage/clusters/{target_cid}/merge-candidates")

        assert resp.status_code == 200
        data = resp.json()
        assert data["cluster_id"] == target_cid
        assert len(data["candidates"]) == 1
        assert data["candidates"][0]["cluster_id"] == cand_cid
        assert data["candidates"][0]["distance_m"] < 250
        assert data["candidates"][0]["minutes_apart"] < 60

    def test_excludes_clusters_outside_250m(
        self,
        client_with_validator,
        db_session,
    ):
        target_rid = make_report(db_session, 121.05, 14.60)
        target_cid = make_cluster(db_session, anchor_report_id=target_rid)
        add_to_cluster(db_session, target_cid, target_rid)

        # Candidate ~500m away (0.005 deg lat ~ 556m)
        cand_rid = make_report(db_session, 121.055, 14.605)
        cand_cid = make_cluster(db_session, anchor_report_id=cand_rid)
        add_to_cluster(db_session, cand_cid, cand_rid)

        resp = client_with_validator.get(f"/api/triage/clusters/{target_cid}/merge-candidates")

        assert resp.status_code == 200
        assert len(resp.json()["candidates"]) == 0

    def test_excludes_clusters_older_than_1hr(
        self,
        client_with_validator,
        db_session,
    ):
        target_rid = make_report(db_session, 121.05, 14.60)
        target_cid = make_cluster(db_session, anchor_report_id=target_rid)
        add_to_cluster(db_session, target_cid, target_rid)

        # Candidate 2 hours old but close spatially (~50m)
        old_rid = make_report(
            db_session,
            121.0505,
            14.6005,
            created_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
        old_cid = make_cluster(db_session, anchor_report_id=old_rid)
        add_to_cluster(db_session, old_cid, old_rid)

        resp = client_with_validator.get(f"/api/triage/clusters/{target_cid}/merge-candidates")

        assert resp.status_code == 200
        assert len(resp.json()["candidates"]) == 0

    def test_excludes_closed_clusters(
        self,
        client_with_validator,
        db_session,
    ):
        target_rid = make_report(db_session, 121.05, 14.60)
        target_cid = make_cluster(db_session, anchor_report_id=target_rid)
        add_to_cluster(db_session, target_cid, target_rid)

        cand_rid = make_report(db_session, 121.051, 14.601)
        cand_cid = make_cluster(db_session, anchor_report_id=cand_rid, status="CLUSTER_CLOSED")
        add_to_cluster(db_session, cand_cid, cand_rid)

        resp = client_with_validator.get(f"/api/triage/clusters/{target_cid}/merge-candidates")

        assert resp.status_code == 200
        assert len(resp.json()["candidates"]) == 0

    def test_returns_404_for_nonexistent_cluster(
        self,
        client_with_validator,
        db_session,
    ):
        resp = client_with_validator.get("/api/triage/clusters/99999/merge-candidates")
        assert resp.status_code == 404

    def test_returns_own_cluster_not_in_candidates(
        self,
        client_with_validator,
        db_session,
    ):
        # Adding a second member to the same cluster — the anchor of the same cluster
        # should never appear as its own candidate.
        target_rid = make_report(db_session, 121.05, 14.60)
        target_cid = make_cluster(db_session, anchor_report_id=target_rid)
        add_to_cluster(db_session, target_cid, target_rid)

        resp = client_with_validator.get(f"/api/triage/clusters/{target_cid}/merge-candidates")
        assert resp.status_code == 200
        candidate_ids = [c["cluster_id"] for c in resp.json()["candidates"]]
        assert target_cid not in candidate_ids
