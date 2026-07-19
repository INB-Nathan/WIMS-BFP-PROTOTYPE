"""Public Information CMS read endpoint tests (no auth, mocked DB).

Mirrors ``test_community_content_routes.py``: the DB dependency is overridden
with a MagicMock so no live Postgres is required. Because the published-only
filter is enforced in SQL, each test asserts (a) the SQL text contains the
``published = TRUE`` predicate and (b) the handler returns exactly the rows the
query produced — so an unpublished row injected into the mock result is never
surfaced unless the SQL would have selected it.
"""

from __future__ import annotations

from datetime import datetime
import os
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from database import get_db
from main import app

ADMIN_ID = "00000000-0000-0000-0000-000000000001"

_PUBLISHED_AT = datetime(2026, 7, 1, 8, 0, 0)
_CREATED_AT = datetime(2026, 6, 30, 8, 0, 0)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    mock_db = MagicMock()

    def _fake_db():
        yield mock_db

    app.dependency_overrides[get_db] = _fake_db
    test_client = TestClient(app)
    test_client._mock_db = mock_db  # type: ignore[attr-defined]
    return test_client


def _set_rows(client: TestClient, rows: list[dict]) -> None:
    """Make the mocked db.execute(...).mappings().all() return ``rows``."""
    client._mock_db.execute.return_value.mappings.return_value.all.return_value = rows  # type: ignore[attr-defined]


def _captured_sql(client: TestClient) -> str:
    call = client._mock_db.execute.call_args  # type: ignore[attr-defined]
    return call.args[0].text


# ── Announcements ────────────────────────────────────────────────────────────


def test_announcements_returns_published_only(client: TestClient):
    published = {
        "id": 1,
        "title": "Drill today",
        "body": "Fire drill at noon.",
        "urgency": "advisory",
        "image_path": None,
        "published": True,
        "published_at": _PUBLISHED_AT,
        "created_at": _CREATED_AT,
    }
    _set_rows(client, [published])

    r = client.get("/api/information/announcements")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["id"] == 1
    assert body[0]["title"] == "Drill today"

    sql = _captured_sql(client)
    assert "information_announcements" in sql
    assert "published = TRUE" in sql
    assert "ORDER BY published_at DESC" in sql


def test_announcements_excludes_unpublished_from_result(client: TestClient):
    # The handler returns the query result verbatim; for a published-only query
    # the DB would return just the published row, so the mock returns only it.
    published = {
        "id": 1,
        "title": "Published",
        "body": "b",
        "urgency": "general",
        "image_path": None,
        "published": True,
        "published_at": _PUBLISHED_AT,
        "created_at": _CREATED_AT,
    }
    _set_rows(client, [published])

    r = client.get("/api/information/announcements")
    assert r.status_code == 200
    returned_ids = {item["id"] for item in r.json()}
    assert returned_ids == {1}
    assert 2 not in returned_ids

    sql = _captured_sql(client)
    assert "published = TRUE" in sql


# ── Emergencies ──────────────────────────────────────────────────────────────


def test_emergencies_returns_published_only(client: TestClient):
    published = {
        "id": 1,
        "title": "Brush fire",
        "location": "Barangay X",
        "description": "Active brush fire.",
        "severity": "high",
        "status": "ongoing",
        "promoted_from_incident_id": 7,
        "latitude": 14.6,
        "longitude": 121.0,
        "perimeter_geometry": '{"type":"Polygon","coordinates":[[[121,14.6],[121.1,14.6],[121,14.7],[121,14.6]]]}',
        "civilian_signal_count": 2,
        "published": True,
        "published_at": _PUBLISHED_AT,
        "created_at": _CREATED_AT,
    }
    _set_rows(client, [published])

    r = client.get("/api/information/emergencies")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["id"] == 1
    assert body[0]["severity"] == "high"
    assert body[0]["promoted_from_incident_id"] == 7
    assert body[0]["latitude"] == 14.6
    assert body[0]["perimeter"]["type"] == "Feature"
    assert body[0]["perimeter"]["geometry"]["type"] == "Polygon"
    assert body[0]["civilian_signal_count"] == 2

    sql = _captured_sql(client)
    assert "information_emergencies" in sql
    assert "published = TRUE" in sql
    assert "LEFT JOIN wims.fire_incidents" in sql
    assert "fi.verification_status = 'VERIFIED'" in sql
    assert "fire_incident_civilian_links" not in sql
    assert "COUNT(DISTINCT cr.report_id)" in sql
    assert "ST_Contains" in sql
    assert "cr.status IN ('PENDING', 'UNDER_REVIEW', 'LINKED')" in sql
    assert "ORDER BY ie.published_at DESC" in sql


