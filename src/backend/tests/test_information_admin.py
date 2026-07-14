"""Admin Information CMS CRUD tests (mocked auth + mocked DB).

Follows the ``test_community_content_routes.py`` pattern: both
``auth.get_current_wims_user`` and ``auth.get_db_with_rls`` are overridden so
no live Postgres or Keycloak is required. The DB session is a MagicMock; each
test configures ``db.execute`` return values (via ``side_effect``) to drive the
handler paths (create / update / delete / promote, 404s, role gates).

Because the handlers run real SQL, the tests assert on the SQL text and bound
parameters passed to ``db.execute`` — this verifies the request payload is
actually wired into the INSERT/UPDATE/DELETE, independent of any real database.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, sentinel

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from auth import get_current_wims_user, get_db_with_rls
from main import app

ADMIN_ID = "00000000-0000-0000-0000-000000000001"
CREATED_AT = datetime(2026, 6, 30, 8, 0, 0)
PUBLISHED_AT = datetime(2026, 7, 1, 8, 0, 0)


def _result(
    *,
    scalar_one=sentinel.UNSET,
    scalar_one_or_none=sentinel.UNSET,
    first=sentinel.UNSET,
    all_=sentinel.UNSET,
    rowcount=sentinel.UNSET,
):
    m = MagicMock()
    if scalar_one is not sentinel.UNSET:
        m.scalar_one.return_value = scalar_one
    if scalar_one_or_none is not sentinel.UNSET:
        m.scalar_one_or_none.return_value = scalar_one_or_none
    if first is not sentinel.UNSET:
        m.mappings.return_value.first.return_value = first
    if all_ is not sentinel.UNSET:
        m.mappings.return_value.all.return_value = all_
    if rowcount is not sentinel.UNSET:
        m.rowcount = rowcount
    return m


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    mock_db = MagicMock()

    def _fake_db():
        yield mock_db

    app.dependency_overrides[get_db_with_rls] = _fake_db
    test_client = TestClient(app)
    test_client._mock_db = mock_db  # type: ignore[attr-defined]
    return test_client


def _set_auth(role: str | None):
    """Override get_current_wims_user to act as a given role (or anonymous)."""
    if role is None:

        async def _anon():
            raise HTTPException(status_code=401, detail="missing token")

        app.dependency_overrides[get_current_wims_user] = _anon
        return

    async def _user():
        return {"user_id": ADMIN_ID, "role": role, "username": "tester"}

    app.dependency_overrides[get_current_wims_user] = _user


def _announcement_row(aid: int = 1, **overrides) -> dict:
    base = {
        "id": aid,
        "title": "Drill",
        "body": "Body",
        "urgency": "advisory",
        "image_path": None,
        "published": False,
        "published_at": None,
        "created_at": CREATED_AT,
    }
    base.update(overrides)
    return base


def _emergency_row(eid: int = 1, **overrides) -> dict:
    base = {
        "id": eid,
        "title": "Incident #7",
        "location": "Barangay X",
        "description": "Desc",
        "severity": "moderate",
        "status": "ongoing",
        "promoted_from_incident_id": None,
        "published": False,
        "published_at": None,
        "created_at": CREATED_AT,
    }
    base.update(overrides)
    return base


def _insert_call(client: TestClient):
    """Return the args of the first db.execute call (the INSERT)."""
    return client._mock_db.execute.call_args_list[0]  # type: ignore[attr-defined]


# ── Announcements CRUD ───────────────────────────────────────────────────────


def test_create_announcement_requires_system_admin(client: TestClient):
    _set_auth("REGIONAL_ENCODER")
    r = client.post(
        "/api/admin/information/announcements",
        json={"title": "T", "body": "B", "urgency": "general"},
    )
    assert r.status_code == 403

    _set_auth("SYSTEM_ADMIN")
    row = _announcement_row()
    client._mock_db.execute.side_effect = [  # type: ignore[attr-defined]
        _result(scalar_one=row["id"]),
        _result(first=row),
    ]
    r = client.post(
        "/api/admin/information/announcements",
        json={"title": "Drill", "body": "Body", "urgency": "advisory"},
    )
    assert r.status_code == 201
    assert r.json()["id"] == row["id"]
    assert r.json()["published"] is False  # DB default

    call = _insert_call(client)
    assert call.args[0].text.startswith("INSERT INTO wims.information_announcements")
    assert call.args[1]["title"] == "Drill"
    assert call.args[1]["body"] == "Body"
    assert call.args[1]["urgency"] == "advisory"
    assert call.args[1]["created_by"] == ADMIN_ID


def test_create_announcement_rejects_invalid_urgency(client: TestClient):
    _set_auth("SYSTEM_ADMIN")
    r = client.post(
        "/api/admin/information/announcements",
        json={"title": "T", "body": "B", "urgency": "nope"},
    )
    assert r.status_code == 422


def test_update_announcement_returns_200_and_404_when_missing(client: TestClient):
    _set_auth("SYSTEM_ADMIN")

    # Found path
    row = _announcement_row(published=True, published_at=PUBLISHED_AT)
    client._mock_db.execute.side_effect = [  # type: ignore[attr-defined]
        _result(scalar_one_or_none=row["id"]),
        _result(first=row),
    ]
    r = client.put(
        "/api/admin/information/announcements/1",
        json={"published": True},
    )
    assert r.status_code == 200
    assert r.json()["published"] is True
    update_call = client._mock_db.execute.call_args_list[0]  # type: ignore[attr-defined]
    assert "UPDATE wims.information_announcements" in update_call.args[0].text
    assert "published = :published" in update_call.args[0].text
    assert update_call.args[1]["published"] is True
    assert update_call.args[1]["id"] == 1

    # Missing path
    client._mock_db.reset_mock()  # type: ignore[attr-defined]
    client._mock_db.execute.side_effect = [_result(scalar_one_or_none=None)]  # type: ignore[attr-defined]
    r = client.put(
        "/api/admin/information/announcements/999",
        json={"published": True},
    )
    assert r.status_code == 404
    missing_call = client._mock_db.execute.call_args_list[0]  # type: ignore[attr-defined]
    assert "UPDATE wims.information_announcements" in missing_call.args[0].text
    assert missing_call.args[1]["id"] == 999


def test_update_announcement_requires_system_admin(client: TestClient):
    _set_auth("NATIONAL_ANALYST")
    r = client.put("/api/admin/information/announcements/1", json={"title": "x"})
    assert r.status_code == 403


def test_delete_announcement_returns_204_and_404_when_missing(client: TestClient):
    _set_auth("SYSTEM_ADMIN")

    client._mock_db.execute.side_effect = [_result(rowcount=1)]  # type: ignore[attr-defined]
    r = client.delete("/api/admin/information/announcements/1")
    assert r.status_code == 204
    delete_call = client._mock_db.execute.call_args_list[0]  # type: ignore[attr-defined]
    assert "DELETE FROM wims.information_announcements" in delete_call.args[0].text
    assert delete_call.args[1]["id"] == 1

    client._mock_db.reset_mock()  # type: ignore[attr-defined]
    client._mock_db.execute.side_effect = [_result(rowcount=0)]  # type: ignore[attr-defined]
    r = client.delete("/api/admin/information/announcements/999")
    assert r.status_code == 404


# ── Emergencies CRUD ─────────────────────────────────────────────────────────


def test_create_emergency_returns_201_for_system_admin(client: TestClient):
    _set_auth("REGIONAL_ENCODER")
    r = client.post(
        "/api/admin/information/emergencies",
        json={"title": "T", "location": "L", "description": "D"},
    )
    assert r.status_code == 403

    _set_auth("SYSTEM_ADMIN")
    row = _emergency_row()
    client._mock_db.execute.side_effect = [  # type: ignore[attr-defined]
        _result(scalar_one=row["id"]),
        _result(first=row),
    ]
    r = client.post(
        "/api/admin/information/emergencies",
        json={
            "title": "Incident #7",
            "location": "Barangay X",
            "description": "Desc",
            "severity": "high",
            "status": "contained",
        },
    )
    assert r.status_code == 201
    assert r.json()["id"] == row["id"]
    assert r.json()["published"] is False  # DB default

    call = _insert_call(client)
    assert call.args[0].text.startswith("INSERT INTO wims.information_emergencies")
    assert call.args[1]["title"] == "Incident #7"
    assert call.args[1]["location"] == "Barangay X"
    assert call.args[1]["description"] == "Desc"
    assert call.args[1]["severity"] == "high"
    assert call.args[1]["status"] == "contained"
    assert call.args[1]["created_by"] == ADMIN_ID


def test_create_emergency_rejects_invalid_severity(client: TestClient):
    _set_auth("SYSTEM_ADMIN")
    r = client.post(
        "/api/admin/information/emergencies",
        json={"title": "T", "location": "L", "description": "D", "severity": "extreme"},
    )
    assert r.status_code == 422


def test_update_emergency_returns_200_and_404_when_missing(client: TestClient):
    _set_auth("SYSTEM_ADMIN")

    row = _emergency_row(status="contained")
    client._mock_db.execute.side_effect = [  # type: ignore[attr-defined]
        _result(scalar_one_or_none=row["id"]),
        _result(first=row),
    ]
    r = client.put(
        "/api/admin/information/emergencies/1",
        json={"status": "contained"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "contained"
    update_call = client._mock_db.execute.call_args_list[0]  # type: ignore[attr-defined]
    assert "UPDATE wims.information_emergencies" in update_call.args[0].text
    assert update_call.args[1]["status"] == "contained"
    assert update_call.args[1]["id"] == 1

    client._mock_db.reset_mock()  # type: ignore[attr-defined]
    client._mock_db.execute.side_effect = [_result(scalar_one_or_none=None)]  # type: ignore[attr-defined]
    r = client.put("/api/admin/information/emergencies/999", json={"status": "resolved"})
    assert r.status_code == 404


def test_delete_emergency_returns_204_and_404_when_missing(client: TestClient):
    _set_auth("SYSTEM_ADMIN")

    client._mock_db.execute.side_effect = [_result(rowcount=1)]  # type: ignore[attr-defined]
    r = client.delete("/api/admin/information/emergencies/1")
    assert r.status_code == 204

    client._mock_db.reset_mock()  # type: ignore[attr-defined]
    client._mock_db.execute.side_effect = [_result(rowcount=0)]  # type: ignore[attr-defined]
    r = client.delete("/api/admin/information/emergencies/999")
    assert r.status_code == 404


# ── Promote from incident ────────────────────────────────────────────────────


def test_promote_requires_system_admin_or_validator(client: TestClient):
    _set_auth("REGIONAL_ENCODER")
    r = client.post("/api/admin/information/emergencies/promote/7")
    assert r.status_code == 403

    _set_auth("NATIONAL_ANALYST")
    r = client.post("/api/admin/information/emergencies/promote/7")
    assert r.status_code == 403


def test_promote_returns_201_for_system_admin(client: TestClient):
    _set_auth("SYSTEM_ADMIN")
    incident = {
        "incident_id": 7,
        "region_name": "Region IV",
        "city_name": "City A",
        "barangay_name": "Barangay X",
        "general_description_of_involved": "Structural fire.",
        "geom": "POINT(120.9 14.6)",
    }
    row = _emergency_row(
        promoted_from_incident_id=7,
        title="Incident #7",
        location="Barangay X, City A, Region IV",
        description="Structural fire.",
    )
    client._mock_db.execute.side_effect = [  # type: ignore[attr-defined]
        _result(first=incident),
        _result(scalar_one=row["id"]),
        _result(first=row),
    ]
    r = client.post("/api/admin/information/emergencies/promote/7")
    assert r.status_code == 201
    body = r.json()
    assert body["promoted_from_incident_id"] == 7
    assert body["title"] == "Incident #7"
    assert body["location"] == "Barangay X, City A, Region IV"
    assert body["description"] == "Structural fire."
    assert body["severity"] == "moderate"  # defaults
    assert body["status"] == "ongoing"
    assert body["published"] is False

    # The SELECT should target the incident id, and the INSERT should carry it.
    select_call = client._mock_db.execute.call_args_list[0]  # type: ignore[attr-defined]
    assert "wims.fire_incidents" in select_call.args[0].text
    assert select_call.args[1]["incident_id"] == 7
    insert_call = client._mock_db.execute.call_args_list[1]  # type: ignore[attr-defined]
    assert insert_call.args[1]["promoted_from_incident_id"] == 7
    assert insert_call.args[1]["created_by"] == ADMIN_ID


def test_promote_returns_201_for_national_validator(client: TestClient):
    _set_auth("NATIONAL_VALIDATOR")
    incident = {
        "incident_id": 8,
        "region_name": None,
        "city_name": None,
        "barangay_name": None,
        "general_description_of_involved": None,
        "geom": "POINT(121.0 14.7)",
    }
    row = _emergency_row(
        eid=2,
        promoted_from_incident_id=8,
        title="Incident #8",
        location="POINT(121.0 14.7)",
        description="Promoted from incident #8.",
    )
    client._mock_db.execute.side_effect = [  # type: ignore[attr-defined]
        _result(first=incident),
        _result(scalar_one=row["id"]),
        _result(first=row),
    ]
    r = client.post("/api/admin/information/emergencies/promote/8")
    assert r.status_code == 201
    assert r.json()["promoted_from_incident_id"] == 8
    # No region/city/barangay -> falls back to raw geometry; no description ->
    # falls back to the generated message.
    assert r.json()["location"] == "POINT(121.0 14.7)"
    assert r.json()["description"] == "Promoted from incident #8."


def test_promote_returns_404_when_incident_missing(client: TestClient):
    _set_auth("SYSTEM_ADMIN")
    client._mock_db.execute.side_effect = [_result(first=None)]  # type: ignore[attr-defined]
    r = client.post("/api/admin/information/emergencies/promote/404")
    assert r.status_code == 404


def test_promote_requires_authentication(client: TestClient):
    _set_auth(None)
    r = client.post("/api/admin/information/emergencies/promote/7")
    assert r.status_code == 401
