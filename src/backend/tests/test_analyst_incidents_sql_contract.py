import inspect

from api.routes.incidents import (
    _append_analyst_casualty_filter,
    get_analyst_incident_detail,
    get_analyst_incident_list,
)


def test_analyst_list_query_uses_current_location_columns():
    source = inspect.getsource(get_analyst_incident_list)

    assert "barangay_name" not in source
    assert "ref_barangays" not in source
    assert "aif.province_name" in source
    assert "aif.municipality_name" in source
    assert "r.short_name" not in source
    assert "r.region_code" in source


def test_analyst_list_derives_casualty_severity_from_counts():
    source = inspect.getsource(get_analyst_incident_list)
    helper_source = inspect.getsource(_append_analyst_casualty_filter)

    assert "aif.casualty_severity" not in source
    assert "civilian_deaths" in helper_source
    assert "firefighter_injured" in helper_source


def test_analyst_list_supports_selected_incident_ids_filter():
    source = inspect.getsource(get_analyst_incident_list)

    assert "incident_ids" in source
    assert "fi.incident_id = ANY(:incident_ids)" in source
    assert "comma-separated integers" in source


def test_analyst_detail_uses_provenance_columns_from_real_tables():
    source = inspect.getsource(get_analyst_incident_detail)

    assert "aif.data_hash" not in source
    assert "aif.sync_status" not in source
    assert "r.short_name" not in source
    assert "r.region_code" in source
    assert "fi.data_hash" in source
    assert "CASE WHEN aif.incident_id IS NULL" in source
