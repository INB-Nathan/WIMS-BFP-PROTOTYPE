"""Unit tests for client_id idempotency on the regional encoder create endpoint.

Covers:
  1. Duplicate client_id — pre-check SELECT finds existing → early return.
  2. Concurrent duplicate client_id — pre-check misses (race) → INSERT ON CONFLICT
     returns None → fallback SELECT resolves existing incident.
  3. Malformed client_id — UUID validation raises HTTP 422 before any DB call.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from unittest.mock import MagicMock

from api.routes.regional.encoder_crud import create_incident
from schemas.regional import IncidentCreateRequest


def _make_body(**kwargs) -> IncidentCreateRequest:
    defaults = dict(
        region_id=1,
        latitude=14.5,
        longitude=121.0,
        incident_type_code=None,
        parent_incident_id=None,
        client_id=None,
    )
    defaults.update(kwargs)
    return IncidentCreateRequest(**defaults)


def _make_user(region_id: int = 1) -> dict:
    return {"user_id": "bbbbbbbb-0000-0000-0000-000000000001", "assigned_region_id": region_id}


# ── 1. Pre-check hit (common idempotent retry) ────────────────────────────────


def test_create_incident_returns_existing_for_known_client_id():
    """Second sync attempt for the same client_id returns the already-created incident."""
    client_id = "aaaaaaaa-0000-0000-0000-000000000001"
    existing_id = 42

    col_exists = MagicMock()
    col_exists.fetchone.return_value = (1,)  # client_id column exists

    pre_check = MagicMock()
    pre_check.fetchone.return_value = (existing_id, "DRAFT", None)  # existing row found

    db = MagicMock()
    db.execute.side_effect = [col_exists, pre_check]

    body = _make_body(client_id=client_id)
    user = _make_user()

    result = create_incident(body, user, db)

    assert result["incident_id"] == existing_id
    assert result["status"] == "created"
    # Only two executes: column check + pre-existing SELECT.
    # No INSERT must fire on this path.
    assert db.execute.call_count == 2
    db.commit.assert_not_called()


# ── 2. Concurrent race — INSERT ON CONFLICT path ─────────────────────────────


def test_create_incident_resolves_concurrent_duplicate_via_on_conflict():
    """A concurrent retry that races past the pre-check resolves via ON CONFLICT fallback."""
    client_id = "aaaaaaaa-0000-0000-0000-000000000002"
    existing_id = 77

    col_exists_precheck = MagicMock()
    col_exists_precheck.fetchone.return_value = (1,)  # column exists (pre-check path)

    pre_check_miss = MagicMock()
    pre_check_miss.fetchone.return_value = None  # race: not found yet

    col_exists_insert = MagicMock()
    col_exists_insert.fetchone.return_value = (1,)  # column exists (insert path)

    insert_conflict = MagicMock()
    insert_conflict.fetchone.return_value = None  # ON CONFLICT DO NOTHING

    fallback_select = MagicMock()
    fallback_select.fetchone.return_value = (existing_id, "DRAFT", None)

    db = MagicMock()
    db.execute.side_effect = [
        col_exists_precheck,
        pre_check_miss,
        col_exists_insert,
        insert_conflict,
        fallback_select,
    ]

    body = _make_body(client_id=client_id)
    user = _make_user()

    result = create_incident(body, user, db)

    assert result["incident_id"] == existing_id
    assert result["status"] == "created"
    assert db.execute.call_count == 5


# ── 3. Malformed client_id — validated before any DB call ────────────────────


def test_create_incident_rejects_malformed_client_id():
    """A non-UUID client_id raises HTTP 422 without touching the database."""
    db = MagicMock()
    body = _make_body(client_id="not-a-valid-uuid")
    user = _make_user()

    with pytest.raises(HTTPException) as exc_info:
        create_incident(body, user, db)

    assert exc_info.value.status_code == 422
    assert "UUID" in exc_info.value.detail
    db.execute.assert_not_called()
