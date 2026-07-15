"""Add device-token correlation columns to wims.security_threat_logs.

Wayfinder device abuse controls (issue #568): Suricata alerts have no direct
access to device tokens (those come from the web request middleware, not
packet-level detection). These nullable columns store a best-effort
correlation from Redis telemetry (see services/suricata_ingestion.py
_correlate_device_token) so admins can see which device (if any) is linked
to a given threat log row, and how confident that link is.

Revision ID: 0018
Revises: 0017
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE wims.security_threat_logs
            ADD COLUMN IF NOT EXISTS device_token_hash TEXT,
            ADD COLUMN IF NOT EXISTS device_correlation_source TEXT,
            ADD COLUMN IF NOT EXISTS device_correlation_confidence TEXT,
            ADD COLUMN IF NOT EXISTS device_observed_at TIMESTAMPTZ;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE wims.security_threat_logs
            DROP COLUMN IF EXISTS device_token_hash,
            DROP COLUMN IF EXISTS device_correlation_source,
            DROP COLUMN IF EXISTS device_correlation_confidence,
            DROP COLUMN IF EXISTS device_observed_at;
        """
    )
