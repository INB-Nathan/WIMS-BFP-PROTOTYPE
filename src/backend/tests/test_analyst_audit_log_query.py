"""RP-25 regression tests for the NATIONAL_ANALYST audit-log endpoint.

Mirrors test_validator_audit_log_query.py's approach (call the route
function directly against a fake db, inspect the executed SQL + params) but
targets api.routes.analytics.get_analyst_audit_logs, and also covers the
get_national_analyst dependency's 403 rejection for non-analyst roles.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from api.routes.analytics import get_analyst_audit_logs
from auth import get_national_analyst

_CALLING_USER_ID = "00000000-0000-0000-0000-000000000042"


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
        if "SELECT COUNT(*)" in sql:
            return _Result(scalar_value=0)
        return _Result(rows=[])


def test_analyst_audit_logs_scoped_to_calling_user_with_no_filters() -> None:
    """Regression test for the core security property: leaving all optional
    filters blank must NOT return every analyst's actions -- only the
    caller's own, via the forced actor_user_id scope."""
    db = _FakeDb()

    response = get_analyst_audit_logs(
        user={"user_id": _CALLING_USER_ID},
        db=db,
        date_from=None,
        date_to=None,
        region_id=None,
        actor_username=None,
        role=None,
        action=None,
        limit=50,
        offset=0,
    )

    assert response == {"items": [], "total": 0, "limit": 50, "offset": 0}
    assert len(db.calls) == 2

    rows_sql, rows_params = db.calls[0]
    count_sql, count_params = db.calls[1]

    assert "ivh.action_by_user_id = CAST(:actor_user_id AS uuid)" in rows_sql
    assert "ivh.action_by_user_id = CAST(:actor_user_id AS uuid)" in count_sql
    assert rows_params["actor_user_id"] == _CALLING_USER_ID
    assert count_params["actor_user_id"] == _CALLING_USER_ID


def test_get_national_analyst_rejects_non_analyst_role() -> None:
    """Non-NATIONAL_ANALYST roles must be rejected with 403 -- the
    self-scoped audit view is single-role by design (auth.py:790)."""
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(get_national_analyst(current_user={"role": "NATIONAL_VALIDATOR"}))

    assert exc_info.value.status_code == 403
