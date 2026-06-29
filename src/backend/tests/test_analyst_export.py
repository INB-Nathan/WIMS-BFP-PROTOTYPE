from __future__ import annotations

import csv
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from api.routes.incidents import AnalystIncidentExportRequest, export_analyst_incidents
from auth import get_analyst_or_admin
from tasks.exports import (
    ALLOWED_EXPORT_COLUMNS,
    DEFAULT_EXPORT_COLUMNS,
    _valid_columns,
    export_analyst_incidents_task,
)


def test_export_columns_allowlist_filtering():
    columns = ["incident_id", "bad_sql", "notification_dt", "__proto__"]

    assert _valid_columns(columns) == ["incident_id", "notification_dt"]
    assert set(_valid_columns(["bad_sql"])).issubset(ALLOWED_EXPORT_COLUMNS)


def test_region_name_in_allowed_columns():
    # #112: region_name must survive _valid_columns so it reaches get_export_rows.
    assert "region_name" in ALLOWED_EXPORT_COLUMNS
    assert _valid_columns(["region_name"]) == ["region_name"]
    assert _valid_columns(["region_name", "incident_id"]) == ["region_name", "incident_id"]


def test_default_export_columns_match_curated_list():
    # #113: pin the contract between the backend default and the frontend
    # DEFAULT_SELECTED_COLUMNS so the two layers stay in sync.
    assert DEFAULT_EXPORT_COLUMNS == [
        "incident_id",
        "notification_dt",
        "region_name",
        "province_name",
        "municipality_name",
        "general_category",
        "alarm_level",
        "estimated_damage_php",
        "total_response_time_minutes",
    ]
    assert "region_id" not in DEFAULT_EXPORT_COLUMNS
    assert "barangay_name" not in DEFAULT_EXPORT_COLUMNS


def test_get_export_rows_joins_ref_regions_and_returns_region_name():
    """
    #112 regression: requesting region_name must
      1. Inject LEFT JOIN wims.ref_regions in the SQL,
      2. SELECT rr.region_code aliased as region_name (so the row-dict key
         matches what the picker requested and writers don't need a mapping),
      3. Surface region_name in the returned row dicts with the joined value
         (e.g. 'NCR').
    """
    from services.analytics_read_model import get_export_rows

    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [(1, "NCR")]
    mock_db.execute.return_value = mock_result

    rows = get_export_rows(mock_db, {}, ["incident_id", "region_name"])

    assert rows == [{"incident_id": 1, "region_name": "NCR"}]

    executed_sql = str(mock_db.execute.call_args.args[0])
    assert "LEFT JOIN wims.ref_regions rr ON rr.region_id = a.region_id" in executed_sql
    assert "rr.region_code AS region_name" in executed_sql


def test_get_export_rows_omits_region_join_when_region_name_not_requested():
    """
    Negative case for #112: queries that don't ask for region_name must NOT
    inject the ref_regions JOIN — keeps the common path cheap.
    """
    from services.analytics_read_model import get_export_rows

    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [(1,)]
    mock_db.execute.return_value = mock_result

    get_export_rows(mock_db, {}, ["incident_id"])

    executed_sql = str(mock_db.execute.call_args.args[0])
    assert "ref_regions" not in executed_sql


def test_export_task_dispatched_returns_task_id():
    mock_task = MagicMock()
    mock_task.delay.return_value = MagicMock(id="task-analyst-1")

    with patch("api.routes.incidents.export_analyst_incidents_task", mock_task):
        response = export_analyst_incidents(
            "csv",
            AnalystIncidentExportRequest(filters={}, columns=["incident_id"]),
            {"user_id": "00000000-0000-0000-0000-000000000001", "role": "NATIONAL_ANALYST"},
        )

    assert response == {"task_id": "task-analyst-1"}


def test_export_incident_ids_passed_to_task():
    mock_task = MagicMock()
    mock_task.delay.return_value = MagicMock(id="task-analyst-ids")

    with patch("api.routes.incidents.export_analyst_incidents_task", mock_task):
        response = export_analyst_incidents(
            "pdf",
            AnalystIncidentExportRequest(
                filters={"region_id": 1},
                columns=["incident_id"],
                incident_ids=[30, 10, 20, 10],
            ),
            {"user_id": "00000000-0000-0000-0000-000000000001", "role": "NATIONAL_ANALYST"},
        )

    assert response == {"task_id": "task-analyst-ids"}
    assert mock_task.delay.call_args.kwargs["incident_ids"] == [10, 20, 30]
    assert mock_task.delay.call_args.kwargs["format"] == "pdf"


