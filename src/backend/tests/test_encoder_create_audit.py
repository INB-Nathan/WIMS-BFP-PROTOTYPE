"""RP-09: Regional encoder create_incident must write a CREATE_INCIDENT
audit row to wims.system_audit_trails (not just IVH).

Previously encoder_crud.create_incident wrote only to
incident_verification_history (action_label=CREATED_DRAFT) but did not
call log_system_audit, so the system audit trail had no record of the
create action.  The national create path (incidents.py:923) already did.
This test verifies the regional path now does too.
"""

from __future__ import annotations

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


def test_create_incident_writes_create_incident_audit_row(monkeypatch):
    """POST /api/regional/incidents must call log_system_audit with
    action_type='CREATE_INCIDENT' before db.commit().

    Uses client_id=None so the idempotency pre-check block is skipped.
    The 8 non-negative integer fields (civilian_injured etc.) default to 0,
    which is not None, so one NSD INSERT also fires.
    """
    created_id = 99

    insert_result = MagicMock()
    insert_result.fetchone.return_value = (created_id,)

    nsd_insert_result = MagicMock()

    db = MagicMock()
    db.execute.side_effect = [insert_result, nsd_insert_result]

    monkeypatch.setattr(
        "api.routes.regional.encoder_crud._insert_incident_verification_history",
        lambda *_a, **_kw: None,
    )

    audit_spy = MagicMock()
    monkeypatch.setattr("api.routes.regional.encoder_crud.log_system_audit", audit_spy)

    body = _make_body()
    user = _make_user()
    request = MagicMock()

    result = create_incident(request, body, user, db)

    assert result["incident_id"] == created_id
    assert result["status"] == "created"

    # log_system_audit must have been called with CREATE_INCIDENT
    audit_spy.assert_called_once()
    args, kwargs = audit_spy.call_args
    # Positional: (db, user_id, action_type, table_affected, record_id, request)
    assert args[2] == "CREATE_INCIDENT", f"Expected action_type='CREATE_INCIDENT', got {args[2]!r}"
    assert args[3] == "wims.fire_incidents"
    assert args[4] == created_id
    assert args[0] is db  # same session — audit is in the same transaction
    assert args[1] == user["user_id"]

    # The commit must have been called (audit INSERT happens before commit)
    assert db.commit.called, "db.commit was not called after audit write"
