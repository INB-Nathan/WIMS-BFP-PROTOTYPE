"""Contract tests for migration 0029 and clean-bootstrap parity."""

from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import patch

from models.citizen_report import CitizenReport


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / "alembic/versions/0029_citizen_report_geoip_reporter.py"
BOOTSTRAP = BACKEND_ROOT.parent / "postgres-init/99_citizen_report_geoip_reporter_envelope.sql"

EXPECTED_COLUMNS = {
    "ip_geo_city",
    "ip_geo_province",
    "ip_geo_centroid",
    "ip_geo_accuracy_m",
    "ip_geo_provider",
    "ip_geo_lookup_at",
    "reporter_pii_blob_enc",
    "reporter_encryption_iv",
    "reporter_crypto_provider",
    "reporter_key_version",
    "reporter_kms_key_name",
}


def _load_migration():
    spec = spec_from_file_location("citizen_report_geoip_reporter", MIGRATION)
    assert spec and spec.loader
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_revision_follows_current_head() -> None:
    migration = _load_migration()
    assert migration.revision == "0029"
    assert migration.down_revision == "0028"


def test_upgrade_and_bootstrap_add_the_same_nullable_columns() -> None:
    migration = _load_migration()
    with patch.object(migration.op, "execute") as execute:
        migration.upgrade()

    upgrade_sql = execute.call_args.args[0]
    bootstrap_sql = BOOTSTRAP.read_text(encoding="utf-8")
    for column in EXPECTED_COLUMNS:
        assert f"ADD COLUMN IF NOT EXISTS {column}" in upgrade_sql
        assert f"ADD COLUMN IF NOT EXISTS {column}" in bootstrap_sql

    assert "ALTER COLUMN" not in upgrade_sql
    assert "ALTER COLUMN" not in bootstrap_sql
    assert "CREATE POLICY" not in upgrade_sql
    assert "CREATE POLICY" not in bootstrap_sql


def test_downgrade_refuses_to_drop_live_evidence() -> None:
    migration = _load_migration()
    with patch.object(migration.op, "execute") as execute:
        migration.downgrade()

    downgrade_sql = execute.call_args.args[0]
    assert "RAISE EXCEPTION" in downgrade_sql
    assert "reporter_pii_blob_enc IS NOT NULL" in downgrade_sql
    assert "ip_geo_centroid IS NOT NULL" in downgrade_sql
    assert "DROP COLUMN IF EXISTS reporter_pii_blob_enc" in downgrade_sql


def test_model_maps_all_new_columns_as_nullable() -> None:
    table = CitizenReport.__table__
    for column_name in EXPECTED_COLUMNS:
        assert column_name in table.columns
        assert table.columns[column_name].nullable is True
