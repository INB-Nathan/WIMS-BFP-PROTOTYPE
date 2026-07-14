"""Add dpa_consented_at column to wims.civilian_contributors.

Adds a nullable TIMESTAMPTZ column to track when a civilian contributor
has consented to the Data Privacy Act (DPA/RA 10173) acknowledgement
during self-service registration.

The column is intentionally nullable:
  - NULL  → consent not yet given (legacy rows, or registration without consent)
  - value → timestamp of explicit DPA consent

No RLS changes needed — CIVILIAN_REPORTER and admin roles already have
SELECT/UPDATE access to civilian_contributors via existing policies.

Revision ID: 0015
Revises: 0014
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE wims.civilian_contributors "
        "ADD COLUMN IF NOT EXISTS dpa_consented_at TIMESTAMPTZ DEFAULT NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE wims.civilian_contributors DROP COLUMN IF EXISTS dpa_consented_at")
