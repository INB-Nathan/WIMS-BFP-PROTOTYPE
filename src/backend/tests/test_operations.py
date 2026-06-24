"""
Tests for the validator-maintained Operations Board.

GET  /api/operations      — public read (no auth required)
POST /api/operations      — NATIONAL_VALIDATOR only → 201
PATCH /api/operations/{id} — NATIONAL_VALIDATOR only → 200
DELETE /api/operations/{id} — NATIONAL_VALIDATOR only → 204
POST /api/operations/{id}/link — NATIONAL_VALIDATOR only → 201
Audit log: OPERATION_CREATE written after create.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import auth
from auth import get_db_with_rls, get_incident_viewer, get_national_validator
from database import get_db
from main import app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Mock users
# ---------------------------------------------------------------------------


def _mock_validator():
    return {
        "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-validator",
        "username": "validator",
        "role": "NATIONAL_VALIDATOR",
        "assigned_region_id": None,
    }


def _mock_encoder():
    return {
        "user_id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "keycloak_id": "kid-encoder",
        "username": "encoder",
        "role": "REGIONAL_ENCODER",
        "assigned_region_id": 1,
    }


# ---------------------------------------------------------------------------
# DB mock helpers
# ---------------------------------------------------------------------------


def _op_row(
    operation_id=1,
    fire_status="ACTIVE",
    location="Test Location",
    size_hectares=2.5,
    notes="Test notes",
    created_by=None,
):
    """Return a MagicMock row that simulates a wims.operations row."""
    row = MagicMock()
    row.operation_id = operation_id
    row.fire_status = fire_status
    row.start_time = "2026-06-10T08:00:00+00:00"
    row.location = location
    row.size_hectares = size_hectares
    row.notes = notes
    row.created_by = created_by
    row.created_at = "2026-06-10T08:00:00+00:00"
    row.updated_at = "2026-06-10T08:00:00+00:00"
    return row


def _make_db(op_rows=None, linked_rows=None, rowcount=1):
    """
    Build a mock Session that returns op_rows on the first execute and
    linked_rows (report IDs) on subsequent executes for the junction query.

    Captures INSERT params so tests can verify submitted payload values.
    """
    if op_rows is None:
        op_rows = [_op_row()]
    if linked_rows is None:
        linked_rows = []

    captured_inserts: list[dict] = []  # (sql, params) tuples

    def execute_side_effect(query, params=None):
        result = MagicMock()
        sql = str(query)

        if "INSERT INTO" in sql:
            captured_inserts.append({"sql": sql, "params": params})
            # Return the first op_row for INSERT...RETURNING queries
            if "RETURNING" in sql:
                result.fetchone.return_value = op_rows[0] if op_rows else None
        elif "operation_citizen_reports" in sql and "SELECT" in sql:
            if "ST_Y" in sql:
                result.fetchall.return_value = []
                result.fetchone.return_value = None
            else:
                result.fetchall.return_value = linked_rows
                result.fetchone.return_value = linked_rows[0] if linked_rows else None
        elif "wims.operations" in sql or "operations" in sql:
            result.fetchall.return_value = op_rows
            result.fetchone.return_value = op_rows[0] if op_rows else None
        elif "citizen_reports" in sql:
            rid = (params or {}).get("rid", 5)
            result.fetchone.return_value = _CitizenReportStatusRow(report_id=rid)
            result.fetchall.return_value = []
        else:
            result.fetchall.return_value = []
            result.fetchone.return_value = None

        result.rowcount = rowcount
        return result

    mock_db = MagicMock()
    mock_db.execute.side_effect = execute_side_effect
    mock_db.captured_inserts = captured_inserts

    def _get_db_override():
        yield mock_db

    return mock_db, _get_db_override


class _CitizenReportStatusRow:
    def __init__(self, report_id=5, status="PENDING", linked_operation_id=None):
        self.report_id = report_id
        self.status = status
        self.linked_operation_id = linked_operation_id


class _LinkedReportRow:
    def __init__(self, operation_id=1, report_id=5, status="PENDING"):
        self.operation_id = operation_id
        self.report_id = report_id
        self.status = status
        self.category = "STRUCTURAL"
        self.sub_category = "Residential"
        self.reported_at = "2026-06-10T07:55:00+00:00"
        self.created_at = "2026-06-10T07:56:00+00:00"
        self.latitude = 14.5995
        self.longitude = 120.9842
        self.trust_score = 80
        self.safety_status = "I_AM_SAFE"
        self.reporting_context = "WITNESS"
        self.linked_operation_id = operation_id
        self.linked_operation_label = f"Operation #{operation_id}"
        self.distance_meters = 42.0


# ---------------------------------------------------------------------------
# 1. GET /api/operations — public, no auth
# ---------------------------------------------------------------------------


class TestListOperations:
    def test_list_operations_public(self, client: TestClient):
        """GET /api/operations returns 200 with viewer-level auth (encoder or above)."""
        mock_db, get_db_override = _make_db(op_rows=[_op_row()])
        app.dependency_overrides[get_db] = get_db_override
        app.dependency_overrides[get_incident_viewer] = lambda: _mock_encoder()

        resp = client.get("/api/operations")

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["fire_status"] == "ACTIVE"
        assert data[0]["location"] == "Test Location"

    def test_list_operations_empty(self, client: TestClient):
        """GET /api/operations returns empty list when no ops exist."""
        mock_db, get_db_override = _make_db(op_rows=[])
        app.dependency_overrides[get_db] = get_db_override
        app.dependency_overrides[get_incident_viewer] = lambda: _mock_encoder()

        resp = client.get("/api/operations")

        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_operations_linked_report_ids(self, client: TestClient):
        """Linked report IDs are included in each operation response."""
        link_row = MagicMock()
        link_row.operation_id = 1
        link_row.report_id = 42
        mock_db, get_db_override = _make_db(op_rows=[_op_row()], linked_rows=[link_row])
        app.dependency_overrides[get_db] = get_db_override
        app.dependency_overrides[get_incident_viewer] = lambda: _mock_encoder()

        resp = client.get("/api/operations")

        assert resp.status_code == 200
        assert 42 in resp.json()[0]["linked_report_ids"]


class TestListOperationsLinkedReportDetails:
    def test_list_operations_returns_linked_reports_without_pii(self, client: TestClient):
        row = _op_row()
        linked_row = _LinkedReportRow()

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "ST_Y(cr.location::geometry)" in sql and "operation_citizen_reports" in sql:
                result.fetchall.return_value = [linked_row]
            elif "operation_citizen_reports" in sql and "SELECT" in sql:
                result.fetchall.return_value = [linked_row]
            elif "wims.operations" in sql:
                result.fetchall.return_value = [row]
                result.fetchone.return_value = row
            else:
                result.fetchall.return_value = []
                result.fetchone.return_value = None
            result.rowcount = 1
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_incident_viewer] = lambda: _mock_encoder()

        resp = client.get("/api/operations")

        assert resp.status_code == 200
        data = resp.json()[0]
        assert data["linked_report_ids"] == [5]
        assert data["linked_reports"] == [
            {
                "report_id": 5,
                "status": "PENDING",
                "category": "STRUCTURAL",
                "sub_category": "Residential",
                "reported_at": "2026-06-10T07:55:00Z",
                "latitude": 14.5995,
                "longitude": 120.9842,
                "trust_score": 80,
                "safety_status": "I_AM_SAFE",
                "reporting_context": "WITNESS",
                "linked_operation_id": 1,
                "linked_operation_label": "Operation #1",
                "distance_meters": 42.0,
            }
        ]
        for lr in data["linked_reports"]:
            assert "witness" not in lr, f"PII key witness found in {lr}"
            assert "phone" not in lr, f"PII key phone found in {lr}"
            assert "device" not in lr, f"PII key device found in {lr}"
            assert "ip_hash" not in lr, f"PII key ip_hash found in {lr}"


# ---------------------------------------------------------------------------
# 1b. GET /api/operations/linkable-reports — validator-only search
# ---------------------------------------------------------------------------


class TestLinkableReportsSearch:
    def test_linkable_reports_requires_validator(self, client: TestClient):
        _, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[auth.get_current_wims_user] = _mock_encoder

        resp = client.get("/api/operations/linkable-reports")

        assert resp.status_code == 403

    def test_linkable_reports_returns_disabled_already_linked_cards(self, client: TestClient):
        linked_row = _LinkedReportRow(operation_id=2, report_id=9, status="LINKED")

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "FROM wims.citizen_reports cr" in sql:
                result.fetchall.return_value = [linked_row]
            else:
                result.fetchall.return_value = []
            result.fetchone.return_value = None
            result.rowcount = 1
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.get("/api/operations/linkable-reports?operation_id=1")

        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["report_id"] == 9
        assert data[0]["linked_operation_id"] == 2
        assert data[0]["link_disabled"] is True
        assert data[0]["disabled_reason"] == "Already linked to Operation #2"
        executed_sql = "\n".join(str(call.args[0]) for call in mock_db.execute.call_args_list)
        assert "REJECTED_%" in executed_sql
        assert "ST_Y(cr.location::geometry)" in executed_sql
        assert "ST_X(cr.location::geometry)" in executed_sql
        assert "phone_latitude" not in executed_sql
        assert "phone_longitude" not in executed_sql


# ---------------------------------------------------------------------------
# 2. POST /api/operations — validator → 201
# ---------------------------------------------------------------------------


class TestCreateOperation:
    _payload = {
        "fire_status": "ACTIVE",
        "start_time": "2026-06-10T08:00:00Z",
        "location": "Quezon City, Barangay Tatalon",
        "size_hectares": 2.5,
        "notes": "Residential area",
    }

    def test_create_operation_validator(self, client: TestClient):
        """POST /api/operations with NATIONAL_VALIDATOR auth returns 201."""
        mock_db, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post("/api/operations", json=self._payload)

        assert resp.status_code == 201
        data = resp.json()
        assert data["fire_status"] == "ACTIVE"
        assert data["location"] == "Test Location"  # mock row default
        # Verify INSERT was called with submitted payload values, not mock row
        inserts = [c for c in mock_db.captured_inserts if "INSERT INTO" in c["sql"]]
        assert len(inserts) >= 1, f"Expected at least 1 INSERT, got {len(inserts)}"
        op_insert = inserts[0]
        assert "wims.operations" in op_insert["sql"]
        assert op_insert["params"]["loc"] == self._payload["location"]
        assert op_insert["params"]["sh"] == self._payload["size_hectares"]
        assert op_insert["params"]["notes"] == self._payload["notes"]
        assert op_insert["params"]["fs"] == self._payload["fire_status"]

    def test_create_operation_non_validator(self, client: TestClient):
        """POST /api/operations with REGIONAL_ENCODER returns 403."""
        _, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[auth.get_current_wims_user] = _mock_encoder

        resp = client.post("/api/operations", json=self._payload)

        assert resp.status_code == 403

    def test_create_operation_unauthenticated(self, client: TestClient):
        """POST /api/operations with no credentials returns 401 or 403."""
        _, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        resp = client.post("/api/operations", json=self._payload)
        assert resp.status_code in (401, 403)

    def test_create_operation_accepts_initial_linked_report_ids(self, client: TestClient):
        op = _op_row(operation_id=1)
        captured_inserts: list[dict] = []

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "INSERT INTO" in sql:
                captured_inserts.append({"sql": sql, "params": params})
                if "RETURNING" in sql:
                    result.fetchone.return_value = op
            elif "operation_citizen_reports" in sql and "WHERE report_id = :rid" in sql:
                result.fetchone.return_value = None
            elif "SELECT report_id, status FROM wims.citizen_reports" in sql:
                result.fetchone.return_value = _CitizenReportStatusRow(
                    report_id=params["rid"],
                    status="PENDING",
                    linked_operation_id=None,
                )
            elif "SELECT report_id FROM wims.operation_citizen_reports" in sql:
                result.fetchall.return_value = []
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            result.rowcount = 1
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        mock_db.captured_inserts = captured_inserts
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post(
            "/api/operations",
            json={
                "fire_status": "ACTIVE",
                "start_time": "2026-06-10T08:00:00Z",
                "location": "Test City",
                "linked_report_ids": [5, 6],
            },
        )

        assert resp.status_code == 201
        executed_sql = "\n".join(str(call.args[0]) for call in mock_db.execute.call_args_list)
        assert "INSERT INTO wims.operation_citizen_reports" in executed_sql
        linked_insert_params = [
            item["params"] for item in captured_inserts if "operation_citizen_reports" in item["sql"]
        ]
        assert linked_insert_params == [{"oid": 1, "rid": 5}, {"oid": 1, "rid": 6}]


# ---------------------------------------------------------------------------
# 3. PATCH /api/operations/{id} — validator → 200
# ---------------------------------------------------------------------------


class TestUpdateOperation:
    def test_update_operation_validator(self, client: TestClient):
        """PATCH /api/operations/{id} with validator returns 200."""
        mock_db, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.patch("/api/operations/1", json={"fire_status": "CONTAINED"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["fire_status"] == "ACTIVE"  # mock row default
        assert data["operation_id"] == 1
        assert "updated_at" in data

    def test_update_operation_not_found(self, client: TestClient):
        """PATCH /api/operations/{id} for missing op returns 404."""
        mock_db, get_db_override = _make_db(op_rows=[])
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.patch("/api/operations/999", json={"fire_status": "CONTAINED"})

        assert resp.status_code == 404

    def test_update_non_validator_forbidden(self, client: TestClient):
        """PATCH /api/operations/{id} by REGIONAL_ENCODER returns 403."""
        _, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[auth.get_current_wims_user] = _mock_encoder

        resp = client.patch("/api/operations/1", json={"fire_status": "CONTAINED"})

        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 4. DELETE /api/operations/{id} — validator → 204
# ---------------------------------------------------------------------------


class TestDeleteOperation:
    def test_delete_operation_validator(self, client: TestClient):
        """DELETE /api/operations/{id} with validator returns 204."""
        mock_db, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.delete("/api/operations/1")

        assert resp.status_code == 204
        # Verify a DELETE was executed for the correct operation_id
        calls_sql = [str(c[0][0]) for c in mock_db.execute.call_args_list]
        assert any("DELETE FROM wims.operations" in sql and ":oid" in sql for sql in calls_sql), (
            f"No DELETE FROM wims.operations found in: {calls_sql}"
        )

    def test_delete_operation_not_found(self, client: TestClient):
        """DELETE /api/operations/{id} for missing op returns 404."""
        mock_db, get_db_override = _make_db(op_rows=[])
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.delete("/api/operations/999")

        assert resp.status_code == 404

    def test_delete_non_validator_forbidden(self, client: TestClient):
        """DELETE /api/operations/{id} by REGIONAL_ENCODER returns 403."""
        _, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[auth.get_current_wims_user] = _mock_encoder

        resp = client.delete("/api/operations/1")

        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 5. POST /api/operations/{id}/link — validator → 201
# ---------------------------------------------------------------------------


class TestLinkReport:
    def test_link_report_validator(self, client: TestClient):
        """POST /api/operations/{id}/link with validator returns 201."""
        mock_db, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post("/api/operations/1/link", json={"report_id": 5})

        assert resp.status_code == 201

    def test_link_report_not_found(self, client: TestClient):
        """POST /api/operations/{id}/link for missing op returns 404."""
        mock_db, get_db_override = _make_db(op_rows=[])
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post("/api/operations/999/link", json={"report_id": 5})

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 6. DELETE /api/operations/{id}/link/{report_id} — validator only
# ---------------------------------------------------------------------------


class TestReportLinkStatusTransitions:
    def test_link_report_conflict_when_report_belongs_to_other_operation(self, client: TestClient):
        op = _op_row(operation_id=1)

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "SELECT * FROM wims.operations" in sql:
                result.fetchone.return_value = op
            elif "operation_citizen_reports" in sql and "WHERE report_id = :rid" in sql:
                result.fetchone.return_value = _CitizenReportStatusRow(report_id=5, linked_operation_id=2)
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            result.rowcount = 1
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post("/api/operations/1/link", json={"report_id": 5})

        assert resp.status_code == 409
        assert resp.json()["detail"] == "Report already linked to Operation #2"
        assert not any("INSERT INTO wims.operation_citizen_reports" in str(call.args[0]) for call in mock_db.execute.call_args_list)

    def test_link_report_same_operation_is_idempotent(self, client: TestClient):
        op = _op_row(operation_id=1)

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "SELECT * FROM wims.operations" in sql:
                result.fetchone.return_value = op
            elif "operation_citizen_reports" in sql and "WHERE report_id = :rid" in sql:
                result.fetchone.return_value = _CitizenReportStatusRow(report_id=5, linked_operation_id=1)
            elif "SELECT report_id FROM wims.operation_citizen_reports" in sql:
                linked = MagicMock()
                linked.report_id = 5
                result.fetchall.return_value = [linked]
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            result.rowcount = 1
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post("/api/operations/1/link", json={"report_id": 5})

        assert resp.status_code == 201
        assert not any("INSERT INTO wims.operation_citizen_reports" in str(call.args[0]) for call in mock_db.execute.call_args_list)

    @pytest.mark.parametrize(
        ("initial_status", "expected_status"),
        [("PENDING", "LINKED"), ("UNDER_REVIEW", "LINKED"), ("LINKED", "LINKED"), ("ACTIONED", "ACTIONED")],
    )
    def test_link_report_applies_expected_status_transition(self, client: TestClient, initial_status, expected_status):
        op = _op_row(operation_id=1)
        report = _CitizenReportStatusRow(report_id=5, status=initial_status, linked_operation_id=None)
        executed_updates: list[dict] = []

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "SELECT * FROM wims.operations" in sql:
                result.fetchone.return_value = op
            elif "operation_citizen_reports" in sql and "WHERE report_id = :rid" in sql:
                result.fetchone.return_value = None
            elif "SELECT report_id, status FROM wims.citizen_reports" in sql:
                result.fetchone.return_value = report
            elif "UPDATE wims.citizen_reports" in sql:
                executed_updates.append(params)
                result.rowcount = 1
            elif "SELECT report_id FROM wims.operation_citizen_reports" in sql:
                linked = MagicMock()
                linked.report_id = 5
                result.fetchall.return_value = [linked]
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            result.rowcount = getattr(result, "rowcount", 1)
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post("/api/operations/1/link", json={"report_id": 5})

        assert resp.status_code == 201
        if initial_status == "ACTIONED":
            assert executed_updates == []
        else:
            assert executed_updates[0]["status"] == expected_status

    @pytest.mark.parametrize(
        ("initial_status", "expected_updates"),
        [("LINKED", ["UNDER_REVIEW"]), ("ACTIONED", [])],
    )
    def test_unlink_report_applies_expected_status_transition(self, client: TestClient, initial_status, expected_updates):
        op = _op_row(operation_id=1)
        report = _CitizenReportStatusRow(report_id=5, status=initial_status, linked_operation_id=1)
        executed_updates: list[dict] = []

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "SELECT * FROM wims.operations" in sql:
                result.fetchone.return_value = op
            elif "SELECT report_id, status FROM wims.citizen_reports" in sql:
                result.fetchone.return_value = report
            elif "UPDATE wims.citizen_reports" in sql:
                executed_updates.append(params)
                result.rowcount = 1
            elif "SELECT report_id FROM wims.operation_citizen_reports" in sql:
                result.fetchall.return_value = []
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            result.rowcount = getattr(result, "rowcount", 1)
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.delete("/api/operations/1/link/5")

        assert resp.status_code == 200
        assert [params["status"] for params in executed_updates] == expected_updates


class TestUnlinkReport:
    def test_unlink_report_validator(self, client: TestClient):
        """DELETE /api/operations/{id}/link/{report_id} with validator returns 200."""
        mock_db, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.delete("/api/operations/1/link/5")

        assert resp.status_code == 200
        data = resp.json()
        assert data["operation_id"] == 1

    def test_unlink_report_not_found(self, client: TestClient):
        """DELETE /api/operations/{id}/link/{report_id} for missing op returns 404."""
        mock_db, get_db_override = _make_db(op_rows=[])
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.delete("/api/operations/999/link/5")

        assert resp.status_code == 404

    def test_unlink_non_validator_forbidden(self, client: TestClient):
        """DELETE /api/operations/{id}/link/{report_id} by REGIONAL_ENCODER returns 403."""
        _, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[auth.get_current_wims_user] = _mock_encoder

        resp = client.delete("/api/operations/1/link/5")

        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 7. Audit log written on create
# ---------------------------------------------------------------------------


class TestAuditLog:
    def test_audit_logged_on_create(self, client: TestClient):
        """After creating an operation, system_audit_trails receives an INSERT."""
        mock_db, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        client.post(
            "/api/operations",
            json={
                "fire_status": "ACTIVE",
                "start_time": "2026-06-10T08:00:00Z",
                "location": "Test City",
            },
        )

        # Verify that db.execute was called with an INSERT into system_audit_trails
        audit_inserts = [c for c in mock_db.captured_inserts if "system_audit_trails" in c["sql"]]
        assert len(audit_inserts) >= 1, (
            "Expected INSERT into system_audit_trails — captured calls:\n"
            + "\n".join(
                f"  {c['sql'][:100]} | params={c['params']}" for c in mock_db.captured_inserts
            )
        )
        # Verify action_type is OPERATION_CREATE
        audit_params = audit_inserts[0]["params"]
        assert audit_params is not None, "Audit INSERT params should not be None"
        assert audit_params.get("action") == "OPERATION_CREATE", (
            f"Expected action='OPERATION_CREATE', got {audit_params}"
        )


# ---------------------------------------------------------------------------
# 8. Map fields — latitude, longitude, radius_meters
# ---------------------------------------------------------------------------


class TestMapFields:
    def test_create_with_map_fields(self, client: TestClient):
        """POST with latitude/longitude/radius stores map fields."""
        mock_db, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post(
            "/api/operations",
            json={
                "fire_status": "ACTIVE",
                "start_time": "2026-06-10T08:00:00Z",
                "location": "Test",
                "latitude": 14.5995,
                "longitude": 120.9842,
                "radius_meters": 250.0,
            },
        )

        assert resp.status_code == 201
        # Verify INSERT params include map fields
        inserts = [c for c in mock_db.captured_inserts if "INSERT INTO" in c["sql"]]
        assert len(inserts) >= 1
        params = inserts[0]["params"]
        assert params["lat"] == 14.5995
        assert params["lng"] == 120.9842
        assert params["rad"] == 250.0

    def test_list_operations_returns_map_fields(self, client: TestClient):
        """GET /api/operations returns latitude/longitude/radius in response."""
        row = _op_row()
        row.latitude = 14.5995
        row.longitude = 120.9842
        row.radius_meters = 250.0
        mock_db, get_db_override = _make_db(op_rows=[row])
        app.dependency_overrides[get_db] = get_db_override
        app.dependency_overrides[get_incident_viewer] = lambda: _mock_encoder()

        resp = client.get("/api/operations")

        assert resp.status_code == 200
        data = resp.json()[0]
        assert data["latitude"] == 14.5995
        assert data["longitude"] == 120.9842
        assert data["radius_meters"] == 250.0

    def test_update_map_fields(self, client: TestClient):
        """PATCH updates latitude/longitude/radius on an operation."""
        mock_db, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.patch(
            "/api/operations/1",
            json={"latitude": 15.0, "longitude": 121.0, "radius_meters": 500.0},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert "operation_id" in data
