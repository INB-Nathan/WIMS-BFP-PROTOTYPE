from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi import HTTPException

from services.civilian_triage import queue_projection, workflow
from services.civilian_triage.models import CorrectionRequest, TriageQueueResponse
from services.civilian_triage.policies import (
    TERMINAL_REPORT_STATUSES,
    aging_flags,
    is_cluster_claim_stale,
    role_can_access_queue,
    role_can_correct_terminal,
    role_can_work_cluster,
    severity,
    validate_singleton_terminal_status,
    validate_terminal_status,
)


def test_civilian_triage_policy_roles_and_terminal_statuses():
    assert role_can_access_queue("REGIONAL_ENCODER")
    assert role_can_access_queue("NATIONAL_VALIDATOR")
    assert not role_can_access_queue("SYSTEM_ADMIN")

    assert role_can_work_cluster("SYSTEM_ADMIN")
    assert role_can_correct_terminal("NATIONAL_VALIDATOR")
    assert validate_terminal_status("actioned") == "ACTIONED"

    with pytest.raises(HTTPException):
        validate_terminal_status("PENDING")


def test_civilian_triage_policy_thresholds():
    now = datetime.now(timezone.utc)

    assert is_cluster_claim_stale(now - timedelta(minutes=15))
    assert not is_cluster_claim_stale(now - timedelta(minutes=14, seconds=59))

    assert aging_flags(now - timedelta(minutes=61), now) == (True, False, False)
    assert aging_flags(now - timedelta(minutes=91), now) == (True, True, False)
    assert aging_flags(now - timedelta(minutes=121), now) == (True, True, True)

    assert severity(related_count=4, trust_score=50) == "HIGH"
    assert severity(related_count=1, trust_score=30) == "MEDIUM"
    assert severity(related_count=0, trust_score=100) == "LOW"


def test_triage_queue_contract_excludes_privacy_fields_from_schema():
    schema = TriageQueueResponse.model_json_schema()
    serialized = repr(schema)

    assert "device_id" not in serialized
    assert "ip_hash" not in serialized
    assert "fcm" not in serialized.lower()
    assert "notification_token" not in serialized
    assert "duplicate_device_count_30m" in serialized


def test_get_queue_reestablishes_rls_context_after_materialization_commit(monkeypatch):
    """SET LOCAL RLS context is cleared by commit and must be restored before SELECT."""

    user_id = UUID("22222222-2222-4222-8222-222222222222")
    events: list[object] = []

    class EmptyRows:
        def fetchall(self):
            return []

    class FakeDb:
        committed = False
        rls_reset_after_commit = False

        def execute(self, statement, params=None):
            sql = str(statement)
            if "INSERT INTO wims.citizen_report_cluster_members" in sql:
                events.append("materialize")
                return EmptyRows()
            if "WITH latest_clusters AS" in sql:
                events.append(
                    (
                        "main_select",
                        self.committed,
                        self.rls_reset_after_commit,
                    )
                )
                return EmptyRows()
            raise AssertionError(f"Unexpected SQL in fake queue test: {sql[:120]}")

        def commit(self):
            self.committed = True
            events.append("commit")

    def fake_set_rls_context(db, restored_user_id):
        events.append(("set_rls_context", restored_user_id, db.committed))
        db.rls_reset_after_commit = True

    monkeypatch.setattr(queue_projection, "_table_exists", lambda _db, _schema, _table: False)
    monkeypatch.setattr(queue_projection, "set_rls_context", fake_set_rls_context)

    queue_projection.get_queue(
        {"user_id": user_id, "role": "NATIONAL_VALIDATOR"},
        FakeDb(),
        needs_help=False,
        someone_else_needs_help=False,
        aging=False,
        timeout_risk=False,
        confidence=None,
        unreviewed=False,
        claimed_by_me=False,
        actioned_today=False,
        rejected_today=False,
    )

    assert events == [
        "materialize",
        "materialize",
        "commit",
        ("set_rls_context", user_id, True),
        ("main_select", True, True),
    ]


# ---------------------------------------------------------------------------
# B1: singleton policy enforcement on correction path
# ---------------------------------------------------------------------------


