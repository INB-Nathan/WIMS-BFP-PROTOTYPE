"""Static contracts for the Community Safety Hub CMS content schema.

Mirrors test_0011: the migration (Alembic 0012) and the clean bootstrap
(91_*.sql) must define the identical ``wims.community_content`` /
``wims.community_content_version`` tables, indexes, RLS, and grants.  Each
behavioral requirement from the task is asserted against both sources without
needing a live RLS database, so a logic/whitespace drift in either path is
caught.  The byte-identical check mirrors the function-body comparison used by
test_0011.
"""

from __future__ import annotations

import re
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / "alembic" / "versions" / "0012_community_content_schema.py"
BOOTSTRAP = BACKEND_ROOT.parent / "postgres-init" / "91_community_content_schema.sql"
CONTRIB_SNAPSHOT = BACKEND_ROOT.parent / "postgres-init" / "86_civilian_contributor_snapshot.sql"

# Audit/immutability tables that this migration must never weaken.
_PROTECTED_TABLES = ("system_audit_trails", "incident_verification_history")


def _sources() -> tuple[str, str]:
    return (
        MIGRATION.read_text(encoding="utf-8"),
        BOOTSTRAP.read_text(encoding="utf-8"),
    )


def _migration_ddl(migration: str) -> str:
    """Return the _COMMUNITY_CONTENT_DDL constant body from the migration."""
    match = re.search(r'_COMMUNITY_CONTENT_DDL = """(.*?)"""', migration, re.DOTALL)
    assert match is not None, "migration must define _COMMUNITY_CONTENT_DDL"
    return match.group(1)


def _bootstrap_ddl(bootstrap: str) -> str:
    """Return the SQL between the line-anchored BEGIN; and COMMIT; from the bootstrap.

    The header comment also mentions "BEGIN; and COMMIT;", so the anchors are
    line-start (MULTILINE) to avoid matching the comment.
    """
    match = re.search(r"^BEGIN;(.*?)^COMMIT;", bootstrap, re.DOTALL | re.MULTILINE)
    assert match is not None, "bootstrap must wrap the DDL in BEGIN; ... COMMIT;"
    return match.group(1)


def _strip_sql_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"--[^\n]*", "", text)
    return text


def _create_table_block(source: str, table: str) -> str:
    pattern = re.compile(rf"CREATE TABLE IF NOT EXISTS wims\.{table} \((.*?)\n\);", re.DOTALL)
    match = pattern.search(source)
    assert match is not None, f"{table} CREATE TABLE not found"
    return match.group(1)


def _assert_columns(block: str, columns: dict[str, str]) -> None:
    for name, typ in columns.items():
        assert re.search(rf"\b{name}\b\s+{typ}\b", block, re.IGNORECASE), (
            f"expected column {name} {typ} in block:\n{block}"
        )


def test_revision_follows_0011_head_and_bootstrap_number() -> None:
    migration, bootstrap = _sources()
    assert 'revision: str = "0012"' in migration
    assert 'down_revision: Union[str, None] = "0011"' in migration
    assert "Dependencies: 86_civilian_contributor_snapshot.sql" in bootstrap


def test_community_content_table_columns_and_types() -> None:
    for source in _sources():
        block = _create_table_block(source, "community_content")
        _assert_columns(
            block,
            {
                "id": "UUID",
                "content_type": "TEXT",
                "slug": "TEXT",
                "lifecycle_status": "TEXT",
                "published_version_id": "UUID",
                "expires_at": "TIMESTAMPTZ",
                "last_reviewed_at": "TIMESTAMPTZ",
                "urgent_banner": "BOOLEAN",
                "created_at": "TIMESTAMPTZ",
                "updated_at": "TIMESTAMPTZ",
                "archived_at": "TIMESTAMPTZ",
                "created_by": "UUID",
                "row_version": "INTEGER",
            },
        )
        # CHECK constraints and defaults.
        assert "content_type IN ('SAFETY_ARTICLE', 'ANNOUNCEMENT', 'EVENT')" in block
        assert "lifecycle_status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')" in block
        assert "lifecycle_status  TEXT        NOT NULL DEFAULT 'DRAFT'" in block
        assert "urgent_banner     BOOLEAN     NOT NULL DEFAULT FALSE" in block
        assert "row_version       INTEGER     NOT NULL DEFAULT 1" in block
        # Publication pointer FK to the version table (may span lines).
        assert "fk_community_content_published_version" in source
        assert re.search(
            r"FOREIGN KEY \(published_version_id\)\s+REFERENCES "
            r"wims\.community_content_version\(version_id\)",
            source,
            re.DOTALL,
        ), "expected published_version_id FK to community_content_version"


def test_community_content_version_table_columns_and_types() -> None:
    for source in _sources():
        block = _create_table_block(source, "community_content_version")
        _assert_columns(
            block,
            {
                "version_id": "UUID",
                "content_id": "UUID",
                "version_number": "INTEGER",
                "title_en": "TEXT",
                "title_uk": "TEXT",
                "body_en": "TEXT",
                "body_uk": "TEXT",
                "metadata_json": "JSONB",
                "content_hash": "TEXT",
                "creator": "UUID",
                "created_at": "TIMESTAMPTZ",
            },
        )
        # content_id FK to the live pointer row.
        assert "content_id     UUID        NOT NULL REFERENCES wims.community_content(id)" in block
        # Append-only note present (documented invariant).
        assert "NEVER updated or deleted" in source


