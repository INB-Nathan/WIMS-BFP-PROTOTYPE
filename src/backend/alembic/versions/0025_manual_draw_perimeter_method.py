"""Allow the production manual-draw perimeter method.

Revision ID: 0025
Revises: 0024
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0025"
down_revision: Union[str, None] = "0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_BASE_METHODS = """
    'GPS-Driven', 'GPS-Flight', 'GPS-Walked', 'GPS-Walked/Driven',
    'GPS-Unknown', 'Hand-Sketch', 'Digitized-Image', 'Digitized-Topo',
    'Digitized-Other', 'Image-Interpretation', 'Infrared-Image', 'Modeled',
    'Mixed-Methods', 'Remote-Sensing-Derived', 'Survey/GCDB/Cadastral',
    'Vector', 'Phone/Tablet', 'Other'
"""


def _replace_constraint(methods: str) -> None:
    op.execute(
        f"""
        ALTER TABLE wims.fire_incident_perimeters
            DROP CONSTRAINT IF EXISTS fire_incident_perimeters_map_method_check;
        ALTER TABLE wims.fire_incident_perimeters
            ADD CONSTRAINT fire_incident_perimeters_map_method_check
            CHECK (map_method IN ({methods}));
        """
    )


def upgrade() -> None:
    _replace_constraint("'MANUAL_DRAW', " + _BASE_METHODS)


def downgrade() -> None:
    _replace_constraint(_BASE_METHODS)
