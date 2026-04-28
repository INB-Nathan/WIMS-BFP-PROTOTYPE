"""
M1 SQL quality audit regression tests.

These tests encode the M1 infrastructure/security contracts:
- service connection role must be NOLOGIN in init scripts
- app grants must be least-privilege, not ALL TABLES
- reference geography must prevent duplicate province names per region
- RLS policies must be idempotent with DROP POLICY IF EXISTS before CREATE POLICY
- fire_incidents dashboard/validator composite index must exist
- postgres init scripts must be mounted read-only
- analytics materialized views must support REFRESH CONCURRENTLY via unique indexes
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine


SRC_ROOT = Path(__file__).resolve().parents[3]
PROJECT_ROOT = SRC_ROOT.parent
POSTGRES_INIT = SRC_ROOT / "postgres-init"
DOCKER_COMPOSE = SRC_ROOT / "docker-compose.yml"


def _sql_text(*names: str) -> str:
    return "\n".join((POSTGRES_INIT / name).read_text() for name in names)


def _get_engine() -> Engine:
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:password@localhost:5432/wims",
    )
    return create_engine(url, isolation_level="AUTOCOMMIT")


@pytest.fixture(scope="module")
def engine() -> Engine:
    return _get_engine()


@pytest.fixture
def live_conn(engine):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            yield conn
    except Exception as exc:  # pragma: no cover - only hit without DB
        pytest.skip(f"Database unreachable: {exc}")


class TestDuplicateRoleEntries:
    def test_no_duplicate_system_admin_in_policy_clauses(self):
        sql = _sql_text("10_rls_policies.sql")
        duplicate_pattern = re.compile(
            r"IN\s*\([^)]*'SYSTEM_ADMIN'[^)]*'SYSTEM_ADMIN'[^)]*\)",
            re.IGNORECASE | re.DOTALL,
        )
        assert not duplicate_pattern.search(sql)


class TestWimsAppRoleHardening:
    def test_wims_app_has_no_login_privilege_in_init_script(self):
        sql = _sql_text("01_extensions_roles.sql")
        role_line = next(
            (line for line in sql.splitlines() if "CREATE ROLE wims_app" in line),
            "",
        )
        assert role_line, "wims_app role must be created explicitly"
        assert "NOLOGIN" in role_line.upper()
        assert " LOGIN" not in role_line.upper()

    def test_wims_app_has_no_login_privilege(self, live_conn):
        login_enabled = live_conn.execute(
            text("SELECT rolcanlogin FROM pg_roles WHERE rolname = 'wims_app'")
        ).scalar_one_or_none()
        assert login_enabled is False

    def test_wims_app_grants_are_minimal_in_init_scripts(self):
        sql = _sql_text(
            "10_rls_policies.sql", "11_analytics_facts.sql", "13_export_reports.sql"
        )
        assert (
            "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wims TO wims_app"
            not in sql
        )
        assert "GRANT ALL" not in sql.upper()
        assert (
            "GRANT INSERT, UPDATE ON wims.analytics_incident_facts TO wims_app" in sql
        )

    def test_wims_app_grants_are_minimal(self, live_conn):
        rows = live_conn.execute(
            text(
                """
                SELECT table_name, privilege_type
                FROM information_schema.table_privileges
                WHERE table_schema = 'wims'
                  AND grantee = 'wims_app'
                  AND table_name IN ('scheduled_reports', 'analytics_export_log')
                ORDER BY table_name, privilege_type
                """
            )
        ).fetchall()
        assert rows == []


class TestProvinceUniqueness:
    def test_ref_provinces_has_unique_name_per_region_in_init_script(self):
        sql = _sql_text("02_ref_geography.sql")
        assert "ref_provinces_region_name_unique" in sql
        assert re.search(
            r"UNIQUE\s*\(\s*region_id\s*,\s*province_name\s*\)",
            sql,
            re.IGNORECASE,
        )

    def test_ref_provinces_has_unique_name_per_region(self, live_conn):
        exists = live_conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_constraint c
                    JOIN pg_class t ON t.oid = c.conrelid
                    JOIN pg_namespace n ON n.oid = t.relnamespace
                    WHERE n.nspname = 'wims'
                      AND t.relname = 'ref_provinces'
                      AND c.contype = 'u'
                      AND c.conname = 'ref_provinces_region_name_unique'
                )
                """
            )
        ).scalar_one()
        assert exists is True


