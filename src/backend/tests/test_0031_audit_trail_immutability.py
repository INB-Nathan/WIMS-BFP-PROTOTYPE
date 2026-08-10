"""Contract tests for migration 0031's append-only downgrade semantics."""

from __future__ import annotations

import logging
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import patch


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / "alembic/versions/0031_audit_trail_immutability.py"
MIGRATION_LOGGER = "alembic.migration.0031"


def _load_migration():
    spec = spec_from_file_location("audit_trail_immutability", MIGRATION)
    assert spec and spec.loader
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


class _FakeResult:
    def __init__(self, present: bool) -> None:
        self._present = present

    def scalar(self) -> bool:
        return self._present


class _FakeConnection:
    """Stands in for op.get_bind(); reports the audit table as present or absent."""

    def __init__(self, present: bool) -> None:
        self._present = present

    def execute(self, _statement):
        return _FakeResult(self._present)


def test_revision_follows_0030() -> None:
    migration = _load_migration()
    assert migration.revision == "0031"
    assert migration.down_revision == "0030"


def test_downgrade_drops_both_immutability_triggers(caplog) -> None:
    migration = _load_migration()
    with (
        patch.object(migration.op, "get_bind", return_value=_FakeConnection(present=True)),
        patch.object(migration.op, "execute") as execute,
        caplog.at_level(logging.WARNING, logger=MIGRATION_LOGGER),
    ):
        migration.downgrade()

    statements = [str(call.args[0]) for call in execute.call_args_list]
    assert (
        "DROP TRIGGER IF EXISTS trg_audit_trails_no_update ON wims.system_audit_trails"
        in statements
    )
    assert (
        "DROP TRIGGER IF EXISTS trg_audit_trails_no_delete ON wims.system_audit_trails"
        in statements
    )
    assert not any("DROP FUNCTION" in statement for statement in statements), (
        "the shared trigger function must be kept so a later upgrade can recreate triggers"
    )
    warnings = [str(record.message) for record in caplog.records]
    assert any("append-only enforcement is removed" in warning for warning in warnings), (
        "downgrade must log an explicit warning that append-only enforcement is removed"
    )


def test_downgrade_is_noop_when_audit_table_missing(caplog) -> None:
    migration = _load_migration()
    with (
        patch.object(migration.op, "get_bind", return_value=_FakeConnection(present=False)),
        patch.object(migration.op, "execute") as execute,
        caplog.at_level(logging.WARNING, logger=MIGRATION_LOGGER),
    ):
        migration.downgrade()

    assert execute.call_args_list == [], "no DDL may run when the audit table is missing"
    warnings = [str(record.message) for record in caplog.records]
    assert any("does not exist — nothing to drop" in warning for warning in warnings)


def test_downgrade_docstring_warns_about_lost_enforcement() -> None:
    migration = _load_migration()
    doc = migration.downgrade.__doc__ or ""
    lowered = doc.lower()
    assert "append-only" in lowered
    assert "mutable" in lowered
    assert "rls" in lowered
