from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import UUID

from services.regional_incidents.lifecycle import (
    RegionalIncidentLifecycleDependencies,
    verify_incident_command,
)


@patch("services.regional_incidents.lifecycle.log_system_audit")
@patch("services.regional_incidents.lifecycle.sync_incident_to_analytics")
@patch("services.regional_incidents.lifecycle.compute_incident_data_hash", return_value="hash")
@patch("services.regional_incidents.lifecycle.ensure_incident_emergency_draft")
def test_verified_incident_attempts_civilian_draft_creation(
    mock_draft, mock_hash, mock_sync, mock_audit
):
    db = MagicMock()
    db.execute.side_effect = [
        MagicMock(
            fetchone=lambda: (
                7,
                "PENDING",
                13,
                UUID("00000000-0000-0000-0000-000000000001"),
                "keycloak-id",
                datetime(2026, 1, 1),
            )
        ),
        MagicMock(fetchone=lambda: ("APT", None, None)),
        MagicMock(fetchone=lambda: (datetime(2026, 1, 1),)),
        MagicMock(),
    ]
    deps = RegionalIncidentLifecycleDependencies(
        insert_incident_verification_history=MagicMock(),
        generate_reference_number=lambda *_args: "NCR-APT-001",
    )

    result = verify_incident_command(
        db,
        incident_id=7,
        action_body=SimpleNamespace(action="accept", notes="verified", original_incident_id=None),
        validator_user_id="00000000-0000-0000-0000-000000000002",
        request=MagicMock(),
        force=True,
        deps=deps,
    )

    assert result["new_status"] == "VERIFIED"
    mock_draft.assert_called_once_with(
        db,
        incident_id=7,
        actor_user_id="00000000-0000-0000-0000-000000000002",
        require_civilian_link=True,
    )
