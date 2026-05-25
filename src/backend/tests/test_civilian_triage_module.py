from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

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
