"""Remove the retired contributor photo bonus helper.

The normalized Slice L contributor score uses a set-based aggregation in
``services/contributor.py`` and no longer calls the old
``wims.photo_bonus_for_report(INTEGER)`` SECURITY DEFINER helper. Keep the
clean-volume bootstrap aligned by pairing this revision with
``92_remove_legacy_photo_bonus_function.sql``.

Revision ID: 0013
Revises: 0012
Create Date: 2026-07-13
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS wims.photo_bonus_for_report(INTEGER)")


def downgrade() -> None:
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
