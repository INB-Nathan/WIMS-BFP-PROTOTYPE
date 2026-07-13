"""Align the civilian contributor trust-score snapshot schema.

The trust score is computed live by ``services/contributor.py``.  The persisted
row is a cache/snapshot, so it records the formula version used for the snapshot
and no longer carries the removed public-leaderboard opt-in flag.

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-12
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the service formula marker and remove the retired opt-in flag."""
    op.execute(
        "ALTER TABLE wims.civilian_contributors ADD COLUMN IF NOT EXISTS formula_version TEXT"
    )
    op.execute(
        "ALTER TABLE wims.civilian_contributors"
        " ALTER COLUMN formula_version SET DEFAULT 'reliability-v1'"
    )
    # Backfill rows from 0006 (or a partially-applied retry) before enforcing
    # the invariant required by the snapshot contract.
    op.execute(
        "UPDATE wims.civilian_contributors"
        " SET formula_version = 'reliability-v1'"
        " WHERE formula_version IS NULL"
    )
    op.execute("ALTER TABLE wims.civilian_contributors ALTER COLUMN formula_version SET NOT NULL")
    op.execute("ALTER TABLE wims.civilian_contributors DROP COLUMN IF EXISTS opt_in_leaderboard")


def downgrade() -> None:
    """Restore the 0006 leaderboard flag and remove the formula marker."""
    op.execute(
        "ALTER TABLE IF EXISTS wims.civilian_contributors"
        " ADD COLUMN IF NOT EXISTS opt_in_leaderboard BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE IF EXISTS wims.civilian_contributors DROP COLUMN IF EXISTS formula_version"
    )
