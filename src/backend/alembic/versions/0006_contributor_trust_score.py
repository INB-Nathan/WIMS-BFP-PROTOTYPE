"""Add civilian_contributors table and photo_bonus_for_report SECURITY DEFINER function.

Creates the ``wims.civilian_contributors`` table (idempotent — IF NOT EXISTS)
that stores trust score snapshots, badge level, and leaderboard opt-in for
registered civilian contributors.

Creates the ``wims.photo_bonus_for_report(INTEGER)`` SECURITY DEFINER function
that bypasses RLS to count photos with GPS consensus and proximity for a given
report. Called by the Python trust score engine per report.

The table and function together support the live compute trust score engine
defined in ``services/contributor.py`` (§6 of the Civilian Contributor
Enhancement spec).

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-11
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _create_civilian_contributors_table() -> None:
    """Create wims.civilian_contributors if it does not already exist.

    The table stores a trust score snapshot, current badge, and
    leaderboard opt-in for each registered contributor.  The trust score
    is updated by the application on read (live compute) and optionally
    persisted as a write-through cache.

    Columns:
        user_id            PK / FK → wims.users(user_id)
        trust_score        INTEGER 0-100 (cached snapshot, live computed)
        badge              TEXT (denormalised from trust score range)
        opt_in_leaderboard BOOLEAN default FALSE — must opt in to appear
        created_at         TIMESTAMPTZ
        updated_at         TIMESTAMPTZ — bumped on profile read
    """
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS wims.civilian_contributors (
            user_id             UUID        NOT NULL PRIMARY KEY
                                    REFERENCES wims.users(user_id)
                                    ON DELETE CASCADE,
            trust_score         INTEGER     NOT NULL DEFAULT 0
                                    CHECK (trust_score >= 0 AND trust_score <= 100),
            badge               TEXT        NOT NULL DEFAULT 'NOVICE'
                                    CHECK (badge IN ('NOVICE', 'REGULAR', 'TRUSTED', 'GUARDIAN')),
            opt_in_leaderboard  BOOLEAN     NOT NULL DEFAULT FALSE,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # ── RLS ───────────────────────────────────────────────────────────────
    op.execute("ALTER TABLE wims.civilian_contributors ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE wims.civilian_contributors FORCE ROW LEVEL SECURITY")

    # CIVILIAN_REPORTER: see own row, update own row
    op.execute("DROP POLICY IF EXISTS civilian_contributors_select ON wims.civilian_contributors")
    op.execute(
        "CREATE POLICY civilian_contributors_select"
        " ON wims.civilian_contributors FOR SELECT"
        " USING ("
        "   wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST')"
        "   OR wims.current_user_role() = 'CIVILIAN_REPORTER'"
        ")"
    )

    op.execute("DROP POLICY IF EXISTS civilian_contributors_insert ON wims.civilian_contributors")
    op.execute(
        "CREATE POLICY civilian_contributors_insert"
        " ON wims.civilian_contributors FOR INSERT"
        " WITH CHECK (wims.current_user_role() = 'CIVILIAN_REPORTER')"
    )

    op.execute("DROP POLICY IF EXISTS civilian_contributors_update ON wims.civilian_contributors")
    op.execute(
        "CREATE POLICY civilian_contributors_update"
        " ON wims.civilian_contributors FOR UPDATE"
        " USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'CIVILIAN_REPORTER'))"
        " WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN', 'CIVILIAN_REPORTER'))"
    )

    op.execute("DROP POLICY IF EXISTS civilian_contributors_delete ON wims.civilian_contributors")
    op.execute(
        "CREATE POLICY civilian_contributors_delete"
        " ON wims.civilian_contributors FOR DELETE"
        " USING (wims.current_user_role() = 'SYSTEM_ADMIN')"
    )

    # ── Grants ────────────────────────────────────────────────────────────
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON wims.civilian_contributors TO wims_app")


def _create_photo_bonus_function() -> None:
    """Create wims.photo_bonus_for_report(INTEGER) SECURITY DEFINER function.

    Bypasses RLS to count photos with verified GPS consensus and proximity.

    Returns INTEGER:
        (photo_count_with_both_match_consensus * 2)
        + (1 if any photo has photo_reported_distance_m < 50 else 0)

    This is called by the Python trust score engine for each of a
    contributor's root reports.  The aggregation happens application-side.

    ``SET search_path = wims, pg_temp`` prevents search-path injection.
    """
    op.execute(
        """
        CREATE OR REPLACE FUNCTION wims.photo_bonus_for_report(
            p_report_id INTEGER
        )
        RETURNS INTEGER
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = wims, pg_temp
        AS $$
            WITH photo_stats AS (
                SELECT
                    COUNT(*) FILTER (
                        WHERE gps_consensus = 'both_match'
                    ) AS agreed_photo_count,
                    BOOL_OR(
                        photo_reported_distance_m IS NOT NULL
                        AND photo_reported_distance_m < 50
                    ) AS has_close_photo
                FROM wims.report_photos
                WHERE report_id = p_report_id
            )
            SELECT
                (agreed_photo_count * 2)
                + CASE WHEN has_close_photo THEN 1 ELSE 0 END
            FROM photo_stats
        $$;
        """
    )
    op.execute("REVOKE ALL ON FUNCTION wims.photo_bonus_for_report(INTEGER) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION wims.photo_bonus_for_report(INTEGER) TO wims_app")


def _ensure_report_photos_gps_columns() -> None:
    """Add the GPS-consensus columns to wims.report_photos.

    These columns are created by postgres-init/82_civilian_report_photos.sql
    for fresh databases, but were never added to the Alembic chain. A
    database migrated purely via ``alembic upgrade`` therefore lacks them,
    which breaks both the photo_bonus_for_report function below and the
    civilian photo service INSERT. Definitions mirror the SQL-init CHECK
    constraints.
    """
    op.execute(
        "ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS "
        "exif_gps_status TEXT NOT NULL DEFAULT 'unavailable' "
        "CHECK (exif_gps_status IN ('present', 'unavailable'))"
    )
    op.execute(
        "ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS "
        "browser_gps_status TEXT NOT NULL DEFAULT 'unavailable' "
        "CHECK (browser_gps_status IN ('present', 'unavailable'))"
    )
    op.execute(
        "ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS "
        "gps_consensus TEXT CHECK (gps_consensus IN "
        "('both_match', 'both_disagree', 'exif_only', 'browser_only', 'unavailable'))"
    )
    op.execute(
        "ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS "
        "exif_to_report_distance_m FLOAT "
        "CHECK (exif_to_report_distance_m IS NULL OR exif_to_report_distance_m >= 0)"
    )
    op.execute(
        "ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS "
        "browser_to_report_distance_m FLOAT "
        "CHECK (browser_to_report_distance_m IS NULL OR browser_to_report_distance_m >= 0)"
    )
    op.execute(
        "ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS "
        "photo_reported_distance_m FLOAT "
        "CHECK (photo_reported_distance_m IS NULL OR photo_reported_distance_m >= 0)"
    )


def _drop_report_photos_gps_columns() -> None:
    """Reverse of _ensure_report_photos_gps_columns (best-effort)."""
    for col in (
        "photo_reported_distance_m",
        "browser_to_report_distance_m",
        "exif_to_report_distance_m",
        "gps_consensus",
        "browser_gps_status",
        "exif_gps_status",
    ):
        op.execute(f"ALTER TABLE wims.report_photos DROP COLUMN IF EXISTS {col}")


def upgrade() -> None:
    _create_civilian_contributors_table()
    _ensure_report_photos_gps_columns()
    _create_photo_bonus_function()


def downgrade() -> None:
    # Best-effort reversal
    op.execute("DROP FUNCTION IF EXISTS wims.photo_bonus_for_report(INTEGER) CASCADE")
    op.execute("DROP TABLE IF EXISTS wims.civilian_contributors CASCADE")
    _drop_report_photos_gps_columns()
