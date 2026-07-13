"""Contracts for removing the retired contributor photo bonus helper."""

from __future__ import annotations

from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / "alembic" / "versions" / "0013_remove_legacy_photo_bonus_function.py"
BOOTSTRAP = BACKEND_ROOT.parent / "postgres-init" / "92_remove_legacy_photo_bonus_function.sql"


def _migration_source() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _bootstrap_source() -> str:
    return BOOTSTRAP.read_text(encoding="utf-8")


def test_revision_follows_0012_head() -> None:
    source = _migration_source()
    assert 'revision: str = "0013"' in source
    assert 'down_revision: Union[str, None] = "0012"' in source


def test_upgrade_drops_legacy_helper() -> None:
    assert "DROP FUNCTION IF EXISTS wims.photo_bonus_for_report(INTEGER)" in _migration_source()
    assert "DROP FUNCTION IF EXISTS wims.photo_bonus_for_report(INTEGER);" in _bootstrap_source()


def test_downgrade_restores_original_helper_contract() -> None:
    source = _migration_source()
    assert "CREATE OR REPLACE FUNCTION wims.photo_bonus_for_report(" in source
    assert "SECURITY DEFINER" in source
    assert "SET search_path = wims, pg_temp" in source
    assert "REVOKE ALL ON FUNCTION wims.photo_bonus_for_report(INTEGER) FROM PUBLIC" in source
    assert "GRANT EXECUTE ON FUNCTION wims.photo_bonus_for_report(INTEGER) TO wims_app" in source


def test_clean_bootstrap_cleanup_has_no_recreated_helper() -> None:
    source = _bootstrap_source()
    assert "CREATE OR REPLACE FUNCTION wims.photo_bonus_for_report" not in source
    assert "Dependencies: 86_civilian_contributor_snapshot.sql" in source
