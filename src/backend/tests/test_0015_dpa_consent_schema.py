"""Contract tests for Alembic migration 0015 (DPA consent column).

Validates:
- Migration source has correct revision chain (0015 ← 0014)
- Upgrade adds dpa_consented_at TIMESTAMPTZ DEFAULT NULL
- Downgrade drops dpa_consented_at
- Clean bootstrap CREATE TABLE includes dpa_consented_at
- Bootstrap ALTER TABLE convergence block exists
"""

from __future__ import annotations

from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND_ROOT / "alembic" / "versions"
POSTGRES_INIT = BACKEND_ROOT.parent / "postgres-init"


def _migration_source() -> str:
    return (MIGRATIONS / "0015_dpa_consent_at.py").read_text(encoding="utf-8")


def _bootstrap_source() -> str:
    return (POSTGRES_INIT / "86_civilian_contributor_snapshot.sql").read_text(encoding="utf-8")


def test_revision_follows_head() -> None:
    source = _migration_source()
    assert 'revision: str = "0015"' in source
    assert 'down_revision: Union[str, None] = "0014"' in source


def test_upgrade_adds_dpa_consented_at_column() -> None:
    source = _migration_source()
    assert "ADD COLUMN IF NOT EXISTS dpa_consented_at TIMESTAMPTZ DEFAULT NULL" in source


def test_downgrade_drops_dpa_consented_at_column() -> None:
    source = _migration_source()
    assert "DROP COLUMN IF EXISTS dpa_consented_at" in source


def test_clean_bootstrap_creates_table_with_dpa_consented_at() -> None:
    sql = _bootstrap_source()
    # The column must appear in the CREATE TABLE IF NOT EXISTS block
    create_start = sql.index("CREATE TABLE IF NOT EXISTS wims.civilian_contributors (")
    create_end = sql.index(");", create_start)
    table_def = sql[create_start:create_end]
    assert "dpa_consented_at TIMESTAMPTZ DEFAULT NULL" in table_def


def test_clean_bootstrap_convergence_adds_dpa_consented_at() -> None:
    sql = _bootstrap_source()
    # The column must have an ALTER TABLE ADD COLUMN IF NOT EXISTS
    # for convergence on databases upgraded through the Alembic chain.
    assert "ADD COLUMN IF NOT EXISTS dpa_consented_at TIMESTAMPTZ DEFAULT NULL" in sql
