"""Add requires_review flag to wims.citizen_reports.

Wayfinder device abuse controls (issue #572): a civilian submission from a
device that has crossed the Tier-3 quarantine threshold (utils/device_abuse.py
check_device_abuse) is still accepted (never hard-blocked) but flagged for
mandatory validator review rather than the normal triage path.

Revision ID: 0019
Revises: 0018
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE wims.citizen_reports
            ADD COLUMN IF NOT EXISTS requires_review BOOLEAN NOT NULL DEFAULT false;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE wims.citizen_reports
            DROP COLUMN IF EXISTS requires_review;
        """
    )
