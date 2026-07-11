"""Public tracking response must not disclose sensitive contributor/report data."""

from datetime import datetime, timezone

from schemas.civilian import CivilianTrackingResponse


def test_tracking_response_excludes_coordinates_pii_and_trust_score():
    response = CivilianTrackingResponse(
        report_id=7,
        category="STRUCTURAL",
        status="PENDING",
        created_at=datetime.now(timezone.utc),
    )

    fields = response.model_dump()
    assert "trust_score" not in fields
    assert not {"latitude", "longitude", "witness_name", "witness_phone"} & fields.keys()
    assert not {"badge", "contributor_id", "contributor_username", "score_history"} & fields.keys()
