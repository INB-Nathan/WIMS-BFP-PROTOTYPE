"""Unit test for offline-first idempotency on the upload-bundle endpoint.

The offline sync engine replays a queued create through POST /incidents/upload-bundle
tagged with a client_id (the op's local UUID). If a network timeout masked a 201 the
first time, the retry must return the existing incident instead of inserting a
duplicate.

Uses MagicMock for the DB session (no live database), mirroring the pattern in
test_incidents_create_endpoint.py.

The idempotency path since Q4 fix:
  1. assigned-region SELECT
  2. batch INSERT
  3. client_id column CHECK
  4. fire_incidents INSERT ... ON CONFLICT DO NOTHING RETURNING → returns None (conflict)
  5. fallback SELECT to retrieve existing incident_id
"""

from __future__ import annotations

from unittest.mock import MagicMock

from api.routes.incidents import upload_incident_bundle
from schemas.incident_bundle import IncidentBundleCreate


def test_upload_bundle_returns_existing_incident_for_duplicate_client_id(monkeypatch):
    client_id = "aaaaaaaa-0000-0000-0000-000000000001"
    existing_incident_id = 999

    assigned_result = MagicMock()
    assigned_result.fetchone.return_value = (1,)  # assigned_region_id

    batch_result = MagicMock()
    batch_result.fetchone.return_value = (1,)  # batch_id

    col_exists_result = MagicMock()
    col_exists_result.fetchone.return_value = (1,)  # client_id column exists

    insert_conflict_result = MagicMock()
    insert_conflict_result.fetchone.return_value = None  # ON CONFLICT DO NOTHING

    fallback_select_result = MagicMock()
    fallback_select_result.fetchone.return_value = (existing_incident_id,)  # conflict resolution

    db = MagicMock()
    db.execute.side_effect = [
        assigned_result,
        batch_result,
        col_exists_result,
        insert_conflict_result,
        fallback_select_result,
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

    body_obj = IncidentBundleCreate(**body)
    request = MagicMock()
    response = upload_incident_bundle(request, body_obj, user, db)

    # Existing incident returned; no duplicate inserted.
    assert response["incident_ids"] == [existing_incident_id]
    assert response["imported"] == [existing_incident_id]
    assert response["failed"] == []
    # Six executes: assigned-region, batch insert, column check, pg_advisory_xact_lock,
    # fallback SELECT to resolve the conflicted client_id,
    # plus system_audit_trails INSERT from log_system_audit().
    assert db.execute.call_count == 6