def test_singleton_triage_blocks_actioned_correction_on_singleton_cluster(monkeypatch):
    """B1 fix: correcting a singleton-cluster report to ACTIONED must fail."""

    user = {"user_id": "val-1", "role": "NATIONAL_VALIDATOR"}
    body = CorrectionRequest(
        status="ACTIONED",
        status_explanation="corrected to actioned",
        correction_reason="mistake",
    )

    events: list[str] = []

    class FakeRow:
        status = "REJECTED_BOGUS"  # valid terminal status
        internal_note = None

    class FakeMemberRow:
        def __init__(self, report_id):
            self.report_id = report_id

    class FakeDb:
        def execute(self, statement, params=None):
            sql = str(statement)
            if "SELECT status, internal_note FROM wims.citizen_reports" in sql:
                events.append("fetch_report")

                class Result:
                    def fetchone(self):
                        return FakeRow()

                return Result()
            if "SELECT cluster_id FROM wims.citizen_report_cluster_members" in sql:
                events.append("lookup_cluster")

                class Result:
                    def fetchone(self):
                        return type("obj", (), {"cluster_id": 42})()

                return Result()
            if (
                "SELECT report_id FROM wims.citizen_report_cluster_members" in sql
                and "FOR UPDATE" in sql
            ):
                events.append("count_members_locked")

                class Result:
                    def fetchall(self):
                        return [FakeMemberRow(99)]  # 1 member → singleton

                return Result()
            if "UPDATE wims.citizen_reports" in sql:
                events.append("update_report")
                return type("obj", (), {"rowcount": 1})()
            if "INSERT INTO wims.system_audit_trails" in sql:
                return type("obj", (), {})()
            raise AssertionError(f"Unexpected SQL: {sql[:120]}")

        def commit(self):
            events.append("commit")

        def rollback(self):
            events.append("rollback")

    monkeypatch.setattr(workflow, "append_internal_note", lambda *a: "note")
    monkeypatch.setattr(workflow, "enqueue_status_notification", lambda *a: None)

    with pytest.raises(HTTPException) as exc_info:
        workflow.correct_terminal_report_command(
            report_id=99,
            body=body,
            request=None,  # type: ignore[arg-type]
            user=user,
            db=FakeDb(),
        )

    assert exc_info.value.status_code == 422
    assert "ACTIONED requires a cluster" in exc_info.value.detail
    # Must have looked up cluster and counted members, then rolled back.
    assert events == ["fetch_report", "lookup_cluster", "count_members_locked", "rollback"]


def test_singleton_triage_allows_rejected_correction_on_singleton_cluster(monkeypatch):
    """B1 fix: correcting a singleton-cluster report to REJECTED_DUPLICATE must succeed."""

    user = {"user_id": "val-1", "role": "NATIONAL_VALIDATOR"}
    body = CorrectionRequest(
        status="REJECTED_DUPLICATE",
        status_explanation="still a duplicate",
        correction_reason="typo in reason",
    )

    events: list[str] = []

    class FakeRow:
        status = "REJECTED_BOGUS"
        internal_note = None

    class FakeMemberRow:
        def __init__(self, report_id):
            self.report_id = report_id

    class FakeDb:
        def execute(self, statement, params=None):
            sql = str(statement)
            if "SELECT status, internal_note FROM wims.citizen_reports" in sql:
                events.append("fetch_report")

                class Result:
                    def fetchone(self):
                        return FakeRow()

                return Result()
            if "SELECT cluster_id FROM wims.citizen_report_cluster_members" in sql:
                events.append("lookup_cluster")

                class Result:
                    def fetchone(self):
                        return type("obj", (), {"cluster_id": 42})()

                return Result()
            if (
                "SELECT report_id FROM wims.citizen_report_cluster_members" in sql
                and "FOR UPDATE" in sql
            ):
                events.append("count_members_locked")

                class Result:
                    def fetchall(self):
                        return [FakeMemberRow(99)]  # 1 member — singleton, but REJECTED is OK

                return Result()
            if "UPDATE wims.citizen_reports" in sql:
                events.append("update_report")
                return type("obj", (), {"rowcount": 1})()
            if "INSERT INTO wims.system_audit_trails" in sql:
                return type("obj", (), {})()
            raise AssertionError(f"Unexpected SQL: {sql[:120]}")

        def commit(self):
            events.append("commit")

        def rollback(self):
            events.append("rollback")

    monkeypatch.setattr(workflow, "append_internal_note", lambda *a: "note")
    monkeypatch.setattr(workflow, "enqueue_status_notification", lambda *a: None)

    result = workflow.correct_terminal_report_command(
        report_id=99,
        body=body,
        request=None,  # type: ignore[arg-type]
        user=user,
        db=FakeDb(),
    )

    assert result.status == "corrected"
    assert events == [
        "fetch_report",
        "lookup_cluster",
        "count_members_locked",
        "update_report",
        "commit",
    ]


