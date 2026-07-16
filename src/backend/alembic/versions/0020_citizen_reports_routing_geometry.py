"""Add routing_geometry column to wims.citizen_reports.

Stores the OSRM-provided GeoJSON LineString as a PostGIS geometry for real
road-network route visualization (issue #611). When OSRM is unavailable/unset
or returns no geometry, the column remains NULL (frontend falls back to
straight-line rendering).

Revision ID: 0020
Revises: 0019
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE wims.citizen_reports
            ADD COLUMN IF NOT EXISTS routing_geometry geometry(LineString, 4326);

        COMMENT ON COLUMN wims.citizen_reports.routing_geometry IS
            'OSRM road-network route geometry (GeoJSON LineString stored as PostGIS geometry). NULL when OSRM unavailable or fallback routing used.';
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE wims.citizen_reports
            DROP COLUMN IF EXISTS routing_geometry;
        """
    )
