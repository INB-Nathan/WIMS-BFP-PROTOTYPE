import pytest
from fastapi import HTTPException

from services.analytics.filters import append_common_filters, build_analytics_filters


def test_analytics_filters_region_ids_take_precedence_over_region_id():
    filters = build_analytics_filters(region_id=9, region_ids="1,2,3")
    clauses: list[str] = []
    params: dict[str, object] = {}

    append_common_filters(clauses, params, filters)

    assert "a.region_id = ANY(:region_ids)" in clauses
    assert "a.region_id = :region_id" not in clauses
    assert params["region_ids"] == [1, 2, 3]
    assert "region_id" not in params


def test_analytics_filters_reject_invalid_damage_range_consistently():
    with pytest.raises(HTTPException) as exc:
        build_analytics_filters(damage_min=100.0, damage_max=99.0)

    assert exc.value.status_code == 422
    assert "damage_max" in exc.value.detail


def test_analytics_filters_compile_casualty_damage_and_selected_ids():
    filters = build_analytics_filters(
        casualty_severity="medium",
        damage_min=10.0,
        damage_max=20.0,
        selected_incident_ids=[5, 5, 2],
    )
    clauses: list[str] = []
    params: dict[str, object] = {}

    append_common_filters(
        clauses,
        params,
        filters,
        table_alias="fi",
        damage_expression="COALESCE(aif.estimated_damage_php, nd.estimated_damage_php, 0)",
    )

    compiled = " AND ".join(clauses)
    assert "(fi.civilian_injured + fi.firefighter_injured) > 0" in compiled
    assert "COALESCE(aif.estimated_damage_php, nd.estimated_damage_php, 0) >= :damage_min" in clauses
    assert "fi.incident_id = ANY(:selected_incident_ids)" in clauses
    assert params["selected_incident_ids"] == [2, 5]