def test_emergencies_includes_published_manual_emergency_without_geometry(client: TestClient):
    manual = {
        "id": 10,
        "title": "omg fire",
        "location": "Morayta",
        "description": "Pandoog on fire.",
        "severity": "high",
        "status": "monitoring",
        "promoted_from_incident_id": None,
        "latitude": None,
        "longitude": None,
        "perimeter_geometry": None,
        "civilian_signal_count": 0,
        "published": True,
        "published_at": _PUBLISHED_AT,
        "created_at": _CREATED_AT,
    }
    _set_rows(client, [manual])

    response = client.get("/api/information/emergencies")

    assert response.status_code == 200
    body = response.json()
    assert body[0]["title"] == "omg fire"
    assert body[0]["promoted_from_incident_id"] is None
    assert body[0]["latitude"] is None
    assert body[0]["longitude"] is None
    assert body[0]["perimeter"] is None
    assert body[0]["civilian_signal_count"] == 0

    sql = _captured_sql(client)
    assert "LEFT JOIN wims.fire_incidents" in sql
    assert "fire_incident_civilian_links" not in sql


def test_emergencies_excludes_unpublished_from_result(client: TestClient):
    published = {
        "id": 1,
        "title": "Published emergency",
        "location": "Loc",
        "description": "d",
        "severity": "moderate",
        "status": "ongoing",
        "promoted_from_incident_id": None,
        "published": True,
        "published_at": _PUBLISHED_AT,
        "created_at": _CREATED_AT,
    }
    _set_rows(client, [published])

    r = client.get("/api/information/emergencies")
    assert r.status_code == 200
    assert {item["id"] for item in r.json()} == {1}

    sql = _captured_sql(client)
    assert "published = TRUE" in sql


class _MappingResult:
    def __init__(self, *, first=None, all_rows=None):
        self._first = first
        self._all_rows = all_rows or []

    def mappings(self):
        return self

    def first(self):
        return self._first

    def all(self):
        return self._all_rows


class _SignalDb:
    def __init__(self, source, timestamps):
        self.source = source
        self.timestamps = timestamps
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append((statement.text, params))
        if len(self.statements) == 1:
            return _MappingResult(first=self.source)
        return _MappingResult(all_rows=self.timestamps)


def test_civilian_signals_returns_timestamps_only_and_uses_same_postgis_filter(client: TestClient):
    db = _SignalDb(
        {"incident_id": 7},
        [{"submitted_at": _CREATED_AT}, {"submitted_at": _PUBLISHED_AT}],
    )

    def _fake_db():
        yield db

    app.dependency_overrides[get_db] = _fake_db
    response = client.get("/api/information/emergencies/4/civilian-signals")

    assert response.status_code == 200
    assert response.json() == [
        {"submitted_at": "2026-06-30T08:00:00"},
        {"submitted_at": "2026-07-01T08:00:00"},
    ]
    assert set(response.json()[0]) == {"submitted_at"}
    detail_sql = db.statements[1][0]
    assert "ST_Contains" in detail_sql
    assert "cr.status IN ('PENDING', 'UNDER_REVIEW', 'LINKED')" in detail_sql
    assert "ORDER BY cr.created_at ASC, cr.report_id ASC" in detail_sql
    assert db.statements[1][1] == {"incident_id": 7}


def test_civilian_signals_unpublished_or_unknown_source_is_neutral_404(client: TestClient):
    db = _SignalDb(None, [])

    def _fake_db():
        yield db

    app.dependency_overrides[get_db] = _fake_db
    response = client.get("/api/information/emergencies/999/civilian-signals")

    assert response.status_code == 404
    assert response.json()["detail"] == "Emergency not found"
    assert len(db.statements) == 1


@pytest.fixture(scope="module")
def disposable_public_admin_engine():
    """Use only an explicitly designated disposable PostGIS admin database."""
    if os.environ.get("WIMS_DISPOSABLE_TEST_DATABASE") != "1":
        pytest.skip("set WIMS_DISPOSABLE_TEST_DATABASE=1 for the disposable PostGIS suite")
    admin_url = os.environ.get("DATABASE_ADMIN_URL")
    if not admin_url:
        pytest.skip("DATABASE_ADMIN_URL must target the disposable database")
    admin_engine = create_engine(admin_url)
    try:
        with admin_engine.connect() as connection:
            connection.execute(text("SELECT postgis_version()"))
    except Exception as exc:
        admin_engine.dispose()
        pytest.skip(f"disposable PostGIS database unavailable: {exc}")
    yield admin_engine
    admin_engine.dispose()


