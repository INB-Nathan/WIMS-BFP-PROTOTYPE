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

    params = mock_db.execute.call_args.args[1]
    assert "export_type" in str(mock_db.execute.call_args.args[0])
    assert params["export_type"] == "analyst"
    assert params["row_count"] == 2