def test_partial_unique_urgent_banner_index() -> None:
    for source in _sources():
        assert "uq_community_content_active_urgent_banner" in source
        # UNIQUE partial index enforcing at most one published urgent banner.
        assert "CREATE UNIQUE INDEX uq_community_content_active_urgent_banner" in source
        assert "WHERE urgent_banner = TRUE AND lifecycle_status = 'PUBLISHED'" in source
        # Volatile time clause is intentionally excluded (IMMUTABLE requirement).
        assert (
            "expires_at IS NULL OR expires_at > now()"
            not in source.split("uq_community_content_active_urgent_banner")[1].split(";")[0]
        )


def test_version_unique_content_id_version_number() -> None:
    for source in _sources():
        assert "uq_community_content_version_content_id_version_number" in source
        assert (
            "CREATE UNIQUE INDEX uq_community_content_version_content_id_version_number" in source
        )
        assert "ON wims.community_content_version (content_id, version_number)" in source
        # Version-desc lookup index also present.
        assert "idx_community_content_version_content_id_version_desc" in source
        assert "(content_id, version_number DESC)" in source
        # Globally unique slug index.
        assert "uq_community_content_slug" in source
        assert "ON wims.community_content (slug)" in source
        # Public listing index.
        assert "idx_community_content_public_list" in source
        assert "ON wims.community_content (content_type, lifecycle_status, expires_at)" in source


def test_force_row_level_security_on_both_tables() -> None:
    for source in _sources():
        assert "ALTER TABLE wims.community_content ENABLE ROW LEVEL SECURITY" in source
        assert "ALTER TABLE wims.community_content FORCE ROW LEVEL SECURITY" in source
        assert "ALTER TABLE wims.community_content_version ENABLE ROW LEVEL SECURITY" in source
        assert "ALTER TABLE wims.community_content_version FORCE ROW LEVEL SECURITY" in source


def test_public_read_policy_published_and_not_expired() -> None:
    for source in _sources():
        # community_content public read limited to published + non-expired.
        assert "community_content_public_select" in source
        assert "CREATE POLICY community_content_public_select" in source
        assert "lifecycle_status = 'PUBLISHED'" in source
        assert "(expires_at IS NULL OR expires_at > now())" in source
        # version public read is gated on the parent's published/non-expired state.
        assert "community_content_version_public_select" in source
        assert "CREATE POLICY community_content_version_public_select" in source


def test_system_admin_only_write_policy() -> None:
    for source in _sources():
        assert "CREATE POLICY community_content_admin_write" in source
        assert "ON wims.community_content FOR ALL" in source
        assert "CREATE POLICY community_content_version_admin_select" in source
        assert "ON wims.community_content_version FOR SELECT" in source
        assert "CREATE POLICY community_content_version_admin_write" in source
        assert "ON wims.community_content_version FOR INSERT" in source
        # Version history has no UPDATE/DELETE policy; it is append-only.
        assert "community_content_version FOR ALL" not in source
        assert "wims.current_user_role() = 'SYSTEM_ADMIN'" in source
        assert "WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN')" in source
        assert "is_system_admin" not in source
        assert "BYPASSRLS" not in source


def test_grant_to_wims_app_and_no_public_grant() -> None:
    migration, bootstrap = _sources()
    for source in (migration, bootstrap):
        assert (
            "GRANT SELECT, INSERT, UPDATE, DELETE ON wims.community_content TO wims_app" in source
        )
        assert "GRANT SELECT, INSERT ON wims.community_content_version TO wims_app" in source
        assert (
            "GRANT SELECT, INSERT, UPDATE, DELETE ON wims.community_content_version" not in source
        )
        assert "TO PUBLIC" not in source


def test_migration_does_not_weaken_audit_or_ivh() -> None:
    migration = MIGRATION.read_text(encoding="utf-8")
    stripped = _strip_sql_comments(migration)
    for table in _PROTECTED_TABLES:
        # No DROP/ALTER/REVOKE/TRUNCATE/UPDATE/DELETE may touch these tables.
        assert not re.search(
            rf"\b(DROP|ALTER|REVOKE|TRUNCATE|UPDATE|DELETE)\b[\s\S]*\b{table}\b",
            stripped,
            re.IGNORECASE,
        ), f"migration must not touch {table}"
        # Strongest: the protected table names never appear in the migration.
        assert table not in migration


def test_contributor_snapshot_in_86_has_formula_version_and_no_opt_in() -> None:
    snapshot = CONTRIB_SNAPSHOT.read_text(encoding="utf-8")
    # formula_version is present (in the CREATE TABLE and the ALTERs).
    assert "formula_version" in snapshot
    # The retired leaderboard opt-in flag must be absent from the active schema:
    # it is neither defined in the CREATE TABLE nor retained as a column.  The
    # idempotent DROP COLUMN IF EXISTS cleanup statement is allowed to name it.
    create_block = _create_table_block(snapshot, "civilian_contributors")
    assert "formula_version" in create_block
    assert "opt_in_leaderboard" not in create_block


def test_migration_and_bootstrap_ddl_bodies_are_identical() -> None:
    migration, bootstrap = _sources()
    assert _migration_ddl(migration).strip() == _bootstrap_ddl(bootstrap).strip()
