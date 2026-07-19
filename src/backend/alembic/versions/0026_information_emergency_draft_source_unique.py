"""Ensure one unpublished emergency draft per source incident.

Revision ID: 0026
Revises: 0025
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0026"
down_revision: Union[str, None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_information_emergencies_unpublished_source_incident
            ON wims.information_emergencies (promoted_from_incident_id)
            WHERE promoted_from_incident_id IS NOT NULL AND published = FALSE
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX wims.uq_information_emergencies_unpublished_source_incident")
