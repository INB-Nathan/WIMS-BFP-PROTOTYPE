"""Regression test for the fix in create_incident: encoder_id from the DB INSERT
RETURNING clause is a UUID object, but IncidentResponse expects a UUID | None.
The route layer now converts it with str() before passing to the response model.

This test proves the round-trip: a UUID encoder_id from mock DB row[2] is
accepted by IncidentResponse without a Pydantic validation error.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from api.routes.incidents import create_incident
from schemas.incident import IncidentCreate


def test_create_incident_converts_uuid_encoder_id_to_string(monkeypatch):
    user_id = uuid.uuid4()
    created_at = datetime.now(timezone.utc)

    region_result = MagicMock()
    region_result.fetchone.return_value = (1,)

    insert_result = MagicMock()
    insert_result.fetchone.return_value = (123, "unused_location", user_id, "PENDING", created_at)

    coord_result = MagicMock()
    coord_result.fetchone.return_value = (14.5995, 120.9842)

    audit_result = MagicMock()

    db = MagicMock()
    db.execute.side_effect = [region_result, insert_result, audit_result, coord_result]

    monkeypatch.setattr("api.routes.incidents.sync_incident_to_analytics", lambda *_args: None)
    monkeypatch.setattr("api.routes.incidents.set_rls_context", lambda *_args: None)

    request = SimpleNamespace(
        headers={"x-forwarded-for": "198.51.100.10", "user-agent": "pytest-agent"},
        client=SimpleNamespace(host="172.18.0.5"),
    )

    response = create_incident(
        IncidentCreate(latitude=14.5995, longitude=120.9842, description="Test fire in Manila"),
        request,
        {"user_id": user_id},
        db,
    )

    assert response.incident_id == 123
    assert str(response.encoder_id) == str(user_id)
    assert response.status == "PENDING"
    audit_params = db.execute.call_args_list[2][0][1]
    assert audit_params["action"] == "CREATE_INCIDENT"
    assert audit_params["table"] == "wims.fire_incidents"
    assert audit_params["rec"] == 123
    assert audit_params["ip"] == "198.51.100.10"
    assert audit_params["ua"] == "pytest-agent"

    audit_execute_index = next(
        i
        for i, call in enumerate(db.mock_calls)
        if call[0] == "execute" and len(call[1]) > 1 and call[1][1] is audit_params
    )
    first_commit_index = next(i for i, call in enumerate(db.mock_calls) if call[0] == "commit")
    assert audit_execute_index < first_commit_index
    assert db.commit.call_count == 2
