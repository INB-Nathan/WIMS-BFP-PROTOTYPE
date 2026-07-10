"""Catch up civilian contributor schema (migrations 80-81)

Applies the missing civilian contributor schema patches that were only
run via postgres-init (fresh databases) or the disabled startup handler.

- Migration 80: anonymous_sessions table, report_tracking_tokens table
- Migration 81: routing columns + contributor_user_id + anonymous_session_id
  on citizen_reports, tightened ANONYMOUS SELECT policy

Idempotent — safe for databases that already have these objects.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-10
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _migration_80_anonymous_sessions() -> None:
    """CREATE TABLE IF NOT EXISTS + RLS for anonymous_sessions (migration 80)."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS wims.anonymous_sessions (
            anonymous_session_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            token_hash             TEXT NOT NULL UNIQUE,
            device_id_hash         TEXT,
            last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at             TIMESTAMPTZ NOT NULL DEFAULT now() + interval '90 days',
            created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_anonymous_sessions_expires"
        " ON wims.anonymous_sessions(expires_at)"
    )
    op.execute("ALTER TABLE wims.anonymous_sessions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE wims.anonymous_sessions FORCE ROW LEVEL SECURITY")

    op.execute("DROP POLICY IF EXISTS anonymous_sessions_select ON wims.anonymous_sessions")
    op.execute(
        "CREATE POLICY anonymous_sessions_select"
        " ON wims.anonymous_sessions FOR SELECT"
        " USING (wims.current_user_role() = 'SYSTEM_ADMIN')"
    )
    op.execute("DROP POLICY IF EXISTS anonymous_sessions_insert ON wims.anonymous_sessions")
    op.execute(
        "CREATE POLICY anonymous_sessions_insert"
        " ON wims.anonymous_sessions FOR INSERT"
        " WITH CHECK (TRUE)"
    )
    op.execute("DROP POLICY IF EXISTS anonymous_sessions_update ON wims.anonymous_sessions")
    op.execute(
        "CREATE POLICY anonymous_sessions_update"
        " ON wims.anonymous_sessions FOR UPDATE"
        " USING (wims.current_user_role() = 'SYSTEM_ADMIN')"
        " WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN')"
    )
    op.execute("DROP POLICY IF EXISTS anonymous_sessions_delete ON wims.anonymous_sessions")
    op.execute(
        "CREATE POLICY anonymous_sessions_delete"
        " ON wims.anonymous_sessions FOR DELETE"
        " USING (wims.current_user_role() = 'SYSTEM_ADMIN')"
    )


def _migration_80_tracking_tokens() -> None:
    """report_tracking_tokens table (migration 80)."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS wims.report_tracking_tokens (
            tracking_token_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id              INTEGER NOT NULL REFERENCES wims.citizen_reports(report_id) ON DELETE CASCADE,
            token_hash             TEXT NOT NULL UNIQUE,
            expires_at             TIMESTAMPTZ NOT NULL DEFAULT now() + interval '90 days',
            created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracking_tokens_report"
        " ON wims.report_tracking_tokens(report_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracking_tokens_expires"
        " ON wims.report_tracking_tokens(expires_at)"
    )
    op.execute("ALTER TABLE wims.report_tracking_tokens ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE wims.report_tracking_tokens FORCE ROW LEVEL SECURITY")

    for pol_name, action, extra in [
        (
            "tracking_tokens_select",
            "SELECT",
            "USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'CIVILIAN_REPORTER', 'ANONYMOUS'))",
        ),
        ("tracking_tokens_insert", "INSERT", "WITH CHECK (TRUE)"),
        (
            "tracking_tokens_update",
            "UPDATE",
            "USING (wims.current_user_role() = 'SYSTEM_ADMIN') WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN')",
        ),
        ("tracking_tokens_delete", "DELETE", "USING (wims.current_user_role() = 'SYSTEM_ADMIN')"),
    ]:
        op.execute(f"DROP POLICY IF EXISTS {pol_name} ON wims.report_tracking_tokens")
        op.execute(f"CREATE POLICY {pol_name} ON wims.report_tracking_tokens FOR {action} {extra}")

    # Grant
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON wims.report_tracking_tokens TO wims_app")
    op.execute("GRANT USAGE ON ALL SEQUENCES IN SCHEMA wims TO wims_app")


def _migration_81_routing_columns() -> None:
    """Routing + contributor columns on citizen_reports (migration 81)."""
    op.execute("ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_distance_m FLOAT")
    op.execute("ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_duration_s FLOAT")
    op.execute("ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_data_source TEXT")
    op.execute(
        "ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_execution_path TEXT"
    )
    op.execute(
        "ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_candidate_count INTEGER"
    )
    op.execute(
        "ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_updated_at TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS"
        " contributor_user_id UUID REFERENCES wims.users(user_id)"
    )
    op.execute(
        "ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS"
        " anonymous_session_id UUID REFERENCES wims.anonymous_sessions(anonymous_session_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_citizen_reports_contributor"
        " ON wims.citizen_reports(contributor_user_id)"
        " WHERE contributor_user_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_citizen_reports_anonymous_session"
        " ON wims.citizen_reports(anonymous_session_id)"
        " WHERE anonymous_session_id IS NOT NULL"
    )

    # Tighten ANONYMOUS SELECT policy (migration 81)
    op.execute("DROP POLICY IF EXISTS citizen_reports_select ON wims.citizen_reports")
    op.execute(
        "CREATE POLICY citizen_reports_select"
        " ON wims.citizen_reports FOR SELECT USING ("
        "   wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_VALIDATOR')"
        "   OR ("
        "       wims.current_user_role() = 'ANONYMOUS'"
        "       AND contributor_user_id IS NULL"
        "   )"
        "   OR ("
        "       wims.current_user_role() = 'CIVILIAN_REPORTER'"
        "       AND contributor_user_id = wims.current_user_uuid()"
        "   )"
        ")"
    )


def upgrade() -> None:
    _migration_80_anonymous_sessions()
    _migration_80_tracking_tokens()
    _migration_81_routing_columns()


def downgrade() -> None:
    # Best-effort reversal — may not restore exact pre-migration state.
    op.execute("DROP POLICY IF EXISTS citizen_reports_select ON wims.citizen_reports")
    op.execute("DROP INDEX IF EXISTS idx_citizen_reports_anonymous_session")
    op.execute("DROP INDEX IF EXISTS idx_citizen_reports_contributor")
    for col in (
        "anonymous_session_id",
        "contributor_user_id",
        "routing_updated_at",
        "routing_candidate_count",
        "routing_execution_path",
        "routing_data_source",
        "routing_duration_s",
        "routing_distance_m",
    ):
        op.execute(f"ALTER TABLE wims.citizen_reports DROP COLUMN IF EXISTS {col}")
    op.execute("DROP TABLE IF EXISTS wims.report_tracking_tokens CASCADE")
    op.execute("DROP TABLE IF EXISTS wims.anonymous_sessions CASCADE")