def test_singleton_triage_allows_actioned_correction_on_multi_member_cluster(monkeypatch):
    """B1 fix: correcting a multi-member cluster report to ACTIONED must succeed."""

    user = {"user_id": "val-1", "role": "NATIONAL_VALIDATOR"}
    body = CorrectionRequest(
        status="ACTIONED",
        status_explanation="now corroborated",
        correction_reason="new evidence",
    )

    events: list[str] = []

    class FakeRow:
        status = "REJECTED_BOGUS"
        internal_note = None

    class FakeMemberRow:
        def __init__(self, report_id):
            self.report_id = report_id

    class FakeDb:
        def execute(self, statement, params=None):
            sql = str(statement)
            if "SELECT status, internal_note FROM wims.citizen_reports" in sql:
                events.append("fetch_report")

                class Result:
                    def fetchone(self):
                        return FakeRow()

                return Result()
            if "SELECT cluster_id FROM wims.citizen_report_cluster_members" in sql:
                events.append("lookup_cluster")

                class Result:
                    def fetchone(self):
                        return type("obj", (), {"cluster_id": 42})()

                return Result()
            if (
                "SELECT report_id FROM wims.citizen_report_cluster_members" in sql
                and "FOR UPDATE" in sql
            ):
                events.append("count_members_locked")

                class Result:
                    def fetchall(self):
                        return [FakeMemberRow(99), FakeMemberRow(100)]  # 2 members

                return Result()
            if "UPDATE wims.citizen_reports" in sql:
                events.append("update_report")
                return type("obj", (), {"rowcount": 1})()
            if "INSERT INTO wims.system_audit_trails" in sql:
                return type("obj", (), {})()
            raise AssertionError(f"Unexpected SQL: {sql[:120]}")

        def commit(self):
            events.append("commit")

        def rollback(self):
            events.append("rollback")

    monkeypatch.setattr(workflow, "append_internal_note", lambda *a: "note")
    monkeypatch.setattr(workflow, "enqueue_status_notification", lambda *a: None)

    result = workflow.correct_terminal_report_command(
        report_id=99,
        body=body,
        request=None,  # type: ignore[arg-type]
        user=user,
        db=FakeDb(),
    )

    assert result.status == "corrected"
    assert events == [
        "fetch_report",
        "lookup_cluster",
        "count_members_locked",
        "update_report",
        "commit",
    ]


def test_correction_path_no_cluster_skips_singleton_check(monkeypatch):
    """B1 fix: report with no cluster membership skips singleton check."""

    user = {"user_id": "val-1", "role": "NATIONAL_VALIDATOR"}
    body = CorrectionRequest(
        status="ACTIONED",
        status_explanation="corrected",
        correction_reason="evidence",
    )

    events: list[str] = []

    class FakeRow:
        status = "REJECTED_BOGUS"
        internal_note = None

    class FakeDb:
        def execute(self, statement, params=None):
            sql = str(statement)
            if "SELECT status, internal_note FROM wims.citizen_reports" in sql:
                events.append("fetch_report")

                class Result:
                    def fetchone(self):
                        return FakeRow()

                return Result()
            if "SELECT cluster_id FROM wims.citizen_report_cluster_members" in sql:
                events.append("lookup_cluster")

                class Result:
                    def fetchone(self):
                        return None  # report has no cluster

                return Result()
            if "UPDATE wims.citizen_reports" in sql:
                events.append("update_report")
                return type("obj", (), {"rowcount": 1})()
            if "INSERT INTO wims.system_audit_trails" in sql:
                return type("obj", (), {})()
            raise AssertionError(f"Unexpected SQL: {sql[:120]}")

        def commit(self):
            events.append("commit")

        def rollback(self):
            events.append("rollback")

    monkeypatch.setattr(workflow, "append_internal_note", lambda *a: "note")
    monkeypatch.setattr(workflow, "enqueue_status_notification", lambda *a: None)

    result = workflow.correct_terminal_report_command(
        report_id=99,
        body=body,
        request=None,  # type: ignore[arg-type]
        user=user,
        db=FakeDb(),
    )

    assert result.status == "corrected"
    # Should skip the member-count query entirely.
    assert events == ["fetch_report", "lookup_cluster", "update_report", "commit"]


# ---------------------------------------------------------------------------
# B5: TOCTOU-robust member count via SELECT … FOR UPDATE
# ---------------------------------------------------------------------------


