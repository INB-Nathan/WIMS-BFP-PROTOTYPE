"""Tests for fire incident perimeter + civilian-report link API (#635).

UNIT tests: the DB session is a fake and the audit helper is mocked, so no
Docker/Postgres is required. Exercises the full route + service stack via the
FastAPI TestClient with dependency overrides (mirrors test_status_update_api.py).

Coverage:
- valid create returns 201 GeoJSON Feature
- duplicate create returns 409
- invalid geometry (too-short ring / self-intersecting) returns 400
- GET 404 when no perimeter
- GET with linked civilian reports
- POST link-reports links; DELETE link-reports unlinks
- wrong role returns 403
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import auth
from main import app

VALIDATOR_USER = {
    "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "keycloak_id": "kid-validator",
    "username": "validator",
    "role": "NATIONAL_VALIDATOR",
}
ADMIN_USER = {
    "user_id": "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "keycloak_id": "kid-admin",
    "username": "admin",
    "role": "SYSTEM_ADMIN",
}
ENCODER_USER = {
    "user_id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "keycloak_id": "kid-encoder",
    "username": "encoder",
    "role": "REGIONAL_ENCODER",
}
CIVILIAN_USER = {
    "user_id": "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "keycloak_id": "kid-civ",
    "username": "civ",
    "role": "CIVILIAN",
}


def _polygon(coords: list | None = None) -> dict:
    if coords is None:
        coords = [
            [
                [120.98, 14.60],
                [120.99, 14.60],
                [120.99, 14.61],
                [120.98, 14.61],
                [120.98, 14.60],
            ]
        ]
    return {"type": "Polygon", "coordinates": coords}


class FakeRow:
    _COLUMNS = [
        "perimeter_id",
        "incident_id",
        "geometry",
        "gis_acres",
        "map_method",
        "created_by",
        "created_at",
        "updated_at",
        "report_id",
        "category",
        "status",
    ]

    def __init__(self, values: list[Any]):
        self._values = values

    def __getitem__(self, idx: int) -> Any:
        return self._values[idx]

    def __getattr__(self, name: str) -> Any:
        if name in FakeRow._COLUMNS:
            return self._values[FakeRow._COLUMNS.index(name)]
        raise AttributeError(name)


class FakeResult:
    def __init__(self, rows: list[FakeRow]):
        self._rows = rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows

    def scalar(self):
        row = self.fetchone()
        if row is None:
            return None
        return row[0]


class FakeSession:
    """Records executed text and returns programmed results.

    `program` maps a substring of the executed SQL to a FakeResult.
    `insert_mode` controls INSERT behaviour: 'perimeter_ok' returns a
    perimeter row; 'duplicate' raises IntegrityError (UNIQUE violation);
    'none' returns None (simulating no-op UPDATE/DELETE).
    """

    def __init__(
        self,
        program: dict[str, FakeResult],
        *,
        insert_mode: str = "perimeter_ok",
        link_insert_count: int = 0,
        unlink_count: int = 0,
    ):
        self._program = program
        self._insert_mode = insert_mode
        self._link_insert_count = link_insert_count
        self._unlink_count = unlink_count
        self.committed = False
        self.rolled_back = False
        self.executed: list[str] = []
        self.last_params: dict | None = None
        self._insert_count = 0

    def execute(self, statement, params: dict | None = None):
        from sqlalchemy.exc import IntegrityError

        sql = str(statement)
        self.executed.append(sql)
        self.last_params = params

        if "ST_IsValid" in sql:
            # Valid unless the test explicitly programs a False.
            for needle, result in self._program.items():
                if needle in sql:
                    return result
            return FakeResult([FakeRow([True])])

        if "INSERT INTO wims.fire_incident_perimeters" in sql:
            if self._insert_mode == "duplicate":
                raise IntegrityError("unique violation", {}, None)
            row = FakeRow(
                [
                    1,  # perimeter_id
                    params["iid"],
                    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}',
                    123.4,  # gis_acres
                    params["map_method"],
                    params["uid"],
                    None,
                    None,
                    None,
                    None,
                    None,
                ]
            )
            return FakeResult([row])

        if "INSERT INTO wims.fire_incident_civilian_links" in sql:
            self._insert_count += 1
            # Simulate ON CONFLICT DO NOTHING: count only up to link_insert_count.
            rowcount = 1 if self._insert_count <= self._link_insert_count else 0
            fake = FakeResult([])
            fake.rowcount = rowcount  # type: ignore[attr-defined]
            return fake

        if "DELETE FROM wims.fire_incident_perimeters" in sql:
            fake = FakeResult([])
            fake.rowcount = 1  # type: ignore[attr-defined]
            return fake

        if "DELETE FROM wims.fire_incident_civilian_links" in sql:
            fake = FakeResult([])
            fake.rowcount = self._unlink_count  # type: ignore[attr-defined]
            return fake

        for needle, result in self._program.items():
            if needle in sql:
                return result
        return FakeResult([])

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def _install(session: FakeSession, user: dict):
    app.dependency_overrides[auth.get_current_wims_user] = lambda: user
    app.dependency_overrides[auth.get_db_with_rls] = lambda: session


def _perimeter_row_session(insert_mode: str = "perimeter_ok") -> FakeSession:
    # ST_IsValid returns True by default (not in program).
    return FakeSession(program={}, insert_mode=insert_mode)


# ─── create ────────────────────────────────────────────────────────────────


@patch("api.routes.regional.perimeters.log_system_audit")
def test_create_valid_201(mock_audit, client):
    session = _perimeter_row_session()
    _install(session, VALIDATOR_USER)
    resp = client.post(
        "/api/regional/incidents/1/perimeter",
        json={"geometry": _polygon(), "map_method": "GPS-Walked"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["type"] == "Feature"
    assert body["incident_id"] == 1
    assert body["geometry"]["type"] == "Polygon"
    assert body["gis_acres"] == 123.4
    assert body["map_method"] == "GPS-Walked"
    assert session.committed
    mock_audit.assert_called_once()


@patch("api.routes.regional.perimeters.log_system_audit")
def test_create_duplicate_409(mock_audit, client):
    session = _perimeter_row_session(insert_mode="duplicate")
    _install(session, VALIDATOR_USER)
    resp = client.post(
        "/api/regional/incidents/1/perimeter",
        json={"geometry": _polygon(), "map_method": "GPS-Walked"},
    )
    assert resp.status_code == 409, resp.text
    assert "already exists" in resp.text.lower()


@patch("api.routes.regional.perimeters.log_system_audit")
def test_create_invalid_geometry_400(mock_audit, client):
    # Program ST_IsValid to return False.
    session = FakeSession(
        program={"ST_IsValid": FakeResult([FakeRow([False])])},
        insert_mode="perimeter_ok",
    )
    _install(session, VALIDATOR_USER)
    # 3-position ring => invalid structure anyway; ST_IsValid False is authoritative.
    resp = client.post(
        "/api/regional/incidents/1/perimeter",
        json={"geometry": _polygon(), "map_method": "GPS-Walked"},
    )
    assert resp.status_code == 400, resp.text
    assert "valid" in resp.text.lower()


@patch("api.routes.regional.perimeters.log_system_audit")
def test_create_invalid_ring_400(mock_audit, client):
    # Only 3 positions in the exterior ring => ValueError -> 400.
    session = _perimeter_row_session()
    _install(session, VALIDATOR_USER)
    resp = client.post(
        "/api/regional/incidents/1/perimeter",
        json={"geometry": _polygon(coords=[[[0, 0], [1, 0], [1, 1]]]), "map_method": "GPS-Walked"},
    )
    assert resp.status_code == 400, resp.text


@patch("api.routes.regional.perimeters.log_system_audit")
def test_create_invalid_map_method_400(mock_audit, client):
    session = _perimeter_row_session()
    _install(session, VALIDATOR_USER)
    resp = client.post(
        "/api/regional/incidents/1/perimeter",
        json={"geometry": _polygon(), "map_method": "NOT_A_REAL_METHOD"},
    )
    assert resp.status_code == 400, resp.text


# ─── get ──────────────────────────────────────────────────────────────────


def _perimeter_fetch_session() -> FakeSession:
    program = {
        "FROM wims.fire_incident_perimeters": FakeResult(
            [
                FakeRow(
                    [
                        1,
                        1,
                        '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}',
                        123.4,
                        "GPS-Walked",
                        "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                        None,
                        None,
                        None,
                        None,
                        None,
                    ]
                )
            ]
        ),
        "JOIN wims.citizen_reports cr": FakeResult(
            [
                FakeRow([10, "STRUCTURAL", "PENDING", None]),
                FakeRow([11, "NON_STRUCTURAL", "RESOLVED", None]),
            ]
        ),
    }
    return FakeSession(program=program)


def test_get_404(client):
    session = FakeSession(program={"FROM wims.fire_incident_perimeters": FakeResult([])})
    _install(session, VALIDATOR_USER)
    resp = client.get("/api/regional/incidents/1/perimeter")
    assert resp.status_code == 404, resp.text


def test_get_with_links(client):
    session = _perimeter_fetch_session()
    _install(session, VALIDATOR_USER)
    resp = client.get("/api/regional/incidents/1/perimeter")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["type"] == "Feature"
    assert len(body["linked_reports"]) == 2
    assert {r["report_id"] for r in body["linked_reports"]} == {10, 11}
    # Only public-safe fields present.
    assert all(
        set(r.keys()) == {"report_id", "category", "status", "created_at"}
        for r in body["linked_reports"]
    )


def test_get_allowed_for_regional_encoder(client):
    session = _perimeter_fetch_session()
    _install(session, ENCODER_USER)
    resp = client.get("/api/regional/incidents/1/perimeter")
    assert resp.status_code == 200, resp.text


# ─── update / delete ──────────────────────────────────────────────────────


def test_update_404(client):
    session = FakeSession(program={"FROM wims.fire_incident_perimeters": FakeResult([])})
    _install(session, VALIDATOR_USER)
    resp = client.put(
        "/api/regional/incidents/1/perimeter",
        json={"geometry": _polygon(), "map_method": "Hand-Sketch"},
    )
    assert resp.status_code == 404, resp.text


def test_delete_404(client):
    session = FakeSession(program={})
    # DELETE returns rowcount 0 -> not removed.
    session._unlink_count = 0

    def _del(self, statement, params=None):
        sql = str(statement)
        self.executed.append(sql)
        if "DELETE FROM wims.fire_incident_perimeters" in sql:
            fake = FakeResult([])
            fake.rowcount = 0  # type: ignore[attr-defined]
            return fake
        for needle, result in self._program.items():
            if needle in sql:
                return result
        return FakeResult([])

    session.execute = _del.__get__(session, FakeSession)  # type: ignore[assignment]
    _install(session, VALIDATOR_USER)
    resp = client.delete("/api/regional/incidents/1/perimeter")
    assert resp.status_code == 404, resp.text


# ─── link / unlink ────────────────────────────────────────────────────────


@patch("api.routes.regional.perimeters.log_system_audit")
def test_link_reports(mock_audit, client):
    session = FakeSession(
        program={"FROM wims.citizen_reports": FakeResult([FakeRow([10]), FakeRow([11])])},
        link_insert_count=2,
    )
    _install(session, VALIDATOR_USER)
    resp = client.post(
        "/api/regional/incidents/1/link-reports",
        json={"report_ids": [10, 11]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["linked_count"] == 2


@patch("api.routes.regional.perimeters.log_system_audit")
def test_link_reports_missing_404(mock_audit, client):
    # Only report 10 exists; 99 is missing => 404.
    session = FakeSession(
        program={"FROM wims.citizen_reports": FakeResult([FakeRow([10])])},
        link_insert_count=1,
    )
    _install(session, VALIDATOR_USER)
    resp = client.post(
        "/api/regional/incidents/1/link-reports",
        json={"report_ids": [10, 99]},
    )
    assert resp.status_code == 404, resp.text
    assert "99" in resp.text


@patch("api.routes.regional.perimeters.log_system_audit")
def test_unlink_reports(mock_audit, client):
    session = FakeSession(program={}, unlink_count=2)
    _install(session, VALIDATOR_USER)
    resp = client.request(
        "DELETE",
        "/api/regional/incidents/1/link-reports",
        json={"report_ids": [10, 11]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["removed_count"] == 2


# ─── role gating ──────────────────────────────────────────────────────────


@patch("api.routes.regional.perimeters.log_system_audit")
def test_create_wrong_role_403(mock_audit, client):
    session = _perimeter_row_session()
    _install(session, CIVILIAN_USER)
    resp = client.post(
        "/api/regional/incidents/1/perimeter",
        json={"geometry": _polygon(), "map_method": "GPS-Walked"},
    )
    assert resp.status_code == 403, resp.text


def test_get_wrong_role_403(client):
    session = _perimeter_fetch_session()
    _install(session, CIVILIAN_USER)
    resp = client.get("/api/regional/incidents/1/perimeter")
    assert resp.status_code == 403, resp.text


@patch("api.routes.regional.perimeters.log_system_audit")
def test_admin_can_create(mock_audit, client):
    session = _perimeter_row_session()
    _install(session, ADMIN_USER)
    resp = client.post(
        "/api/regional/incidents/1/perimeter",
        json={"geometry": _polygon(), "map_method": "GPS-Walked"},
    )
    assert resp.status_code == 201, resp.text
