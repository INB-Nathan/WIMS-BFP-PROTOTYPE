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
    # PR #446 gap #14: the audit row's ip_address column must be the
    # TRUSTED socket IP (the ASGI socket peer when no X-Real-IP is set),
    # NOT the client-controlled XFF value. Pre-fix the audit log was
    # pinning the XFF first-hop, which made the audit row actively wrong
    # after the rate-limiter was anchored to $realip_remote_addr.
    assert audit_params["ip"] == "172.18.0.5", (
        f"Audit log must store the trusted socket IP, not the XFF hop. Got {audit_params['ip']!r}"
    )
    assert audit_params["ua"] == "pytest-agent"

    audit_execute_index = next(
        i
        for i, call in enumerate(db.mock_calls)
        if call[0] == "execute" and len(call[1]) > 1 and call[1][1] is audit_params
    )
    first_commit_index = next(i for i, call in enumerate(db.mock_calls) if call[0] == "commit")
    assert audit_execute_index < first_commit_index
    assert db.commit.call_count == 2


def test_analytics_sync_failure_is_non_fatal(monkeypatch):
    """When sync_incident_to_analytics raises, the endpoint still returns the
    created incident — analytics failure is a soft error; the incident is
    already committed by the primary db.commit()."""
    user_id = uuid.uuid4()
    created_at = datetime.now(timezone.utc)

    region_result = MagicMock()
    region_result.fetchone.return_value = (1,)

    insert_result = MagicMock()
    insert_result.fetchone.return_value = (123, "unused", user_id, "DRAFT", created_at)

    coord_result = MagicMock()
    coord_result.fetchone.return_value = (14.5995, 120.9842)

    db = MagicMock()
    db.execute.side_effect = [region_result, insert_result, MagicMock(), coord_result]

    db.commit.side_effect = [None, RuntimeError("analytics commit failed")]

    monkeypatch.setattr(
        "api.routes.incidents.sync_incident_to_analytics",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("analytics sync failed")),
    )
    monkeypatch.setattr("api.routes.incidents.set_rls_context", lambda *_args: None)

    request = SimpleNamespace(
        headers={"x-forwarded-for": "10.0.0.1", "user-agent": "pytest"},
        client=SimpleNamespace(host="172.18.0.5"),
    )

    response = create_incident(
        IncidentCreate(latitude=14.5995, longitude=120.9842, description="Test"),
        request,
        {"user_id": user_id},
        db,
    )

    # The incident was created (primary commit succeeded)
    assert response.incident_id == 123
    assert str(response.encoder_id) == str(user_id)
    assert response.status == "DRAFT"

    # First commit (incident INSERT) succeeded, second commit (analytics) failed
    assert db.commit.call_count == 2
    # rollback() called for the failed analytics commit
    db.rollback.assert_called()
