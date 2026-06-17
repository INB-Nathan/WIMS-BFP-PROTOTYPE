from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi import HTTPException

from services.civilian_triage import queue_projection
from services.civilian_triage.models import TriageQueueResponse
from services.civilian_triage.policies import (
    aging_flags,
    is_cluster_claim_stale,
    role_can_access_queue,
    role_can_correct_terminal,
    role_can_work_cluster,
    severity,
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
        "commit",
        ("set_rls_context", user_id, True),
        ("main_select", True, True),
    ]
