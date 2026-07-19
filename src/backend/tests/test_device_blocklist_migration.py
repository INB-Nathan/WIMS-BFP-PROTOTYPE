"""Regression contract for the persistent device-blocklist migration."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import patch


def _load_migration():
    path = Path(__file__).parents[1] / "alembic/versions/0027_device_blocklist_schema.py"
    spec = spec_from_file_location("device_blocklist_migration", path)
    assert spec and spec.loader
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_device_blocklist_upgrade_creates_schema_policy_and_config() -> None:
    migration = _load_migration()

    with patch.object(migration.op, "execute") as execute:
        migration.upgrade()

    sql = execute.call_args.args[0]
    assert "CREATE TABLE IF NOT EXISTS wims.device_blocklist" in sql
    assert "idx_device_blocklist_hash" in sql
    assert "idx_device_blocklist_active" in sql
    assert "FORCE ROW LEVEL SECURITY" in sql
    assert "device_blocklist_admin_all" in sql
    assert "device_blocklist.repeat_offender_threshold" in sql
