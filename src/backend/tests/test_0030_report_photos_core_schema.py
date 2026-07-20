"""Contract tests for persistent report_photos core-schema repair."""

from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import patch

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / "alembic/versions/0030_repair_report_photos_core_schema.py"
BOOTSTRAP = BACKEND_ROOT.parent / "postgres-init/82_civilian_report_photos.sql"


def _load_migration():
    spec = spec_from_file_location("repair_report_photos_core_schema", MIGRATION)
    assert spec and spec.loader
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_revision_follows_0029() -> None:
    migration = _load_migration()
    assert migration.revision == "0030"
    assert migration.down_revision == "0029"


def test_upgrade_repairs_every_bootstrap_core_column() -> None:
    migration = _load_migration()
    with patch.object(migration.op, "execute") as execute:
        migration.upgrade()

    statements = [call.args[0] for call in execute.call_args_list]
    upgrade_sql = "\n".join(statements)
    bootstrap_sql = BOOTSTRAP.read_text(encoding="utf-8")
    for column in migration.CORE_COLUMNS:
        assert f"ADD COLUMN IF NOT EXISTS {column}" in upgrade_sql
        assert column in bootstrap_sql

    assert "Cannot repair occupied partial" in statements[0]
    assert "CREATE INDEX IF NOT EXISTS idx_report_photos_report" in upgrade_sql


def test_downgrade_refuses_to_drop_encrypted_evidence_schema() -> None:
    migration = _load_migration()
    with pytest.raises(RuntimeError, match="cannot be safely downgraded"):
        migration.downgrade()
