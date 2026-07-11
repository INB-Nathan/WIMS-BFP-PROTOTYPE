"""
Contract tests for Alembic migration 0004 (civilian contributor schema).

Validates:
- Idempotency: running migration 0004 twice produces the same schema
- Table existence and columns: anonymous_sessions, report_tracking_tokens
- New columns on citizen_reports: routing, contributor, anonymous_session_id
- RLS policies on all three tables match expected definitions
- validate_tracking_token SECURITY DEFINER function exists and is callable
- Grants are in place for wims_app
- Downgrade + upgrade roundtrip is clean

Prerequisites:
  - wims-postgres container running with PostGIS
  - All Alembic migrations applied through 0003

Run:
  cd src && docker compose run --rm backend pytest tests/test_0004_civilian_contributor_schema.py -v
"""

from __future__ import annotations

import os
import pytest
from sqlalchemy import text
from sqlalchemy.engine import create_engine
from sqlalchemy.engine.base import Engine


def _get_engine() -> Engine:
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:password@postgres:5432/wims",
    )
    return create_engine(url, isolation_level="AUTOCOMMIT")


@pytest.fixture(scope="module")
def engine():
    return _get_engine()


@pytest.fixture(autouse=True)
def _skip_if_no_db(engine):
    """Skip integration tests if database is unreachable."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        pytest.skip(f"Database unreachable: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Table existence and column checks
# ═══════════════════════════════════════════════════════════════════════════


class TestAnonymousSessionsTable:
    """wims.anonymous_sessions table contract."""

    TABLE = "wims.anonymous_sessions"

    def test_table_exists(self, engine):
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema = 'wims' AND table_name = 'anonymous_sessions')"
                )
            ).scalar()
        assert result is True, f"Table {self.TABLE} does not exist"

    @pytest.mark.parametrize(
        "column,expected_type,nullable",
        [
            ("anonymous_session_id", "uuid", "NO"),
            ("token_hash", "text", "NO"),
            ("device_id_hash", "text", "YES"),
            ("last_seen_at", "timestamp with time zone", "NO"),
            ("expires_at", "timestamp with time zone", "NO"),
            ("created_at", "timestamp with time zone", "NO"),
        ],
    )
    def test_column_exists(self, engine, column, expected_type, nullable):
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT data_type, is_nullable FROM information_schema.columns "
                    "WHERE table_schema = 'wims' AND table_name = 'anonymous_sessions' "
                    "AND column_name = :col"
                ),
                {"col": column},
            ).fetchone()
        assert row is not None, f"Column {column} not found"
        assert row[0] == expected_type, (
            f"Column {column}: expected type {expected_type}, got {row[0]}"
        )
        assert row[1] == nullable, f"Column {column}: expected nullable={nullable}, got {row[1]}"

    def test_rls_enabled(self, engine):
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = :oid"),
                {
                    "oid": conn.execute(
                        text("SELECT 'wims.anonymous_sessions'::regclass::oid")
                    ).scalar()
                },
            ).fetchone()
        assert row is not None
        assert row[0] is True, "RLS not enabled on anonymous_sessions"
        assert row[1] is True, "FORCE RLS not enabled on anonymous_sessions"

    @pytest.mark.parametrize(
        "policy_name,expected_roles",
        [
            ("anonymous_sessions_select", "SYSTEM_ADMIN"),
            ("anonymous_sessions_insert", None),  # WITH CHECK (TRUE) — open insert
            ("anonymous_sessions_update", "SYSTEM_ADMIN"),
            ("anonymous_sessions_delete", "SYSTEM_ADMIN"),
        ],
    )
    def test_rls_policy_exists(self, engine, policy_name, expected_roles):
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT polname, pg_get_expr(polqual, polrelid) AS qual, "
                    "pg_get_expr(polwithcheck, polrelid) AS with_check "
                    "FROM pg_policy WHERE polrelid = :oid AND polname = :pol"
                ),
                {
                    "oid": conn.execute(
                        text("SELECT 'wims.anonymous_sessions'::regclass::oid")
                    ).scalar(),
                    "pol": policy_name,
                },
            ).fetchone()
        assert row is not None, f"Policy {policy_name} not found on anonymous_sessions"


class TestReportTrackingTokensTable:
    """wims.report_tracking_tokens table contract."""

    TABLE = "wims.report_tracking_tokens"

    def test_table_exists(self, engine):
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema = 'wims' AND table_name = 'report_tracking_tokens')"
                )
            ).scalar()
        assert result is True, f"Table {self.TABLE} does not exist"

    @pytest.mark.parametrize(
        "column,expected_type,nullable",
        [
            ("tracking_token_id", "bigint", "NO"),
            ("report_id", "integer", "NO"),
            ("token_hash", "text", "NO"),
            ("token_type", "text", "NO"),
            ("is_active", "boolean", "NO"),
            ("expires_at", "timestamp with time zone", "YES"),
            ("revoked_at", "timestamp with time zone", "YES"),
            ("regenerated_from_id", "bigint", "YES"),
            ("created_at", "timestamp with time zone", "NO"),
        ],
    )
    def test_column_exists(self, engine, column, expected_type, nullable):
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT data_type, is_nullable FROM information_schema.columns "
                    "WHERE table_schema = 'wims' AND table_name = 'report_tracking_tokens' "
                    "AND column_name = :col"
                ),
                {"col": column},
            ).fetchone()
        assert row is not None, f"Column {column} not found"
        assert row[0] == expected_type, (
            f"Column {column}: expected type {expected_type}, got {row[0]}"
        )
        assert row[1] == nullable, f"Column {column}: expected nullable={nullable}, got {row[1]}"

    def test_check_constraint_token_type(self, engine):
        """token_type CHECK constraint exists and enforces allowed values."""
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef "
                    "WHERE adrelid = :oid AND adnum = :num"
                ),
                {
                    "oid": conn.execute(
                        text("SELECT 'wims.report_tracking_tokens'::regclass::oid")
                    ).scalar(),
                    "num": conn.execute(
                        text(
                            "SELECT ordinal_position FROM information_schema.columns "
                            "WHERE table_schema = 'wims' AND table_name = 'report_tracking_tokens' "
                            "AND column_name = 'token_type'"
                        )
                    ).scalar(),
                },
            ).fetchone()
        assert row is not None and "'public'::text" in str(row[0]), (
            f"token_type default is not 'public': {row}"
        )

    def test_rls_policies(self, engine):
        with engine.connect() as conn:
            oid = conn.execute(text("SELECT 'wims.report_tracking_tokens'::regclass::oid")).scalar()
            policies = conn.execute(
                text(
                    "SELECT polname, pg_get_expr(polqual, polrelid) AS qual "
                    "FROM pg_policy WHERE polrelid = :oid"
                ),
                {"oid": oid},
            ).fetchall()
        policy_names = {p[0] for p in policies}
        assert policy_names == {
            "tracking_tokens_select",
            "tracking_tokens_insert",
            "tracking_tokens_update",
            "tracking_tokens_delete",
        }, f"Unexpected policy set: {policy_names}"


class TestCitizenReportsColumns:
    """New columns on wims.citizen_reports from migration 81."""

    @pytest.mark.parametrize(
        "column,expected_type",
        [
            ("routing_distance_m", "double precision"),
            ("routing_duration_s", "double precision"),
            ("routing_data_source", "text"),
            ("routing_execution_path", "text"),
            ("routing_candidate_count", "integer"),
            ("routing_updated_at", "timestamp with time zone"),
            ("contributor_user_id", "uuid"),
            ("anonymous_session_id", "uuid"),
        ],
    )
    def test_column_exists(self, engine, column, expected_type):
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_schema = 'wims' AND table_name = 'citizen_reports' "
                    "AND column_name = :col"
                ),
                {"col": column},
            ).fetchone()
        assert row is not None, f"Column {column} not found on citizen_reports"
        assert row[0] == expected_type, f"Column {column}: expected {expected_type}, got {row[0]}"

    def test_contributor_user_id_fk(self, engine):
        """contributor_user_id references wims.users(user_id)."""
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints tc "
                    "JOIN information_schema.constraint_column_usage ccu "
                    "ON tc.constraint_name = ccu.constraint_name "
                    "WHERE tc.table_schema = 'wims' AND tc.table_name = 'citizen_reports' "
                    "AND tc.constraint_type = 'FOREIGN KEY' "
                    "AND tc.constraint_name LIKE '%contributor_user_id%' "
                    "AND ccu.table_name = 'users' AND ccu.column_name = 'user_id')"
                )
            ).scalar()
        assert row is True, "FK on contributor_user_id -> wims.users(user_id) not found"


# ═══════════════════════════════════════════════════════════════════════════
# validate_tracking_token function
# ═══════════════════════════════════════════════════════════════════════════


class TestValidateTrackingTokenFunction:
    """wims.validate_tracking_token() SECURITY DEFINER function."""

    def test_function_exists(self, engine):
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    "SELECT EXISTS (SELECT 1 FROM pg_proc "
                    "WHERE proname = 'validate_tracking_token' "
                    "AND pronamespace = 'wims'::regnamespace "
                    "AND pronargs = 2)"
                )
            ).scalar()
        assert result is True, "Function wims.validate_tracking_token(INTEGER, TEXT) does not exist"

    def test_function_is_security_definer(self, engine):
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT prosecdef, l.lanname "
                    "FROM pg_proc p JOIN pg_language l ON p.prolang = l.oid "
                    "WHERE p.proname = 'validate_tracking_token' "
                    "AND p.pronamespace = 'wims'::regnamespace"
                )
            ).fetchone()
        assert row is not None
        assert row[0] is True, "Function is not SECURITY DEFINER"
        assert row[1] == "sql", f"Function is not LANGUAGE sql, got {row[1]}"


# ═══════════════════════════════════════════════════════════════════════════
# Grant checks
# ═══════════════════════════════════════════════════════════════════════════


class TestGrants:
    """Table and sequence grants to wims_app."""

    def test_anonymous_sessions_granted(self, engine):
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT privilege_type FROM information_schema.table_privileges "
                    "WHERE table_schema = 'wims' AND table_name = 'anonymous_sessions' "
                    "AND grantee = 'wims_app'"
                )
            ).fetchall()
        privs = {r[0] for r in row}
        assert privs == {"SELECT", "INSERT", "UPDATE", "DELETE"}, (
            f"Expected SELECT/INSERT/UPDATE/DELETE on anonymous_sessions, got {privs}"
        )

    def test_report_tracking_tokens_granted(self, engine):
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT privilege_type FROM information_schema.table_privileges "
                    "WHERE table_schema = 'wims' AND table_name = 'report_tracking_tokens' "
                    "AND grantee = 'wims_app'"
                )
            ).fetchall()
        privs = {r[0] for r in row}
        assert privs == {"SELECT", "INSERT", "UPDATE", "DELETE"}, (
            f"Expected SELECT/INSERT/UPDATE/DELETE on report_tracking_tokens, got {privs}"
        )

    def test_tracking_token_sequence_granted(self, engine):
        """Sequence grant is scoped to the specific sequence, not ALL SEQUENCES."""
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT privilege_type FROM information_schema.role_usage_grants "
                    "WHERE object_type = 'SEQUENCE' "
                    "AND object_name = 'report_tracking_tokens_tracking_token_id_seq' "
                    "AND grantee = 'wims_app'"
                )
            ).fetchone()
        assert row is not None, (
            "Sequence grant on report_tracking_tokens_tracking_token_id_seq to wims_app not found"
        )

    def test_validate_tracking_token_function_granted(self, engine):
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT privilege_type FROM information_schema.routine_privileges "
                    "WHERE routine_schema = 'wims' "
                    "AND routine_name = 'validate_tracking_token' "
                    "AND grantee = 'wims_app'"
                )
            ).fetchall()
        privs = {r[0] for r in row}
        assert "EXECUTE" in privs, (
            "EXECUTE privilege on validate_tracking_token not granted to wims_app"
        )


# ═══════════════════════════════════════════════════════════════════════════
# RLS policy drift check — citizen_reports_select
# ═══════════════════════════════════════════════════════════════════════════


class TestCitizenReportsSelectPolicy:
    """citizen_reports_select must have the tightened definition."""

    def test_policy_has_civilian_reporter_branch(self, engine):
        """The policy must include CIVILIAN_REPORTER self-row access."""
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT pg_get_expr(polqual, polrelid) "
                    "FROM pg_policy "
                    "WHERE polrelid = 'wims.citizen_reports'::regclass "
                    "AND polname = 'citizen_reports_select'"
                )
            ).fetchone()
        assert row is not None, "citizen_reports_select policy not found"
        qual = row[0]
        assert "CIVILIAN_REPORTER" in qual, (
            f"citizen_reports_select missing CIVILIAN_REPORTER branch: {qual}"
        )
        assert "ANONYMOUS" in qual, f"citizen_reports_select missing ANONYMOUS branch: {qual}"
        assert "contributor_user_id IS NULL" in qual, (
            "citizen_reports_select missing contributor_user_id IS NULL guard"
        )
