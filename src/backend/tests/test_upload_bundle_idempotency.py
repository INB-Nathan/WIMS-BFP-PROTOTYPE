"""Unit test for offline-first idempotency on the upload-bundle endpoint.

The offline sync engine replays a queued create through POST /incidents/upload-bundle
tagged with a client_id (the op's local UUID). If a network timeout masked a 201 the
first time, the retry must return the existing incident instead of inserting a
duplicate. This proves the idempotent branch returns the existing id and does NOT
issue a second fire_incidents INSERT.

Uses MagicMock for the DB session (no live database), mirroring the pattern in
test_incidents_create_endpoint.py.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from api.routes.incidents import upload_incident_bundle


def test_upload_bundle_returns_existing_incident_for_duplicate_client_id(monkeypatch):
    client_id = "aaaaaaaa-0000-0000-0000-000000000001"
    existing_incident_id = 999

    assigned_result = MagicMock()
    assigned_result.fetchone.return_value = (1,)  # assigned_region_id

    batch_result = MagicMock()
    batch_result.fetchone.return_value = (1,)  # batch_id

    col_exists_result = MagicMock()
    col_exists_result.fetchone.return_value = (1,)  # client_id column exists

    existing_result = MagicMock()
    existing_result.fetchone.return_value = (existing_incident_id,)  # idempotent hit

    db = MagicMock()
    db.execute.side_effect = [
        assigned_result,
        batch_result,
        col_exists_result,
        existing_result,
    ]

    monkeypatch.setattr("api.routes.incidents.sync_incident_to_analytics", lambda *_a: None)
    monkeypatch.setattr("api.routes.incidents.set_rls_context", lambda *_a: None)

    body = {
        "region_id": 1,
        "incidents": [
            {
                "latitude": 14.5,
                "longitude": 121.0,
                "client_id": client_id,
                "incident_nonsensitive_details": {"alarm_level": "1st Alarm"},
            }
        ],
    }
    user = {"user_id": "encoder-uuid", "role": "REGIONAL_ENCODER"}

    response = upload_incident_bundle(body, user, db)

    # Existing incident returned; no duplicate inserted.
    assert response["incident_ids"] == [existing_incident_id]
    assert response["imported"] == [existing_incident_id]
    assert response["failed"] == []
    # Exactly four executes: assigned-region, batch insert, column check, idempotency
    # lookup. The fifth (fire_incidents INSERT) must NOT fire on the idempotent path.
    assert db.execute.call_count == 4
