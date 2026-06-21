from __future__ import annotations

from api.routes.regional.encoder import get_encoder_audit_log


class _Result:
    def __init__(self, *, rows=None, scalar_value=None) -> None:
        self._rows = rows or []
        self._scalar_value = scalar_value

    def fetchall(self):
        return self._rows

    def scalar(self):
        return self._scalar_value


class _FakeDb:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def execute(self, statement, params):
        sql = str(statement)
        self.calls.append((sql, params))
        if "SELECT COUNT(*) FROM activity_items" in sql:
            return _Result(scalar_value=0)
        return _Result(rows=[])


def test_encoder_audit_log_uses_single_filtered_activity_cte_for_pagination() -> None:
    db = _FakeDb()

    response = get_encoder_audit_log(
        user={"user_id": "00000000-0000-0000-0000-000000000001"},
        db=db,
        date_from="2026-06-01T00:00:00Z",
        date_to="2026-06-21T00:00:00Z",
        action="SUBMITTED",
        city_municipality="Manila",
        limit=25,
        offset=50,
    )

    assert response == {"items": [], "total": 0, "limit": 25, "offset": 50}
    assert len(db.calls) == 2

    rows_sql, rows_params = db.calls[0]
    count_sql, count_params = db.calls[1]

    assert "WITH activity_items AS" in rows_sql
    assert "UNION ALL" in rows_sql
    assert "FROM activity_items" in rows_sql
    assert "ORDER BY action_timestamp DESC" in rows_sql
    assert "LIMIT :limit OFFSET :offset" in rows_sql

    # Login rows are filtered inside the same CTE and paginated only after the
    # incident/login union, so totals and pages use one consistent result set.
    assert "sat.timestamp >= CAST(:date_from AS timestamptz)" in rows_sql
    assert "sat.timestamp <= CAST(:date_to AS timestamptz)" in rows_sql
    assert ":action IN ('LOGIN', 'USER_LOGIN')" in rows_sql
    assert "FALSE" in rows_sql
    assert "ORDER BY sat.timestamp" not in rows_sql
    assert "FROM activity_items" in count_sql
    assert "LIMIT :limit OFFSET :offset" not in count_sql

    assert rows_params["limit"] == 25
    assert rows_params["offset"] == 50
    assert rows_params["city_municipality"] == "%Manila%"
    assert count_params["action"] == "SUBMITTED"
