"""Add the persistent device-blocklist schema.

Revision ID: 0027
Revises: 0026
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS wims.device_blocklist (
            block_id                SERIAL PRIMARY KEY,
            device_token_hash       TEXT NOT NULL,
            blocked_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at              TIMESTAMPTZ,
            is_permanent            BOOLEAN NOT NULL DEFAULT false,
            blocked_by              UUID,
            block_reason            TEXT,
            threat_log_id           INTEGER,
            user_agent              TEXT,
            authenticated_user_id   UUID,
            is_active               BOOLEAN NOT NULL DEFAULT true
        );

        CREATE INDEX IF NOT EXISTS idx_device_blocklist_hash
            ON wims.device_blocklist(device_token_hash);
        CREATE INDEX IF NOT EXISTS idx_device_blocklist_active
            ON wims.device_blocklist(is_active) WHERE is_active = true;

        ALTER TABLE wims.device_blocklist ENABLE ROW LEVEL SECURITY;
        ALTER TABLE wims.device_blocklist FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS device_blocklist_admin_all ON wims.device_blocklist;
        CREATE POLICY device_blocklist_admin_all ON wims.device_blocklist
            FOR ALL
            USING (wims.current_user_role() IN ('SYSTEM_ADMIN'))
            WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN'));

        INSERT INTO wims.system_config (config_key, config_value, description)
        VALUES (
            'device_blocklist.repeat_offender_threshold',
            '3',
            'Number of distinct block episodes for a device token before it is marked permanent (confirmed attacker/bot).'
        )
        ON CONFLICT (config_key) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS wims.device_blocklist")
