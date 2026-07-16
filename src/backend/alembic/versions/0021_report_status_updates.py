"""Add report_status_updates table for validator-to-civilian status lifecycle.

Wayfinder map #630 / ticket #631: structured status update records with fixed
stage life cycle (RECEIVED → UNDER_REVIEW → HELP_DISPATCHED → ON_SCENE →
RESOLVED, plus terminals CLOSED_DUPLICATE / CLOSED_INSUFFICIENT) and
stage-specific JSONB metadata.

Revision ID: 0021
Revises: 0020 (existing citizen_reports_routing_geometry on master)
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS wims.report_status_updates (
            update_id     SERIAL PRIMARY KEY,
            report_id     INTEGER NOT NULL REFERENCES wims.citizen_reports(report_id),
            stage         VARCHAR(32) NOT NULL CHECK (
                stage IN (
                    'RECEIVED',
                    'UNDER_REVIEW',
                    'HELP_DISPATCHED',
                    'ON_SCENE',
                    'RESOLVED',
                    'CLOSED_DUPLICATE',
                    'CLOSED_INSUFFICIENT'
                )
            ),
            metadata      JSONB,
            actor_user_id UUID REFERENCES wims.users(user_id),
            created_at    TIMESTAMPTZ DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_report_status_updates_report
            ON wims.report_status_updates (report_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_report_status_updates_stage
            ON wims.report_status_updates (stage);

        CREATE INDEX IF NOT EXISTS idx_report_status_updates_actor
            ON wims.report_status_updates (actor_user_id)
            WHERE actor_user_id IS NOT NULL;

        ALTER TABLE wims.report_status_updates ENABLE ROW LEVEL SECURITY;
        ALTER TABLE wims.report_status_updates FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS report_status_updates_select ON wims.report_status_updates;
        CREATE POLICY report_status_updates_select ON wims.report_status_updates
            FOR SELECT USING (
                wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'REGIONAL_ENCODER', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN', 'ANONYMOUS')
            );

        DROP POLICY IF EXISTS report_status_updates_insert ON wims.report_status_updates;
        CREATE POLICY report_status_updates_insert ON wims.report_status_updates
            FOR INSERT WITH CHECK (
                wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'REGIONAL_ENCODER', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN')
            );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS wims.report_status_updates;
        """
    )
