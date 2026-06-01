from __future__ import annotations

from pathlib import Path


def _repo_root() -> Path:
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "src" / "postgres-init").is_dir():
            return candidate
    raise AssertionError("repository root not found")


def test_current_user_role_definition_lives_only_in_rls_helpers() -> None:
    postgres_init = _repo_root() / "src" / "postgres-init"
    definitions = []
    for path in postgres_init.glob("*.sql"):
        text = path.read_text(encoding="utf-8")
        if "CREATE OR REPLACE FUNCTION wims.current_user_role()" in text:
            definitions.append(path.name)

    assert definitions == ["09_rls_helpers.sql"]


def test_startup_schema_patch_does_not_redefine_rls_helpers() -> None:
    main_py = _repo_root() / "src" / "backend" / "main.py"
    text = main_py.read_text(encoding="utf-8")

    assert "CREATE OR REPLACE FUNCTION wims.current_user_role" not in text
    assert "_apply_rls_helpers_security_definer" not in text


def test_ncr_assignment_uses_canonical_encoder_username() -> None:
    migration = _repo_root() / "src" / "postgres-init" / "14a_assign_ncr_to_test_users.sql"
    text = migration.read_text(encoding="utf-8")

    assert "encoder_ncr" in text
    assert "encoder_test" not in text
