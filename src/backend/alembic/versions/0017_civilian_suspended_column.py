"""Add suspended flag to wims.civilian_contributors.

Admin/validator backend (issues #576/#577/#578): SYSTEM_ADMIN can suspend or
activate civilian contributors. This flag lives on the contributor snapshot row
and is the source of truth for the civilian's `active`/`suspended` status in the
admin list.

Revision ID: 0017
Revises: 0016
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # IF NOT EXISTS keeps this safe when the row was already created by the
    # baseline bootstrap (postgres-init/86_civilian_contributor_snapshot.sql),
    # which also adds the column. Both upgrade paths must converge.
    op.execute(
        """
        ALTER TABLE wims.civilian_contributors
            ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT false;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE wims.civilian_contributors
            DROP COLUMN IF EXISTS suspended;
        """
    )
