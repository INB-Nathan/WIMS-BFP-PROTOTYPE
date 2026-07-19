from unittest.mock import MagicMock

from services.information_emergencies import ensure_incident_emergency_draft


def _result(*, first=None, scalar_one=None):
    result = MagicMock()
    result.mappings.return_value.first.return_value = first
    result.scalar_one.return_value = scalar_one
    return result


def _source():
    return {
        "incident_id": 7,
        "region_name": "Region IV",
        "city_name": "City A",
        "barangay_name": "Barangay X",
        "general_description_of_involved": "Structural fire.",
        "geom": "POINT(120.9 14.6)",
    }


def test_creates_civilian_linked_verified_incident_draft():
    db = MagicMock()
    db.execute.side_effect = [_result(first=_source()), _result(first=None), _result(scalar_one=9)]

    draft_id = ensure_incident_emergency_draft(
        db,
        incident_id=7,
        actor_user_id="00000000-0000-0000-0000-000000000001",
        require_civilian_link=True,
    )

    assert draft_id == 9
    source_sql = db.execute.call_args_list[0].args[0].text
    assert "fi.verification_status = 'VERIFIED'" in source_sql
    assert "fire_incident_civilian_links" in source_sql
    assert db.execute.call_args_list[0].args[1]["require_civilian_link"] is True
    insert_sql = db.execute.call_args_list[2].args[0].text
    assert "ON CONFLICT (promoted_from_incident_id)" in insert_sql
    assert "WHERE promoted_from_incident_id IS NOT NULL AND published = FALSE" in insert_sql


def test_does_not_overwrite_a_published_emergency():
    db = MagicMock()
    db.execute.side_effect = [_result(first=_source()), _result(first={"id": 9, "published": True})]

    draft_id = ensure_incident_emergency_draft(
        db,
        incident_id=7,
        actor_user_id="00000000-0000-0000-0000-000000000001",
        require_civilian_link=True,
    )

    assert draft_id == 9
    assert db.execute.call_count == 2
