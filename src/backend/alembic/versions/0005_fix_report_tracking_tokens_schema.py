"""Fix report_tracking_tokens schema for databases that ran the initial 0004

The initial 0004 migration (d96dc592) created report_tracking_tokens with
UUID PRIMARY KEY and missing columns: token_type, is_active, revoked_at,
regenerated_from_id. This migration applies ALTER corrections to bring the
table into alignment with the canonical schema from postgres-init SQL 80.

Fresh databases that ran the corrected 0004 are unaffected (all operations
use IF NOT EXISTS / IF EXISTS).

Changes applied:
- Add missing columns: token_type, is_active, revoked_at, regenerated_from_id
- Drop NOT NULL on expires_at (should be NULLable per canonical schema)
- Drop UNIQUE constraint on token_hash (should be plain TEXT)
- Replace idx_tracking_tokens_expires with idx_tracking_tokens_hash
- Add idx_uq_active_token_per_report partial unique index
- Revise RLS policies to match canonical (SYSTEM_ADMIN, NATIONAL_VALIDATOR,
  NATIONAL_ANALYST for SELECT; SYSTEM_ADMIN, NATIONAL_VALIDATOR for UPDATE)
- Add GRANT on anonymous_sessions (missing from initial 0004)
- Add validate_tracking_token SECURITY DEFINER function (missing from initial 0004)

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-11
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _fix_report_tracking_tokens_columns() -> None:
    """Add missing columns and adjust constraints."""
    # Add extra columns (no-op if already present from corrected 0004)
    op.execute(
        "ALTER TABLE wims.report_tracking_tokens"
        " ADD COLUMN IF NOT EXISTS token_type TEXT"
        " NOT NULL DEFAULT 'public'"
    )
    op.execute(
        "ALTER TABLE wims.report_tracking_tokens"
        " ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE"
    )
    op.execute(
        "ALTER TABLE wims.report_tracking_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE wims.report_tracking_tokens"
        " ADD COLUMN IF NOT EXISTS regenerated_from_id BIGINT"
        " REFERENCES wims.report_tracking_tokens(tracking_token_id)"
    )
    # expires_at should be NULLable — drop NOT NULL if it was set
    op.execute("ALTER TABLE wims.report_tracking_tokens ALTER COLUMN expires_at DROP NOT NULL")
    # Drop UNIQUE constraint on token_hash if it exists (initial 0004 had UNIQUE)
    op.execute(
        """
        DO $$
        DECLARE
            cons_name TEXT;
        BEGIN
            SELECT conname INTO cons_name FROM pg_constraint
            WHERE conrelid = 'wims.report_tracking_tokens'::regclass
              AND contype = 'u'
              AND conkey = (
                  SELECT array_agg(attnum) FROM pg_attribute
                  WHERE attrelid = 'wims.report_tracking_tokens'::regclass
                    AND attname = 'token_hash'
              );
            IF cons_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE wims.report_tracking_tokens DROP CONSTRAINT IF EXISTS '
                        || cons_name;
            END IF;
        END $$;
        """
    )


def _fix_report_tracking_tokens_indexes() -> None:
    """Replace the expires index with the active-token hash index."""
    op.execute("DROP INDEX IF EXISTS idx_tracking_tokens_expires")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_active_token_per_report"
        " ON wims.report_tracking_tokens(report_id) WHERE is_active = TRUE"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracking_tokens_hash"
        " ON wims.report_tracking_tokens(token_hash) WHERE is_active = TRUE"
    )


def _fix_report_tracking_tokens_rls() -> None:
    """Re-apply RLS policies (idempotent — overrides buggy 0004 policies)."""
    op.execute("ALTER TABLE wims.report_tracking_tokens ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE wims.report_tracking_tokens FORCE ROW LEVEL SECURITY")

    for pol_name, action, extra in [
        (
            "tracking_tokens_select",
            "SELECT",
            "USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST'))",
        ),
        ("tracking_tokens_insert", "INSERT", "WITH CHECK (TRUE)"),
        (
            "tracking_tokens_update",
            "UPDATE",
            "USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR'))"
            " WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR'))",
        ),
        ("tracking_tokens_delete", "DELETE", "USING (wims.current_user_role() = 'SYSTEM_ADMIN')"),
    ]:
        op.execute(f"DROP POLICY IF EXISTS {pol_name} ON wims.report_tracking_tokens")
        op.execute(f"CREATE POLICY {pol_name} ON wims.report_tracking_tokens FOR {action} {extra}")


def _fix_anonymous_sessions_grant() -> None:
    """Add missing GRANT on anonymous_sessions (missing from initial 0004)."""
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON wims.anonymous_sessions TO wims_app")


def _fix_validate_tracking_token_function() -> None:
    """Create validate_tracking_token SECURITY DEFINER function (missing from initial 0004)."""
    op.execute(
        """
        CREATE OR REPLACE FUNCTION wims.validate_tracking_token(
            p_report_id INTEGER,
            p_token_hash TEXT
        )
        RETURNS BOOLEAN
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = wims, pg_temp
        AS $$
            SELECT EXISTS (
                SELECT 1
                FROM wims.report_tracking_tokens
                WHERE report_id = p_report_id
                  AND token_hash = p_token_hash
                  AND is_active = TRUE
                  AND revoked_at IS NULL
                  AND (expires_at IS NULL OR expires_at > now())
            );
        $$;
        """
    )
    op.execute("REVOKE ALL ON FUNCTION wims.validate_tracking_token(INTEGER, TEXT) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION wims.validate_tracking_token(INTEGER, TEXT) TO wims_app")


def upgrade() -> None:
    _fix_report_tracking_tokens_columns()
    _fix_report_tracking_tokens_indexes()
    _fix_report_tracking_tokens_rls()
    _fix_anonymous_sessions_grant()
    _fix_validate_tracking_token_function()


def downgrade() -> None:
    # Best-effort reversal — drops function and extra columns.
    op.execute("DROP FUNCTION IF EXISTS wims.validate_tracking_token(INTEGER, TEXT) CASCADE")
    op.execute("DROP INDEX IF EXISTS idx_tracking_tokens_hash")
    op.execute("DROP INDEX IF EXISTS idx_uq_active_token_per_report")
    for col in ("regenerated_from_id", "revoked_at", "is_active", "token_type"):
        op.execute(f"ALTER TABLE wims.report_tracking_tokens DROP COLUMN IF EXISTS {col}")
