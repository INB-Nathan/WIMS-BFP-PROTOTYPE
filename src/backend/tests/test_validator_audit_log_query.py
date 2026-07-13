"""RP-25 regression tests: validator audit-log endpoints must only ever
return the calling validator's own actions, never all users' actions.

Mirrors test_encoder_audit_log_query.py's approach (call the route function
directly against a fake db, inspect the executed SQL + params) but targets
the two endpoints that were vulnerable: the list endpoint and the CSV
export, both scoped via build_audit_log_query()'s forced actor_user_id.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from api.routes.regional.validator import (
    export_validator_audit_logs,
    get_validator_audit_logs,
)
from services.regional_incidents.helpers import build_audit_log_query

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
        self.committed = False
        self.rolled_back = False

    def execute(self, statement, params):
        sql = str(statement)
        self.calls.append((sql, params))
        if "SELECT COUNT(*)" in sql:
            return _Result(scalar_value=0)
        return _Result(rows=[])

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


def _fake_request() -> SimpleNamespace:
    # trusted_client_ip()/_resolve_correlation_id() only touch .headers
    # (dict-like) and .client / .state via getattr — this is enough to
    # exercise log_system_audit() without a real ASGI Request.
    return SimpleNamespace(headers={}, client=None, state=SimpleNamespace())


def test_build_audit_log_query_requires_actor_user_id() -> None:
    """actor_user_id can't be omitted -- it's the forced scope, not a filter."""
    with pytest.raises(TypeError):
        build_audit_log_query(  # type: ignore[call-arg]
            date_from=None,
            date_to=None,
            region_id=None,
            actor_username=None,
            role=None,
            action=None,
        )


def test_build_audit_log_query_always_scopes_to_actor() -> None:
    where_sql, params = build_audit_log_query(
        actor_user_id=_CALLING_USER_ID,
        date_from=None,
        date_to=None,
        region_id=None,
        actor_username=None,
        role=None,
        action=None,
    )
    assert "ivh.action_by_user_id = CAST(:actor_user_id AS uuid)" in where_sql
    assert params["actor_user_id"] == _CALLING_USER_ID


def test_validator_audit_logs_list_scoped_to_calling_user_with_no_filters() -> None:
    """Regression test for the exact bug: leaving actor_username blank must
    NOT return every validator's actions -- only the caller's own."""
    db = _FakeDb()

    response = get_validator_audit_logs(
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


def test_validator_audit_logs_export_scoped_to_calling_user_with_no_filters() -> None:
    """Same regression, for the CSV export path -- it must not leak other
    validators' rows into the download either."""
    db = _FakeDb()

    export_validator_audit_logs(
        request=_fake_request(),
        user={"user_id": _CALLING_USER_ID},
        db=db,
        date_from=None,
        date_to=None,
        region_id=None,
        actor_username=None,
        role=None,
        action=None,
    )

    rows_sql, rows_params = db.calls[0]
    assert "ivh.action_by_user_id = CAST(:actor_user_id AS uuid)" in rows_sql
    assert rows_params["actor_user_id"] == _CALLING_USER_ID


def test_validator_audit_logs_actor_username_narrows_but_cannot_widen() -> None:
    """actor_username stays a valid additional narrowing filter, but it is
    ANDed with (not a substitute for) the forced actor_user_id scope."""
    db = _FakeDb()

    get_validator_audit_logs(
        user={"user_id": _CALLING_USER_ID},
        db=db,
        date_from=None,
        date_to=None,
        region_id=None,
        actor_username="someone-else",
        role=None,
        action=None,
        limit=50,
        offset=0,
    )

    rows_sql, rows_params = db.calls[0]
    assert "ivh.action_by_user_id = CAST(:actor_user_id AS uuid)" in rows_sql
    assert "u.username ILIKE :actor_username" in rows_sql
    assert rows_params["actor_user_id"] == _CALLING_USER_ID
    assert rows_params["actor_username"] == "%someone-else%"