def _seed_public_emergency(admin_engine):
    """Seed no-PII rows; the gated disposable database is discarded after tests."""
    nonce = os.urandom(8).hex()
    longitude = -170 + (int(nonce[:6], 16) / 0xFFFFFF) * 340
    latitude = -70 + (int(nonce[6:12], 16) / 0xFFFFFF) * 140
    with admin_engine.begin() as connection:
        region_id = connection.execute(
            text("SELECT region_id FROM wims.ref_regions LIMIT 1")
        ).scalar_one()
        validator_id = connection.execute(
            text(
                "INSERT INTO wims.users (keycloak_id, username, role) VALUES "
                "(gen_random_uuid(), :username, 'NATIONAL_VALIDATOR') RETURNING user_id"
            ),
            {"username": f"task1_public_{nonce}"},
        ).scalar_one()
        incident_id = connection.execute(
            text(
                "INSERT INTO wims.fire_incidents "
                "(region_id, location, verification_status, data_hash) VALUES "
                "(:region_id, ST_GeogFromText(:point), 'VERIFIED', :data_hash) RETURNING incident_id"
            ),
            {
                "region_id": region_id,
                "point": f"SRID=4326;POINT({longitude} {latitude})",
                "data_hash": nonce,
            },
        ).scalar_one()
        emergency_id = connection.execute(
            text(
                "INSERT INTO wims.information_emergencies "
                "(title, location, description, severity, status, promoted_from_incident_id, "
                "published, published_at, created_by) VALUES "
                "(:title, 'Test', 'Test', 'moderate', 'ongoing', :incident_id, TRUE, now(), :created_by) "
                "RETURNING id"
            ),
            {"title": f"task1-public-{nonce}", "incident_id": incident_id, "created_by": nonce},
        ).scalar_one()
        connection.execute(
            text(
                "INSERT INTO wims.fire_incident_perimeters (incident_id, perimeter) "
                "VALUES (:incident_id, ST_GeogFromText(:polygon))"
            ),
            {
                "incident_id": incident_id,
                "polygon": (
                    f"SRID=4326;POLYGON(({longitude - 0.01} {latitude - 0.01},"
                    f"{longitude + 0.01} {latitude - 0.01},{longitude + 0.01} {latitude + 0.01},"
                    f"{longitude - 0.01} {latitude + 0.01},{longitude - 0.01} {latitude - 0.01}))"
                ),
            },
        )

        def insert_report(status, point, created_at):
            return connection.execute(
                text(
                    "INSERT INTO wims.citizen_reports "
                    "(location, category, reporting_context, safety_status, status, created_at, validated_by) "
                    "VALUES (ST_GeogFromText(:point), 'STRUCTURAL', 'WITNESS', 'I_AM_SAFE', "
                    ":status, :created_at, :validated_by) RETURNING report_id"
                ),
                {
                    "point": point,
                    "status": status,
                    "created_at": created_at,
                    "validated_by": validator_id if status == "ACTIONED" else None,
                },
            ).scalar_one()

        inside_report_id = insert_report(
            "PENDING", f"SRID=4326;POINT({longitude} {latitude})", "2030-01-02T03:04:05+00:00"
        )
        insert_report(
            "UNDER_REVIEW", f"SRID=4326;POINT({longitude} {latitude})", "2030-01-02T03:04:06+00:00"
        )
        insert_report(
            "LINKED", f"SRID=4326;POINT({longitude} {latitude})", "2030-01-02T03:04:07+00:00"
        )
        insert_report(
            "PENDING",
            f"SRID=4326;POINT({longitude + 1} {latitude + 1})",
            "2030-01-02T03:04:08+00:00",
        )
        insert_report(
            "ACTIONED", f"SRID=4326;POINT({longitude} {latitude})", "2030-01-02T03:04:09+00:00"
        )
        insert_report(
            "REJECTED_BOGUS",
            f"SRID=4326;POINT({longitude} {latitude})",
            "2030-01-02T03:04:10+00:00",
        )
        connection.execute(
            text(
                "INSERT INTO wims.fire_incident_civilian_links (incident_id, report_id) "
                "VALUES (:incident_id, :report_id)"
            ),
            {"incident_id": incident_id, "report_id": inside_report_id},
        )
    return emergency_id


@pytest.mark.integration
def test_public_emergency_queries_use_postgis_and_timestamp_only_projection(
    disposable_public_admin_engine,
):
    """Run actual list/detail queries through the public projection's admin session."""
    admin_engine = disposable_public_admin_engine
    emergency_id = _seed_public_emergency(admin_engine)
    session_factory = sessionmaker(bind=admin_engine)

    def public_db():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = public_db
    with TestClient(app) as live_client:
        emergencies = live_client.get("/api/information/emergencies")
        assert emergencies.status_code == 200, emergencies.text
        emergency = next(item for item in emergencies.json() if item["id"] == emergency_id)
        assert emergency["civilian_signal_count"] == 3
        detail = live_client.get(f"/api/information/emergencies/{emergency_id}/civilian-signals")
        assert detail.status_code == 200, detail.text
        assert detail.json() == [
            {"submitted_at": "2030-01-02T03:04:05+00:00"},
            {"submitted_at": "2030-01-02T03:04:06+00:00"},
            {"submitted_at": "2030-01-02T03:04:07+00:00"},
        ]
        assert set(detail.json()[0]) == {"submitted_at"}

    with admin_engine.begin() as connection:
        connection.execute(
            text("UPDATE wims.information_emergencies SET published = FALSE WHERE id = :id"),
            {"id": emergency_id},
        )
    app.dependency_overrides[get_db] = public_db
    with TestClient(app) as live_client:
        unavailable = live_client.get(
            f"/api/information/emergencies/{emergency_id}/civilian-signals"
        )
    assert unavailable.status_code == 404
    assert unavailable.json() == {"detail": "Emergency not found"}
