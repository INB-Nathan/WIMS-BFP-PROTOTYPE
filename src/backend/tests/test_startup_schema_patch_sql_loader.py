"""Unit tests for the SQL-file-backed startup schema patch loader in main.py."""

import pytest

from main import (
    _SQL_FILE_SCHEMA_PATCHES,
    _POSTGRES_INIT_DIR,
    _read_postgres_init_sql,
    _strip_sql_transaction_wrapper,
)


class TestStripSqlTransactionWrapper:
    def test_removes_standalone_begin_and_commit(self):
        sql = "BEGIN;\nSELECT 1;\nCOMMIT;\n"
        result = _strip_sql_transaction_wrapper(sql)
        assert "BEGIN" not in result.upper()
        assert "COMMIT" not in result.upper()
        assert "SELECT 1" in result

    def test_removes_whitespace_padded_begin_and_commit(self):
        sql = "  BEGIN;  \nALTER TABLE x ADD COLUMN y INT;\n  COMMIT;  \n"
        result = _strip_sql_transaction_wrapper(sql)
        assert "BEGIN" not in result.upper()
        assert "COMMIT" not in result.upper()
        assert "ALTER TABLE x ADD COLUMN y INT" in result

    def test_preserves_non_transaction_sql(self):
        sql = (
            "ALTER TABLE wims.fire_incidents\n"
            "    ADD COLUMN IF NOT EXISTS reference_number TEXT,\n"
            "    ADD COLUMN IF NOT EXISTS incident_type_code TEXT;\n"
            "\n"
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_fire_incidents_reference_number\n"
            "    ON wims.fire_incidents (reference_number)\n"
            "    WHERE reference_number IS NOT NULL;\n"
        )
        result = _strip_sql_transaction_wrapper(sql)
        assert "ADD COLUMN IF NOT EXISTS reference_number TEXT" in result
        assert "ADD COLUMN IF NOT EXISTS incident_type_code TEXT" in result
        assert "CREATE UNIQUE INDEX" in result

    def test_does_not_split_on_semicolons_inside_sql(self):
        sql = "SELECT 'BEGIN;' AS label, 'COMMIT;' AS label2;"
        result = _strip_sql_transaction_wrapper(sql)
        assert "SELECT 'BEGIN;' AS label, 'COMMIT;' AS label2;" in result

    def test_preserves_comments_with_begin_or_commit(self):
        sql = "-- BEGIN;\nSELECT 1;\n-- COMMIT;\n"
        result = _strip_sql_transaction_wrapper(sql)
        assert "-- BEGIN;" in result
        assert "SELECT 1" in result
        assert "-- COMMIT;" in result

    def test_empty_sql_returns_empty_string(self):
        result = _strip_sql_transaction_wrapper("")
        assert result == ""

    def test_begin_commit_only_returns_empty_string(self):
        result = _strip_sql_transaction_wrapper("BEGIN;\nCOMMIT;\n")
        assert result == ""


class TestReadPostgresInitSql:
    def test_read_allowlisted_file_returns_sql(self):
        sql = _read_postgres_init_sql("19_reference_number.sql")
        assert "ADD COLUMN IF NOT EXISTS reference_number TEXT" in sql
        assert "CREATE UNIQUE INDEX" in sql
        assert "BEGIN" not in sql.upper()  # stripped
        assert "COMMIT" not in sql.upper()  # stripped

    def test_non_allowlisted_seed_file_raises_value_error(self):
        with pytest.raises(ValueError, match="not allowlisted"):
            _read_postgres_init_sql("21_all_regions.sql")

    def test_non_allowlisted_file_raises_value_error(self):
        with pytest.raises(ValueError, match="not allowlisted"):
            _read_postgres_init_sql("../AGENTS.md")

    def test_path_traversal_is_blocked_by_allowlist_first(self):
        # Path traversal outside postgres-init raises ValueError because the
        # allowlist check runs first (the file is not in the allowlist).
        # The path-resolve guard is still present as defense-in-depth.
        with pytest.raises(ValueError, match="not allowlisted"):
            _read_postgres_init_sql("../AGENTS.md")

    def test_every_allowlisted_file_exists(self):
        for filename in sorted(_SQL_FILE_SCHEMA_PATCHES):
            path = _POSTGRES_INIT_DIR / filename
            assert path.is_file(), f"Allowlisted file missing: {filename}"

    def test_read_with_transaction_wrapper_strips_it(self):
        sql = _read_postgres_init_sql("27_reference_sequence.sql")
        assert "CREATE TABLE IF NOT EXISTS wims.reference_sequence" in sql
        assert "BEGIN" not in sql.upper()
        assert "COMMIT" not in sql.upper()

    def test_read_file_without_transaction_wrapper_returns_unchanged(self):
        sql = _read_postgres_init_sql("25_extent_fields.sql")
        assert "ADD COLUMN IF NOT EXISTS extent_description TEXT" in sql
        assert "ADD COLUMN IF NOT EXISTS extent_objects_count INT" in sql


class TestSqlFileSchemaPatchesMembership:
    """Boundary checks: verify allowlist contents against filesystem."""

    KNOWN_SEED_OR_MIXED_FILES = {
        "21_all_regions.sql",
        "03_users.sql",
        "14_seed_ncr.sql",
        "29_seed_incidents.sql",
        "38_seed_security_threat_logs.sql",
        "41_fix_immutable_rule_for_archive.sql",
        "42_ref_table_rls.sql",
    }

    def test_seed_mixed_files_are_not_allowlisted(self):
        for filename in self.KNOWN_SEED_OR_MIXED_FILES:
            assert filename not in _SQL_FILE_SCHEMA_PATCHES, (
                f"Seed/mixed file should not be allowlisted: {filename}"
            )

    def test_all_allowlisted_files_are_schema_only(self):
        """Every allowlisted file should be a schema migration, not seed/reference data."""
        for filename in sorted(_SQL_FILE_SCHEMA_PATCHES):
            path = _POSTGRES_INIT_DIR / filename
            content = path.read_text()
            has_insert = "INSERT INTO" in content.upper()
            has_create = "CREATE TABLE" in content.upper() or "ALTER TABLE" in content.upper()
            # 27_reference_sequence.sql has both CREATE TABLE and an INSERT for
            # initialization — that's acceptable because it's idempotent DDL init.
            assert has_create, f"Allowlisted file should contain DDL: {filename}"
            if has_insert:
                # Only 27_reference_sequence.sql has INSERT (ON CONFLICT DO UPDATE, idempotent)
                assert filename == "27_reference_sequence.sql", (
                    f"Unexpected INSERT in allowlisted file: {filename}"
                )
