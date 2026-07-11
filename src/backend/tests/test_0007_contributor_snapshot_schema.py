"""Contract tests for the trust-score snapshot schema cleanup."""

from __future__ import annotations

import re
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND_ROOT / "alembic" / "versions"
POSTGRES_INIT = BACKEND_ROOT.parent / "postgres-init"


def _migration_source() -> str:
    return (MIGRATIONS / "0007_contributor_snapshot_cleanup.py").read_text(encoding="utf-8")


def _bootstrap_source() -> str:
    return (POSTGRES_INIT / "86_civilian_contributor_snapshot.sql").read_text(encoding="utf-8")


def test_revision_follows_current_head() -> None:
    source = _migration_source()
    assert 'revision: str = "0007"' in source
    assert 'down_revision: Union[str, None] = "0006"' in source


def test_upgrade_backfills_and_enforces_formula_version() -> None:
    source = _migration_source()
    assert "ADD COLUMN IF NOT EXISTS formula_version TEXT" in source
    assert "SET DEFAULT 'reliability-v1'" in source
    assert "WHERE formula_version IS NULL" in source
    assert "ALTER COLUMN formula_version SET NOT NULL" in source
    assert "DROP COLUMN IF EXISTS opt_in_leaderboard" in source


def test_downgrade_restores_released_schema_shape() -> None:
    source = _migration_source()
    assert "ADD COLUMN IF NOT EXISTS opt_in_leaderboard BOOLEAN NOT NULL DEFAULT FALSE" in source
    assert "DROP COLUMN IF EXISTS formula_version" in source


def test_clean_bootstrap_contains_canonical_final_table() -> None:
    sql = _bootstrap_source()
    table_match = re.search(
        r"CREATE TABLE IF NOT EXISTS wims\.civilian_contributors \((.*?)\n\);",
        sql,
        re.DOTALL,
    )
    assert table_match is not None
    table_definition = table_match.group(1)
    assert "formula_version  TEXT        NOT NULL DEFAULT 'reliability-v1'" in table_definition
    assert "opt_in_leaderboard" not in table_definition


def test_clean_bootstrap_preserves_rls_and_grants() -> None:
    sql = _bootstrap_source()
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "FORCE ROW LEVEL SECURITY" in sql
    for policy in (
        "civilian_contributors_select",
        "civilian_contributors_insert",
        "civilian_contributors_update",
        "civilian_contributors_delete",
    ):
        assert f"DROP POLICY IF EXISTS {policy}" in sql
        assert f"CREATE POLICY {policy}" in sql
    assert "GRANT SELECT, INSERT, UPDATE, DELETE ON wims.civilian_contributors TO wims_app" in sql
