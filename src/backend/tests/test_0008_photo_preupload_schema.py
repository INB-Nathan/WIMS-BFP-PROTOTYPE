"""Static contract tests for the photo pre-upload schema migration."""

from __future__ import annotations

import re
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / "alembic" / "versions" / "0008_photo_preupload_schema.py"
BOOTSTRAP = BACKEND_ROOT.parent / "postgres-init" / "87_photo_preupload_schema.sql"


def _migration_source() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _bootstrap_source() -> str:
    return BOOTSTRAP.read_text(encoding="utf-8")


def test_revision_follows_existing_untracked_head() -> None:
    source = _migration_source()
    assert 'revision: str = "0008"' in source
    assert 'down_revision: Union[str, None] = "0007"' in source


def test_both_paths_make_report_id_nullable_and_add_attachment_timestamp() -> None:
    migration = _migration_source()
    bootstrap = _bootstrap_source()

    assert "ALTER COLUMN report_id DROP NOT NULL" in migration
    assert "ADD COLUMN IF NOT EXISTS attached_at TIMESTAMPTZ" in migration
    assert "ALTER COLUMN report_id DROP NOT NULL" in bootstrap
    assert "ADD COLUMN IF NOT EXISTS attached_at TIMESTAMPTZ" in bootstrap
    assert "report_photos_attachment_state" in migration
    assert "report_photos_attachment_state" in bootstrap
    assert "report_id IS NULL AND attached_at IS NULL" in migration
    assert "report_id IS NOT NULL AND attached_at IS NOT NULL" in bootstrap


def test_existing_attached_rows_are_backfilled_before_constraint() -> None:
    migration = _migration_source()
    backfill = migration.index("SET attached_at = created_at")
    assert migration.index("op.execute(_ATTACHMENT_CHECK)", backfill) > backfill
    assert "WHERE report_id IS NOT NULL" in migration[backfill:]

    bootstrap = _bootstrap_source()
    backfill = bootstrap.index("SET attached_at = created_at")
    constraint = bootstrap.index("ADD CONSTRAINT report_photos_attachment_state", backfill)
    assert backfill < constraint
    assert "WHERE report_id IS NOT NULL" in bootstrap[backfill:constraint]


def test_ddl_is_idempotent_on_retry() -> None:
    for source in (_migration_source(), _bootstrap_source()):
        assert "ADD COLUMN IF NOT EXISTS attached_at" in source
        assert "CREATE INDEX IF NOT EXISTS idx_report_photos_pending_owner" in source
        assert "DROP POLICY IF EXISTS report_photos_select" in source
        assert "DROP POLICY IF EXISTS report_photos_insert" in source
        assert "DROP POLICY IF EXISTS report_photos_update" in source
        assert "DROP POLICY IF EXISTS report_photos_delete" in source
        assert "IF NOT EXISTS (" in source


def test_pending_owner_index_is_partial_and_preserves_fk_and_xor() -> None:
    migration = _migration_source()
    bootstrap = _bootstrap_source()

    for source in (migration, bootstrap):
        assert "idx_report_photos_pending_owner" in source
        assert "WHERE report_id IS NULL" in source
        assert "DROP CONSTRAINT IF EXISTS fk_report_photos_report" not in source

    original = (BACKEND_ROOT.parent / "postgres-init" / "82_civilian_report_photos.sql").read_text(
        encoding="utf-8"
    )
    assert "CONSTRAINT report_photos_owner_xor CHECK" in original
    assert "CONSTRAINT fk_report_photos_report" in original


def test_rls_keeps_force_and_limits_pending_rows_to_registered_owner() -> None:
    for source in (_migration_source(), _bootstrap_source()):
        assert "FORCE ROW LEVEL SECURITY" in source
        assert "report_id IS NULL" in source
        assert "uploader_user_id = wims.current_user_uuid()" in source
        assert "wims.current_user_role() = 'CIVILIAN_REPORTER'" in source
        assert "report_photos_select" in source
        assert "report_photos_insert" in source
        assert "report_photos_update" in source
        assert "report_photos_delete" in source

        # Anonymous pending ownership is not safely representable by the
        # current transaction GUCs.  Ensure the documented blocker remains and
        # no permissive report_photos policy is introduced.
        assert "TODO(photo-preupload)" in source
        report_policies = source.split("report_photos_select", 1)[-1]
        assert (
            re.search(
                r"CREATE POLICY report_photos_\w+.*?WITH CHECK \(TRUE\)",
                report_policies,
                re.DOTALL,
            )
            is None
        )


def test_attached_row_policy_is_not_widened_and_todo_is_explicit() -> None:
    migration = _migration_source()
    bootstrap = _bootstrap_source()
    for source in (migration, bootstrap):
        select_start = source.index("CREATE POLICY report_photos_select")
        select_end = source.index("DROP POLICY IF EXISTS report_photos_insert", select_start)
        select_policy = source[select_start:select_end]
        assert "SYSTEM_ADMIN" in select_policy
        assert "NATIONAL_VALIDATOR" in select_policy
        assert "NATIONAL_ANALYST" in select_policy
        assert "report_id IS NULL" in select_policy

        todo = re.search(r"TODO\(photo-preupload\):(.+?)(?:\n\n|\Z)", source, re.DOTALL)
        assert todo is not None
        assert "anonymous" in todo.group(1).lower()
        assert "transaction-local" in todo.group(1)
