"""Contract tests for ledgered live SQL migrations.

These tests are intentionally mostly static/pure-function checks. They pin the
first-run baseline semantics that protect production from replaying historical
bootstrap SQL while still applying future ledgered migrations exactly once.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts import apply_live_migrations as runner


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _migration(filename: str, checksum: str | None = None) -> runner.MigrationFile:
    return runner.MigrationFile(
        filename=filename,
        path=Path("/postgres-init") / filename,
        checksum_sha256=checksum or f"sha-{filename}",
    )


class TestSchemaMigrationsSql:
    def test_79_schema_migrations_sql_defines_governed_ledger(self) -> None:
        sql = (_repo_root() / "src" / "postgres-init" / runner.LEDGER_FILENAME).read_text()

        assert "CREATE TABLE IF NOT EXISTS wims.schema_migrations" in sql
        assert "checksum_sha256 TEXT NOT NULL" in sql
        assert "status          TEXT NOT NULL" in sql
        assert "CHECK (status IN ('baseline', 'applied', 'failed'))" in sql
        assert "ALTER TABLE wims.schema_migrations ENABLE ROW LEVEL SECURITY" in sql
        assert "ALTER TABLE wims.schema_migrations FORCE ROW LEVEL SECURITY" in sql
        assert "schema_migrations_admin_select" in sql
        assert "schema_migrations_admin_insert" in sql
        assert "schema_migrations_admin_update" in sql
        assert "SECURITY DEFINER" in sql
        assert "SET search_path = wims, pg_catalog" in sql
        assert "SCHEMA_MIGRATION_LEDGER_CHANGE" in sql
        assert "trg_audit_schema_migration_change" in sql

    def test_runner_sources_ledger_schema_from_79_sql(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        ledger_sql = tmp_path / runner.LEDGER_FILENAME
        ledger_sql.write_text("-- canonical ledger DDL\n")
        calls: list[Path] = []

        def fake_run_psql_file(
            database_url: str, file_path: Path, *, lock_timeout: str
        ) -> tuple[int, str, str, int]:
            assert database_url == "postgresql://postgres:secret@postgres:5432/wims"
            assert lock_timeout == "30s"
            calls.append(file_path)
            return 0, "", "", 0

        monkeypatch.setattr(runner, "run_psql_file", fake_run_psql_file)

        runner.ensure_ledger_schema(
            "postgresql://postgres:secret@postgres:5432/wims",
            tmp_path,
            lock_timeout="30s",
        )

        assert calls == [ledger_sql]


class TestMigrationPlanning:
    def test_files_are_sorted_with_c_locale_byte_order(self, tmp_path: Path) -> None:
        for filename in ["10_second.sql", "02_first.sql", "09_middle.sql"]:
            (tmp_path / filename).write_text(filename)

        files = runner.discover_sql_files(tmp_path)

        assert [f.filename for f in files] == [
            "02_first.sql",
            "09_middle.sql",
            "10_second.sql",
        ]

    def test_sha256_file_uses_file_contents(self, tmp_path: Path) -> None:
        sql = tmp_path / "79_schema_migrations.sql"
        sql.write_text("SELECT 1;\n")

        assert (
            runner.sha256_file(sql)
            == "b4e0497804e46e0a0b0b8c31975b062152d551bac49c3c2e80932567b4085dcd"
        )

    def test_existing_db_empty_ledger_baselines_only_through_cutoff(self) -> None:
        files = [
            _migration("01_extensions_roles.sql"),
            _migration(runner.LEDGER_FILENAME),
            _migration("80_future_live_migration.sql"),
        ]

        actions = runner.plan_migrations(
            files,
            {},
            existing_db=True,
            baseline_existing=True,
            baseline_through=runner.LEDGER_FILENAME,
        )

        assert [(a.action, a.migration.filename) for a in actions] == [
            ("baseline", "01_extensions_roles.sql"),
            ("baseline", runner.LEDGER_FILENAME),
            ("apply", "80_future_live_migration.sql"),
        ]

    def test_existing_db_baseline_refuses_missing_cutoff(self) -> None:
        with pytest.raises(runner.MigrationError, match="Baseline cutoff"):
            runner.plan_migrations(
                [_migration("01_extensions_roles.sql")],
                {},
                existing_db=True,
                baseline_existing=True,
                baseline_through=runner.LEDGER_FILENAME,
            )

    def test_empty_ledger_without_existing_db_refuses_to_bootstrap(self) -> None:
        with pytest.raises(runner.MigrationError, match="Bootstrap the database"):
            runner.plan_migrations(
                [_migration(runner.LEDGER_FILENAME)],
                {},
                existing_db=False,
                baseline_existing=True,
                baseline_through=runner.LEDGER_FILENAME,
            )

    def test_applied_checksum_drift_fails_fast(self) -> None:
        migration = _migration(runner.LEDGER_FILENAME, checksum="new")
        ledger = {
            runner.LEDGER_FILENAME: runner.LedgerRow(
                filename=runner.LEDGER_FILENAME,
                checksum_sha256="old",
                status="applied",
            )
        }

        with pytest.raises(runner.ChecksumDriftError, match="Checksum drift"):
            runner.plan_migrations(
                [migration],
                ledger,
                existing_db=True,
                baseline_existing=True,
                baseline_through=runner.LEDGER_FILENAME,
            )

    def test_failed_same_checksum_is_retried_not_skipped(self) -> None:
        migration = _migration("80_future_live_migration.sql", checksum="same")
        ledger = {
            migration.filename: runner.LedgerRow(
                filename=migration.filename,
                checksum_sha256="same",
                status="failed",
            )
        }

        actions = runner.plan_migrations(
            [migration],
            ledger,
            existing_db=True,
            baseline_existing=True,
            baseline_through=migration.filename,
        )

        assert [(a.action, a.migration.filename) for a in actions] == [
            ("retry_failed", migration.filename)
        ]

    def test_failed_changed_checksum_requires_explicit_flag(self) -> None:
        migration = _migration("80_future_live_migration.sql", checksum="new")
        ledger = {
            migration.filename: runner.LedgerRow(
                filename=migration.filename,
                checksum_sha256="old",
                status="failed",
            )
        }

        with pytest.raises(runner.ChecksumDriftError, match="allow-failed-checksum-change"):
            runner.plan_migrations(
                [migration],
                ledger,
                existing_db=True,
                baseline_existing=True,
                baseline_through=migration.filename,
            )

        actions = runner.plan_migrations(
            [migration],
            ledger,
            existing_db=True,
            baseline_existing=True,
            baseline_through=migration.filename,
            allow_failed_checksum_change=True,
        )
        assert actions[0].action == "retry_failed"


class TestDryRunAndWorkflowContracts:
    def test_dry_run_main_does_not_ensure_or_execute(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        (tmp_path / runner.LEDGER_FILENAME).write_text("SELECT 1;\n")

        class FakeConn:
            def __enter__(self) -> "FakeConn":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def commit(self) -> None:
                return None

            def rollback(self) -> None:
                return None

        class FakeEngine:
            def connect(self) -> FakeConn:
                return FakeConn()

        monkeypatch.setenv("DATABASE_ADMIN_URL", "postgresql://postgres:secret@postgres:5432/wims")
        monkeypatch.setattr(runner, "create_admin_engine", lambda _url: FakeEngine())
        monkeypatch.setattr(runner, "current_user_can_bypass_rls", lambda _conn: True)
        monkeypatch.setattr(runner, "load_ledger", lambda _conn: {})
        monkeypatch.setattr(runner, "table_exists", lambda _conn, _name: True)
        monkeypatch.setattr(
            runner,
            "ensure_ledger_schema",
            lambda *_args, **_kwargs: pytest.fail("dry-run must not ensure ledger schema"),
        )
        monkeypatch.setattr(
            runner,
            "execute_actions",
            lambda *_args, **_kwargs: pytest.fail("dry-run must not execute actions"),
        )

        assert (
            runner.main(
                [
                    "--dir",
                    str(tmp_path),
                    "--baseline-existing",
                    "--baseline-through",
                    runner.LEDGER_FILENAME,
                    "--dry-run",
                ]
            )
            == 0
        )

    def test_runner_refuses_admin_url_that_cannot_bypass_rls(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        (tmp_path / runner.LEDGER_FILENAME).write_text("SELECT 1;\n")

        class FakeConn:
            def __enter__(self) -> "FakeConn":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def commit(self) -> None:
                return None

        class FakeEngine:
            def connect(self) -> FakeConn:
                return FakeConn()

        monkeypatch.setenv("DATABASE_ADMIN_URL", "postgresql://ddl_role:secret@postgres:5432/wims")
        monkeypatch.setattr(runner, "create_admin_engine", lambda _url: FakeEngine())
        monkeypatch.setattr(runner, "current_user_can_bypass_rls", lambda _conn: False)

        with pytest.raises(runner.MigrationError, match="BYPASSRLS"):
            runner.main(
                [
                    "--dir",
                    str(tmp_path),
                    "--baseline-existing",
                    "--baseline-through",
                    runner.LEDGER_FILENAME,
                    "--dry-run",
                ]
            )

    def test_deploy_workflow_uses_runner_not_direct_replay_loop(self) -> None:
        workflow = (_repo_root() / ".github" / "workflows" / "deploy.yml").read_text()

        assert "DEPLOY_COMMIT: ${{ github.sha }}" in workflow
        assert "ensure_static_ip_allocations" in workflow
        assert "compose run --rm --no-deps -T backend" in workflow
        assert "apply_live_migrations.py" in workflow
        assert "--dry-run" in workflow
        assert "--baseline-through 79_schema_migrations.sql" in workflow
        assert "for script in $(ls -v /opt/wims-bfp/src/postgres-init/*.sql" not in workflow
        assert "Migration failed: $script_name — continuing" not in workflow
        assert "compose up -d --build --wait --wait-timeout 600 2>/dev/null" not in workflow
        assert "src-backend-rollback:latest" in workflow