@pytest.mark.anyio
async def test_export_unauthorized_role_rejected():
    with pytest.raises(Exception) as exc:
        await get_analyst_or_admin({"user_id": str(uuid.uuid4()), "role": "REGIONAL_VIEWER"})
    assert getattr(exc.value, "status_code", None) == 403


def test_export_csv_with_filters_returns_200():
    mock_task = MagicMock()
    mock_task.delay.return_value = MagicMock(id="task-filtered-csv")

    with patch("api.routes.incidents.export_analyst_incidents_task", mock_task):
        response = export_analyst_incidents(
            "csv",
            AnalystIncidentExportRequest(
                filters={"start_date": "2024-01-01", "end_date": "2024-12-31"},
                columns=["incident_id", "notification_dt"],
            ),
            {"user_id": "00000000-0000-0000-0000-000000000001", "role": "NATIONAL_ANALYST"},
        )

    assert response == {"task_id": "task-filtered-csv"}


def test_export_with_specific_incident_ids(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    rows = [
        {"incident_id": 1, "notification_dt": "2024-01-01T00:00:00Z"},
        {"incident_id": 3, "notification_dt": "2024-01-03T00:00:00Z"},
    ]
    mock_db = MagicMock()

    monkeypatch.setattr("tasks.exports.EXPORT_DIR", str(tmp_path))
    monkeypatch.setattr("tasks.exports.get_session", lambda: mock_db)
    monkeypatch.setattr("tasks.exports.set_rls_context", MagicMock())
    monkeypatch.setattr("tasks.exports.get_analyst_export_rows", MagicMock(return_value=rows))

    path = export_analyst_incidents_task.run(
        user_id=str(uuid.uuid4()),
        filters={},
        columns=["incident_id", "notification_dt"],
        incident_ids=[1, 3],
        format="csv",
    )

    with open(path, newline="", encoding="utf-8") as handle:
        exported = list(csv.DictReader(handle))

    assert [int(row["incident_id"]) for row in exported] == [1, 3]


def test_export_respects_rls(monkeypatch: pytest.MonkeyPatch):
    mock_db = MagicMock()
    get_rows = MagicMock(return_value=[])

    monkeypatch.setattr("tasks.exports.get_session", lambda: mock_db)
    monkeypatch.setattr("tasks.exports.set_rls_context", MagicMock())
    monkeypatch.setattr("tasks.exports.get_analyst_export_rows", get_rows)

    export_analyst_incidents_task.run(
        user_id=str(uuid.uuid4()),
        filters={},
        columns=["incident_id"],
        incident_ids=[10, 20],
        format="csv",
    )

    assert get_rows.call_args.args[0] is mock_db
    assert get_rows.call_args.kwargs == {}
    assert get_rows.call_args.args[3] == [10, 20]


def test_export_log_inserted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    mock_db = MagicMock()

    monkeypatch.setattr("tasks.exports.EXPORT_DIR", str(tmp_path))
    monkeypatch.setattr("tasks.exports.get_session", lambda: mock_db)
    monkeypatch.setattr("tasks.exports.set_rls_context", MagicMock())
    monkeypatch.setattr(
        "tasks.exports.get_analyst_export_rows",
        MagicMock(return_value=[{"incident_id": 1}, {"incident_id": 3}]),
    )

    export_analyst_incidents_task.run(
        user_id=str(uuid.uuid4()),
        filters={},
        columns=["incident_id"],
        incident_ids=[1, 3],
        format="csv",
    )

    all_calls = mock_db.execute.call_args_list

    # --- analytics_export_log INSERT (RP-14: first statement) ---
    export_log_calls = [c for c in all_calls if "analytics_export_log" in str(c.args[0])]
    assert len(export_log_calls) == 1, (
        f"Expected exactly 1 analytics_export_log INSERT, got {len(export_log_calls)}"
    )
    export_sql = str(export_log_calls[0].args[0])
    export_params = export_log_calls[0].args[1]
    assert "analytics_export_log" in export_sql
    assert "export_type" in export_sql
    assert export_params["export_type"] == "analyst"
    assert export_params["row_count"] == 2

    # --- system_audit_trails BULK_EXPORT INSERT (RP-14: second statement) ---
    audit_trail_calls = [c for c in all_calls if "system_audit_trails" in str(c.args[0])]
    bulk_calls = [c for c in audit_trail_calls if c.args[1].get("action") == "BULK_EXPORT"]
    assert len(bulk_calls) == 1, (
        f"Expected exactly 1 system_audit_trails BULK_EXPORT INSERT, got {len(bulk_calls)}"
    )
    audit_sql = str(bulk_calls[0].args[0])
    assert "system_audit_trails" in audit_sql
    assert "export_type" not in audit_sql  # different table — no export_type column
