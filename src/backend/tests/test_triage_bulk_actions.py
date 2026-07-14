"""
TDD: Triage bulk actions + source filter (issue #578).

Covers:
- POST /api/triage/bulk-promote   (ACTIONED + validated_by, idempotent-validate-all)
- POST /api/triage/bulk-dismiss    (REJECTED_INSUFFICIENT + reason)
- POST /api/triage/bulk-link       (LINKED + linked_to_report_id, incident validated)
- GET  /api/triage/queue?source=   (registered | anonymous | all)
- Reject-all semantics: any invalid id => 404, none mutated.
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from auth import get_current_wims_user, get_db_with_rls
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


def mock_encoder_user():
    return {
        "user_id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-encoder",
        "username": "encoder",
        "role": "REGIONAL_ENCODER",
    }


def mock_civilian_user():
    return {
        "user_id": "cccc2222-2222-4222-8222-222222222222",
        "keycloak_id": "kid-civ",
        "username": "civ",
        "role": "CIVILIAN_REPORTER",
    }


def _mock_db(existing_ids, incident_exists=True):
    """Build a mock db whose SELECT-existing returns `existing_ids` and whose
    incident-existence check returns (1,) or None."""
    sel_result = MagicMock()
    sel_result.fetchall.return_value = [(i,) for i in existing_ids]
    inc_result = MagicMock()
    inc_result.fetchone.return_value = (1,) if incident_exists else None
    mock_db = MagicMock()

    # First call = incident existence check (only bulk-link); second = select existing;
    # subsequent = update + per-row audit inserts. Route the first call to inc_result
    # and every later call to sel_result so both paths behave.
    calls = {"n": 0}

    def _execute(*args, **kwargs):
        calls["n"] += 1
        # bulk-link's incident check is the only query that uses fetchone for a
        # 1-row existence probe; detect by the SELECT 1 pattern.
        sql = str(args[0]) if args else ""
        if "SELECT 1 FROM wims.citizen_reports WHERE report_id = :i" in sql:
            return inc_result
        return sel_result

    mock_db.execute.side_effect = _execute

    def mock_get_db():
        yield mock_db

    return mock_db, mock_get_db


# ── bulk-promote ─────────────────────────────────────────────────────────────


class TestBulkPromote:
    def test_promotes_all_and_audits_each(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        mock_db, mock_get_db = _mock_db(existing_ids=[1, 2])
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.triage.log_system_audit") as mock_audit:
            resp = client.post("/api/triage/bulk-promote", json={"report_ids": [1, 2]})

        assert resp.status_code == 201
        assert resp.json()["updated"] == 2
        assert resp.json()["status"] == "ACTIONED"
        assert mock_audit.call_count == 2

        update_sql = next(
            c[0][0]
            for c in mock_db.execute.call_args_list
            if "UPDATE wims.citizen_reports" in str(c[0][0])
        )
        assert "validated_by = :validated_by" in str(update_sql)

    def test_rejects_when_any_id_missing(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        mock_db, mock_get_db = _mock_db(existing_ids=[1])  # 2 is missing
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.triage.log_system_audit") as mock_audit:
            resp = client.post("/api/triage/bulk-promote", json={"report_ids": [1, 2]})

        assert resp.status_code == 404
        assert "2" in resp.json()["detail"]
        mock_audit.assert_not_called()
        # No UPDATE should have been issued (reject-all semantics).
        assert not any(
            "UPDATE wims.citizen_reports" in str(c[0][0])
            for c in mock_db.execute.call_args_list
        )

    def test_rejects_over_max(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        mock_db, mock_get_db = _mock_db(existing_ids=[])
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.post(
            "/api/triage/bulk-promote", json={"report_ids": list(range(101))}
        )
        assert resp.status_code == 422

    def test_requires_encoder_or_validator(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_civilian_user
        mock_db, mock_get_db = _mock_db(existing_ids=[1])
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.post("/api/triage/bulk-promote", json={"report_ids": [1]})
        assert resp.status_code in (401, 403)


# ── bulk-dismiss ─────────────────────────────────────────────────────────────


class TestBulkDismiss:
    def test_dismisses_all_with_reason(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        mock_db, mock_get_db = _mock_db(existing_ids=[3, 4])
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.triage.log_system_audit") as mock_audit:
            resp = client.post(
                "/api/triage/bulk-dismiss",
                json={"report_ids": [3, 4], "reason": "duplicate noise"},
            )

        assert resp.status_code == 200
        assert resp.json()["updated"] == 2
        assert resp.json()["status"] == "REJECTED_INSUFFICIENT"
        assert mock_audit.call_count == 2

        update_sql = next(
            c[0][0]
            for c in mock_db.execute.call_args_list
            if "UPDATE wims.citizen_reports" in str(c[0][0])
        )
        str_sql = str(update_sql)
        assert "status = :status" in str_sql
        assert "status_explanation = :status_explanation" in str_sql

    def test_rejects_when_any_id_missing(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        mock_db, mock_get_db = _mock_db(existing_ids=[3])
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.post(
            "/api/triage/bulk-dismiss",
            json={"report_ids": [3, 99], "reason": "x"},
        )
        assert resp.status_code == 404


# ── bulk-link ───────────────────────────────────────────────────────────────


class TestBulkLink:
    def test_links_all_to_incident(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        mock_db, mock_get_db = _mock_db(existing_ids=[5, 6], incident_exists=True)
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.triage.log_system_audit") as mock_audit:
            resp = client.post(
                "/api/triage/bulk-link",
                json={"report_ids": [5, 6], "incident_id": 999},
            )

        assert resp.status_code == 200
        assert resp.json()["updated"] == 2
        assert resp.json()["status"] == "LINKED"
        assert resp.json()["incident_id"] == 999
        assert mock_audit.call_count == 2

        update_sql = next(
            c[0][0]
            for c in mock_db.execute.call_args_list
            if "UPDATE wims.citizen_reports" in str(c[0][0])
        )
        assert "linked_to_report_id = :linked_to_report_id" in str(update_sql)

    def test_rejects_when_incident_missing(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        mock_db, mock_get_db = _mock_db(existing_ids=[5], incident_exists=False)
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        with patch("api.routes.triage.log_system_audit") as mock_audit:
            resp = client.post(
                "/api/triage/bulk-link",
                json={"report_ids": [5], "incident_id": 999},
            )

        assert resp.status_code == 404
        mock_audit.assert_not_called()


# ── GET queue source filter ─────────────────────────────────────────────────


class TestTriageQueueSourceFilter:
    def test_registered_source_filters_contributor_not_null(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        mock_db, mock_get_db = _mock_db(existing_ids=[])
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get("/api/triage/queue?source=registered")
        assert resp.status_code == 200
        # The source filter is applied inside get_queue (queue_projection); the
        # route forwards `source` to the service. We assert the parameter reached
        # the route layer without error and the response shape is unchanged.
        assert "clusters" in resp.json()

    def test_anonymous_source_accepted(self, client: TestClient):
        app.dependency_overrides[get_current_wims_user] = mock_encoder_user
        mock_db, mock_get_db = _mock_db(existing_ids=[])
        app.dependency_overrides[get_db_with_rls] = mock_get_db

        resp = client.get("/api/triage/queue?source=anonymous")
        assert resp.status_code == 200
        assert "clusters" in resp.json()
