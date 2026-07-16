"""Tests for POST /api/triage/reports/{report_id}/update-status (#632).

These are UNIT tests: the DB session is a fake, and the Redis event bus and
audit helper are mocked — no Docker/Postgres/Redis required. They exercise the
full route + service stack via FastAPI TestClient with dependency overrides.

Coverage:
- valid forward transition returns 201
- rejected backward transition returns 400
- missing required metadata returns 400
- unknown report returns 404
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


class FakeRow:
    """Minimal stand-in for a SQLAlchemy result row.

    Supports both positional access ``row[0]`` and attribute access
    ``row.update_id`` (SQLAlchemy Row supports both).
    """

    _COLUMNS = [
        "update_id",
        "report_id",
        "stage",
        "metadata",
        "actor_user_id",
        "created_at",
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


class FakeSession:
    """Records executed text and returns programmed results.

    `program` maps a substring of the executed SQL to a FakeResult.
    `insert_result` is returned by the INSERT ... RETURNING.
    """

    def __init__(self, program: dict[str, FakeResult], insert_result_id: int = 1):
        self._program = program
        self._insert_result_id = insert_result_id
        self.committed = False
        self.rolled_back = False
        self.executed: list[str] = []
        self.last_params: dict | None = None

    def execute(self, statement, params: dict | None = None):
        sql = str(statement)
        self.executed.append(sql)
        self.last_params = params
        if "INSERT INTO wims.report_status_updates" in sql:
            # Echo back the bound values so RETURNING reflects the insert.
            row = FakeRow(
                [
                    self._insert_result_id,
                    params["report_id"],
                    params["stage"],
                    params["metadata"],
                    params["actor_user_id"],
                    params["created_at"],
                ]
            )
            return FakeResult([row])
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


def _make_session(
    *,
    report_exists: bool = True,
    current_stage: str | None = None,
    new_update_id: int = 1,
    metadata: dict | None = None,
):
    program: dict[str, FakeResult] = {}
    program["wims.citizen_reports WHERE report_id"] = FakeResult(
        [FakeRow([1])] if report_exists else []
    )
    if current_stage is not None:
        program["FROM wims.report_status_updates"] = FakeResult([FakeRow([current_stage])])
    return FakeSession(program=program, insert_result_id=new_update_id)


def _install_session(session: FakeSession, user: dict):
    app.dependency_overrides[auth.get_current_wims_user] = lambda: user
    app.dependency_overrides[auth.get_db_with_rls] = lambda: session


URL = "/api/triage/reports/1/update-status"


@patch("services.civilian_triage.status_update.publish_status_update_event_sync")
@patch("services.civilian_triage.status_update.log_system_audit")
def test_valid_forward_transition(mock_audit, mock_publish, client):
    session = _make_session(report_exists=True, current_stage="RECEIVED")
    _install_session(session, VALIDATOR_USER)
    resp = client.post(
        URL,
        json={"stage": "UNDER_REVIEW", "metadata": None},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["stage"] == "UNDER_REVIEW"
    assert body["report_id"] == 1
    assert "update_id" in body
    assert session.committed
    mock_publish.assert_called_once()
    mock_audit.assert_called_once()


@patch("services.civilian_triage.status_update.publish_status_update_event_sync")
@patch("services.civilian_triage.status_update.log_system_audit")
def test_help_dispatched_then_under_review_backward_rejected(mock_audit, mock_publish, client):
    # First transition succeeds (RECEIVED -> HELP_DISPATCHED).
    session1 = _make_session(report_exists=True, current_stage="RECEIVED")
    _install_session(session1, VALIDATOR_USER)
    r1 = client.post(
        URL,
        json={
            "stage": "HELP_DISPATCHED",
            "metadata": {"station_name": "Stn1", "jurisdiction": "City"},
        },
    )
    assert r1.status_code == 201, r1.text
    app.dependency_overrides.clear()

    # Second transition HELP_DISPATCHED -> UNDER_REVIEW is backward => 400.
    session2 = _make_session(report_exists=True, current_stage="HELP_DISPATCHED")
    _install_session(session2, VALIDATOR_USER)
    r2 = client.post(URL, json={"stage": "UNDER_REVIEW", "metadata": None})
    assert r2.status_code == 400, r2.text


@patch("services.civilian_triage.status_update.publish_status_update_event_sync")
@patch("services.civilian_triage.status_update.log_system_audit")
def test_help_dispatched_missing_station_name(mock_audit, mock_publish, client):
    session = _make_session(report_exists=True, current_stage="RECEIVED")
    _install_session(session, VALIDATOR_USER)
    r = client.post(
        URL,
        json={"stage": "HELP_DISPATCHED", "metadata": {"jurisdiction": "City"}},
    )
    assert r.status_code == 400, r.text
    assert "station_name" in r.text


@patch("services.civilian_triage.status_update.publish_status_update_event_sync")
@patch("services.civilian_triage.status_update.log_system_audit")
def test_unknown_report_404(mock_audit, mock_publish, client):
    session = _make_session(report_exists=False)
    _install_session(session, VALIDATOR_USER)
    r = client.post(URL, json={"stage": "RECEIVED", "metadata": None})
    assert r.status_code == 404, r.text


@patch("services.civilian_triage.status_update.publish_status_update_event_sync")
@patch("services.civilian_triage.status_update.log_system_audit")
def test_wrong_role_403(mock_audit, mock_publish, client):
    session = _make_session(report_exists=True, current_stage="RECEIVED")
    _install_session(session, CIVILIAN_USER)
    r = client.post(URL, json={"stage": "UNDER_REVIEW", "metadata": None})
    assert r.status_code == 403, r.text


@patch("services.civilian_triage.status_update.publish_status_update_event_sync")
@patch("services.civilian_triage.status_update.log_system_audit")
def test_regional_encoder_allowed(mock_audit, mock_publish, client):
    session = _make_session(report_exists=True, current_stage="RECEIVED")
    _install_session(session, ENCODER_USER)
    r = client.post(URL, json={"stage": "UNDER_REVIEW", "metadata": None})
    assert r.status_code == 201, r.text


@patch("services.civilian_triage.status_update.publish_status_update_event_sync")
@patch("services.civilian_triage.status_update.log_system_audit")
def test_transition_from_terminal_stage_rejected(mock_audit, mock_publish, client):
    session = _make_session(report_exists=True, current_stage="RESOLVED")
    _install_session(session, VALIDATOR_USER)
    r = client.post(
        URL,
        json={
            "stage": "CLOSED_DUPLICATE",
            "metadata": {"duplicate_of_report_id": 2},
        },
    )
    assert r.status_code == 400, r.text