def test_apply_terminal_status_uses_for_update_lock_for_member_count(monkeypatch):
    """B5 fix: member count query must use FOR UPDATE to prevent TOCTOU.

    The old code used SELECT COUNT(*) without locking, allowing a concurrent
    merge to add a member between the count check and the UPDATE. The fix
    uses SELECT report_id … FOR UPDATE + len(fetchall()).
    """

    user = {"user_id": "val-1", "role": "NATIONAL_VALIDATOR"}
    body = type(
        "obj",
        (),
        {
            "status": "ACTIONED",
            "status_explanation": "done",
            "report_ids": [1, 2],
            "internal_note": "",
        },
    )()

    events: list[str] = []

    # Simulate ensure_cluster_claim return: (cluster_id, status, assigned_to, ...)
    fake_cluster = (42, "CLUSTER_ACTIVE", "val-1", None, datetime.now(timezone.utc), None, "val")

    class FakeMemberRow:
        def __init__(self, report_id):
            self.report_id = report_id

    class FakeDb:
        def execute(self, statement, params=None):
            sql = str(statement)
            if "SELECT c.cluster_id, c.status, c.assigned_to" in sql and "FOR UPDATE OF c" in sql:
                events.append("fetch_cluster_for_update")

                class Result:
                    def fetchone(self):
                        return fake_cluster

                return Result()
            if (
                "SELECT report_id FROM wims.citizen_report_cluster_members" in sql
                and "FOR UPDATE" in sql
            ):
                events.append("count_members_for_update")

                class Result:
                    def fetchall(self):
                        return [FakeMemberRow(1), FakeMemberRow(2)]

                return Result()
            if "SELECT cr.report_id, cr.status" in sql and "FOR UPDATE OF cr" in sql:
                events.append("fetch_members_for_action")

                class Result:
                    def fetchall(self):
                        return [
                            type("obj", (), {"report_id": 1, "status": "PENDING"})(),
                            type("obj", (), {"report_id": 2, "status": "PENDING"})(),
                        ]

                return Result()
            if "UPDATE wims.citizen_reports" in sql and "RETURNING report_id" in sql:
                events.append("update_reports")

                class Result:
                    def fetchall(self):
                        return [
                            type("obj", (), {"report_id": 1})(),
                            type("obj", (), {"report_id": 2})(),
                        ]

                return Result()
            if "UPDATE wims.citizen_report_clusters" in sql:
                events.append("update_cluster")
                return type("obj", (), {"rowcount": 1})()
            if "INSERT INTO wims.system_audit_trails" in sql:
                return type("obj", (), {})()
            raise AssertionError(f"Unexpected SQL: {sql[:120]}")

        def commit(self):
            events.append("commit")

        def rollback(self):
            events.append("rollback")

    monkeypatch.setattr(workflow, "notify_reports", lambda *a: None)
    monkeypatch.setattr(workflow, "publish_verification_event_sync", lambda *a, **kw: None)

    result = workflow.apply_terminal_action_command(
        cluster_id=42,
        body=body,
        request=None,  # type: ignore[arg-type]
        user=user,
        db=FakeDb(),
    )

    assert result.status == "applied"
    # Must include the FOR UPDATE member count, not the old COUNT(*) query.
    assert "count_members_for_update" in events
    assert events == [
        "fetch_cluster_for_update",
        "count_members_for_update",
        "fetch_members_for_action",
        "update_reports",
        "update_cluster",
        "commit",
    ]


def test_validate_singleton_terminal_status_blocks_actioned_for_singleton():
    """validate_singleton_terminal_status rejects ACTIONED when member_count <= 1."""
    with pytest.raises(HTTPException) as exc_info:
        validate_singleton_terminal_status("ACTIONED", 1)
    assert exc_info.value.status_code == 422
    assert "ACTIONED requires a cluster" in exc_info.value.detail


def test_validate_singleton_terminal_status_blocks_actioned_for_zero():
    """validate_singleton_terminal_status rejects ACTIONED when member_count == 0."""
    with pytest.raises(HTTPException) as exc_info:
        validate_singleton_terminal_status("ACTIONED", 0)
    assert exc_info.value.status_code == 422


def test_validate_singleton_terminal_status_allows_actioned_for_multi():
    """validate_singleton_terminal_status permits ACTIONED when member_count > 1."""
    result = validate_singleton_terminal_status("ACTIONED", 2)
    assert result == "ACTIONED"


def test_validate_singleton_terminal_status_allows_rejected_for_singleton():
    """validate_singleton_terminal_status permits REJECTED_* for any count."""
    for status in TERMINAL_REPORT_STATUSES:
        if status == "ACTIONED":
            continue
        result = validate_singleton_terminal_status(status, 1)
        assert result == status
        result = validate_singleton_terminal_status(status, 0)
        assert result == status
