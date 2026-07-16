"""
TDD: triage queue projection jurisdiction extension (Wayfinder #633).

Verifies that the civilian triage queue projection now surfaces, per report:
- province_name  (derived via nearest station -> region -> province)
- station phone  (StationContext.phone from ref_fire_stations.phone)

This is a READ-ONLY projection extension; no schema/migration changes.
municipality_name is intentionally NOT exposed (no data source exists).

The DB is mocked: get_queue performs several db.execute() calls (cluster
materialization INSERTs via CTE, plus the final queue SELECT). We return
 benign rows for the write CTEs and our crafted rows for the final SELECT so
the projection row-mapping (including the new province/phone columns) is
exercised without a live Postgres.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock

from services.civilian_triage.models import StationContext, TriageReportEntry
from services.civilian_triage.queue_projection import get_queue


def _make_row(
    report_id=1,
    station_name="Manila City Fire Station",
    distance_m=123.4,
    phone="0281234567",
    province_name="Metro Manila",
):
    """Build a DB row tuple aligned to the final SELECT column order in
    queue_projection.get_queue.

    Order (see index comments in queue_projection.py):
     0 report_id
     1 lat
     2 lon
     3 category
     4 sub_category
     5 reporting_context
     6 safety_status
     7 status
     8 status_explanation
     9 description
    10 linked_to_report_id
    11 trust_score
    12 gps_distance_m
    13 link_count
    14 created_at
    15 reported_at
    16 previous_report_id
    17 has_category
    18 has_sub_category
    19 has_reported_at
    20 has_device_id
    21 has_witness_name
    22 has_witness_phone
    23 nearest_500m
    24 nearest_2km
    25 nearest_5km
    26 cluster_id
    27 cluster_status
    28 assigned_to
    29 review_started_at
    30 anchor_report_id
    31 related_count
    32 station_name
    33 distance_m
    34 phone
    35 province_name
    36 dup_count_30m
    37 followup_count
    38 followups_json
    """
    now = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    return (
        report_id,
        14.5868,  # lat
        120.9838,  # lon
        "FIRE",  # category
        "STRUCTURE",  # sub_category
        "WITNESS",  # reporting_context
        "I_NEED_HELP",  # safety_status
        "PENDING",  # status
        None,  # status_explanation
        "Smoke seen",  # description
        None,  # linked_to_report_id
        80,  # trust_score
        None,  # gps_distance_m
        0,  # link_count
        now,  # created_at
        now,  # reported_at
        None,  # previous_report_id
        True,  # has_category
        True,  # has_sub_category
        True,  # has_reported_at
        True,  # has_device_id
        False,  # has_witness_name
        False,  # has_witness_phone
        False,  # nearest_500m
        False,  # nearest_2km
        False,  # nearest_5km
        None,  # cluster_id
        None,  # cluster_status
        None,  # assigned_to
        None,  # review_started_at
        None,  # anchor_report_id
        0,  # related_count
        station_name,  # station_name
        distance_m,  # distance_m
        phone,  # phone
        province_name,  # province_name
        0,  # dup_count_30m
        0,  # followup_count
        None,  # followups_json
    )


def _mock_db(rows):
    """Return a mock Session that returns `rows` for the final SELECT and
    benign results for the materialization CTE writes / _table_exists."""
    select_result = MagicMock()
    select_result.fetchall.return_value = rows

    exists_result = MagicMock()
    exists_result.fetchone.return_value = None  # _table_exists => table absent

    mock_db = MagicMock()

    # db.execute returns different mocks depending on whether the statement is
    # a write (CTE INSERT) or the final SELECT. The final SELECT contains the
    # literal string "FROM wims.citizen_reports cr" plus the station_info CTE
    # with province_name. We detect the SELECT by the presence of "SELECT" near
    # the start and the queue-specific columns.
    def _execute(statement, *args, **kwargs):
        sql = str(statement)
        if "station_info" in sql and "province_name" in sql and "SELECT" in sql:
            return select_result
        if "information_schema.tables" in sql:
            return exists_result
        # Write CTEs (INSERT ... ) and set_rls_context: return a no-op result.
        write_result = MagicMock()
        write_result.fetchall.return_value = []
        return write_result

    mock_db.execute.side_effect = _execute
    return mock_db


def _first_entry(rows):
    user = {
        "user_id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "role": "REGIONAL_ENCODER",
    }
    mock_db = _mock_db(rows)
    # get_queue's quick-filter params default to FastAPI Query(...) objects; when
    # invoked directly (outside the route) we must pass explicit bools so the
    # Query defaults (FieldInfo) are not treated as truthy filters.
    resp = get_queue(
        user,
        mock_db,
        needs_help=False,
        someone_else_needs_help=False,
        aging=False,
        timeout_risk=False,
        danger=False,
        confidence=None,
        unreviewed=False,
        claimed_by_me=False,
        actioned_today=False,
        rejected_today=False,
        source=None,
    )
    assert resp.total_reports == len(rows), resp.total_reports
    return resp.clusters[0].reports[0]


def test_province_name_and_station_phone_populated():
    entry = _first_entry([_make_row()])
    assert isinstance(entry, TriageReportEntry)
    assert entry.province_name == "Metro Manila"
    assert isinstance(entry.station, StationContext)
    assert entry.station.phone == "0281234567"
    # Backward-compat bool derived from phone presence:
    assert entry.station.phone_available is True
    assert entry.station.name == "Manila City Fire Station"
    assert entry.station.distance_m == 123.4


def test_null_station_yields_null_province_and_phone():
    entry = _first_entry(
        [_make_row(station_name=None, distance_m=None, phone=None, province_name=None)]
    )
    assert entry.province_name is None
    assert entry.station.phone is None
    assert entry.station.phone_available is False


def test_no_municipality_field_exists():
    # Contract guard: municipality_name must not be a field on the entry model.
    assert "municipality_name" not in TriageReportEntry.model_fields
    assert "municipality_name" not in StationContext.model_fields
