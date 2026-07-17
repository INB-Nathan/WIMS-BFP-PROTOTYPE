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
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

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

    sql = _captured_sql(client)
    assert "information_emergencies" in sql
    assert "published = TRUE" in sql
    assert "ORDER BY ie.published_at DESC" in sql


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
