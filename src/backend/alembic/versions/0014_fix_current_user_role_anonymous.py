"""Fix wims.current_user_role() to return 'ANONYMOUS' when no GUC is set.

The function originally used COALESCE inside a FROM-clause subquery.
When current_user_uuid() returns NULL (no GUC set), the WHERE clause
eliminates all rows and the SELECT returns 0 rows — COALESCE never
evaluates and the function returns NULL.

This broke the anonymous INSERT path in report_photos RLS policies
(which check ``current_user_role() = 'ANONYMOUS'``) and made live RLS
integration tests fail on the anonymous-owned-device INSERT case.

Fix: wrap the subquery in scalar context so that a no-match returns NULL,
allowing COALESCE to return the 'ANONYMOUS' sentinel as originally intended.

Revision ID: 0014
Revises: 0013
Create Date: 2026-07-13
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION wims.current_user_role()
        RETURNS text
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        AS $$
          SELECT COALESCE(
            (SELECT u.role FROM wims.users u WHERE u.user_id = wims.current_user_uuid() AND u.is_active = TRUE),
            'ANONYMOUS'::text
          )
        $$
        """
    )


def downgrade() -> None:
    # Restore the original FROM-clause form that returns NULL when no GUC is set.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION wims.current_user_role()
        RETURNS text
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        AS $$
          SELECT COALESCE(
            u.role,
            'ANONYMOUS'::text
          )
          FROM wims.users u
          WHERE u.user_id = wims.current_user_uuid()
            AND u.is_active = TRUE
        $$
        """
    )
