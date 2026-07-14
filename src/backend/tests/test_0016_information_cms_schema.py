"""Contract tests for Alembic migration 0016 (information CMS tables).

Validates:
- Migration source has correct revision chain (0016 ← 0015)
- Upgrade creates both information_announcements and information_emergences tables
- Clean bootstrap SQL includes both tables
"""

from __future__ import annotations

from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND_ROOT / "alembic" / "versions"
POSTGRES_INIT = BACKEND_ROOT.parent / "postgres-init"


def _migration_source() -> str:
    return (MIGRATIONS / "0016_information_cms_schema.py").read_text(encoding="utf-8")


def _bootstrap_source() -> str:
    return (POSTGRES_INIT / "93_information_cms.sql").read_text(encoding="utf-8")


def test_revision_follows_head() -> None:
    source = _migration_source()
    assert 'revision: str = "0016"' in source
    assert 'down_revision: Union[str, None] = "0015"' in source


def test_upgrade_creates_announcements_table() -> None:
    source = _migration_source()
    assert "CREATE TABLE IF NOT EXISTS wims.information_announcements" in source


def test_upgrade_creates_emergencies_table() -> None:
    source = _migration_source()
    assert "CREATE TABLE IF NOT EXISTS wims.information_emergencies" in source


def test_upgrade_grants_wims_app() -> None:
    source = _migration_source()
    assert "GRANT SELECT, INSERT, UPDATE, DELETE" in source
    assert "wims.information_announcements TO wims_app" in source
    assert "wims.information_emergencies TO wims_app" in source


def test_clean_bootstrap_creates_announcements() -> None:
    sql = _bootstrap_source()
    assert "CREATE TABLE IF NOT EXISTS wims.information_announcements" in sql
    assert "GRANT SELECT, INSERT, UPDATE, DELETE" in sql
    assert "wims.information_announcements TO wims_app" in sql


def test_clean_bootstrap_creates_emergencies() -> None:
    sql = _bootstrap_source()
    assert "CREATE TABLE IF NOT EXISTS wims.information_emergencies" in sql
    assert "wims.information_emergencies TO wims_app" in sql


def test_clean_bootstrap_idempotent_wrapper() -> None:
    sql = _bootstrap_source()
    assert "BEGIN;" in sql
    assert "COMMIT;" in sql
