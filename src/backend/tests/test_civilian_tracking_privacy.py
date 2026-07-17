"""Public tracking response must not disclose sensitive contributor/report data."""

from datetime import datetime, timezone

from schemas.civilian import CivilianTrackingResponse, CivilianTrackingStatusUpdate


def test_tracking_response_excludes_coordinates_pii_internal_notes_and_chain_ids():
    response = CivilianTrackingResponse(
        report_id=7,
        category="STRUCTURAL",
        status="PENDING",
        created_at=datetime.now(timezone.utc),
    )

    fields = response.model_dump()
    # No PII or location
    assert (
        not {"latitude", "longitude", "witness_name", "witness_phone", "trust_score"}
        & fields.keys()
    )
    # No internal notes
    assert not {"reporting_context", "status_explanation", "related_cluster_status"} & fields.keys()
    # No chain IDs
    assert "link_count" not in fields
    assert "previous_report_id" not in fields


def test_tracking_status_update_excludes_actor_identity():
    update = CivilianTrackingStatusUpdate(
        stage="HELP_DISPATCHED",
        metadata={"station_name": "BFP Central"},
        created_at=datetime.now(timezone.utc),
    )

    assert "actor_user_id" not in update.model_dump()