class TestPolicyIdempotency:
    def test_all_create_policy_have_drop_preamble(self):
        sql = _sql_text("10_rls_policies.sql")
        create_pattern = re.compile(
            r"^CREATE\s+POLICY\s+(?P<name>\w+)\s+ON\s+(?P<table>[\w.]+)",
            re.IGNORECASE | re.MULTILINE,
        )
        drop_pattern = re.compile(
            r"^DROP\s+POLICY\s+IF\s+EXISTS\s+(?P<name>\w+)\s+ON\s+(?P<table>[\w.]+)",
            re.IGNORECASE | re.MULTILINE,
        )
        creates = [
            (m.group("name"), m.group("table")) for m in create_pattern.finditer(sql)
        ]
        drops = {
            (m.group("name"), m.group("table")) for m in drop_pattern.finditer(sql)
        }
        missing = [policy for policy in creates if policy not in drops]
        assert creates, "Expected CREATE POLICY statements in 10_rls_policies.sql"
        assert missing == []


class TestCompositeIndex:
    def test_fire_incidents_composite_index_exists_in_init_script(self):
        sql = _sql_text("04a_fire_incidents_composite_index.sql")
        assert "idx_fire_incidents_composite" in sql
        assert re.search(
            r"ON\s+wims\.fire_incidents\s*\(\s*region_id\s*,\s*verification_status\s*,\s*created_at\s+DESC\s*\)",
            sql,
            re.IGNORECASE | re.DOTALL,
        )

    def test_fire_incidents_composite_index_exists(self, live_conn):
        exists = live_conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_indexes
                    WHERE schemaname = 'wims'
                      AND tablename = 'fire_incidents'
                      AND indexname = 'idx_fire_incidents_composite'
                      AND indexdef ILIKE '%(region_id, verification_status, created_at DESC)%'
                )
                """
            )
        ).scalar_one()
        assert exists is True


class TestDockerReadOnlyMount:
    def test_postgres_init_mount_is_readonly(self):
        compose = DOCKER_COMPOSE.read_text()
        mount_pattern = re.compile(
            r"\.\/postgres-init:/docker-entrypoint-initdb\.d(?::\w+)?",
            re.IGNORECASE,
        )
        match = mount_pattern.search(compose)
        assert match, "postgres-init must be mounted into /docker-entrypoint-initdb.d"
        assert match.group(0).endswith(":ro")


class TestPostgresInitOrdering:
    def test_wims_schema_init_scripts_run_before_legacy_migrations(self):
        """Docker entrypoint sorts filenames lexically; base schema must run first."""
        sql_files = sorted(path.name for path in POSTGRES_INIT.glob("*.sql"))
        assert "01_extensions_roles.sql" in sql_files
        assert "15_validator_workflow.sql" in sql_files
        assert "16_fix_ivh_legacy.sql" in sql_files
        assert "002_validator_workflow.sql" not in sql_files
        assert "002a_fix_ivh_legacy.sql" not in sql_files
        assert sql_files.index("01_extensions_roles.sql") < sql_files.index(
            "15_validator_workflow.sql"
        )
        assert sql_files.index("14_seed_ncr.sql") < sql_files.index(
            "15_validator_workflow.sql"
        )
        assert sql_files.index("15_validator_workflow.sql") < sql_files.index(
            "16_fix_ivh_legacy.sql"
        )


class TestMaterializedViews:
    def test_mv_incident_counts_daily_exists(self, live_conn):
        exists = live_conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_matviews
                    WHERE schemaname = 'wims'
                      AND matviewname = 'mv_incident_counts_daily'
                )
                """
            )
        ).scalar_one()
        assert exists is True

    def test_mv_has_unique_index_for_concurrently_refresh(self, live_conn):
        mvs = live_conn.execute(
            text(
                """
                SELECT matviewname
                FROM pg_matviews
                WHERE schemaname = 'wims'
                  AND matviewname LIKE 'mv_%'
                ORDER BY matviewname
                """
            )
        ).fetchall()
        assert mvs
        for (mv_name,) in mvs:
            has_unique = live_conn.execute(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM pg_indexes i
                        JOIN pg_class c ON c.relname = i.tablename
                        JOIN pg_index ix ON ix.indexrelid = (i.schemaname || '.' || i.indexname)::regclass
                        WHERE i.schemaname = 'wims'
                          AND i.tablename = :mv_name
                          AND ix.indisunique = TRUE
                    )
                    """
                ),
                {"mv_name": mv_name},
            ).scalar_one()
            assert has_unique is True, f"{mv_name} lacks a unique index"
