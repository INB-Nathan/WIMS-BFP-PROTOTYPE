"""Civilian photo schema: EXIF, idempotency keys

Applies migrations 83–85 (photo EXIF metadata, client_photo_id,
client_report_id) via Alembic for persistent database upgrades.
Idempotent — safe for databases that already have these columns.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-10
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Migration 83: EXIF metadata columns on wims.report_photos
    op.execute("ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS exif_gps_lat NUMERIC(10,7)")
    op.execute("ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS exif_gps_lon NUMERIC(10,7)")
    op.execute("ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS exif_gps_altitude NUMERIC")
    op.execute(
        "ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS exif_datetime_original TIMESTAMPTZ"
    )
    op.execute("ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS exif_data_source TEXT")

    # Migration 84: client_photo_id for idempotent photo retry
    op.execute("ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS client_photo_id UUID")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_report_photos_client_id"
        " ON wims.report_photos(client_photo_id)"
        " WHERE client_photo_id IS NOT NULL"
    )

    # Migration 85: client_report_id for idempotent report submission
    op.execute("ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS client_report_id UUID")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_citizen_reports_client_id"
        " ON wims.citizen_reports(client_report_id)"
        " WHERE client_report_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_citizen_reports_client_id")
    op.execute("ALTER TABLE wims.citizen_reports DROP COLUMN IF EXISTS client_report_id")
    op.execute("DROP INDEX IF EXISTS idx_report_photos_client_id")
    op.execute("ALTER TABLE wims.report_photos DROP COLUMN IF EXISTS client_photo_id")
    for col in (
        "exif_data_source",
        "exif_datetime_original",
        "exif_gps_altitude",
        "exif_gps_lon",
        "exif_gps_lat",
    ):
        op.execute(f"ALTER TABLE wims.report_photos DROP COLUMN IF EXISTS {col}")
