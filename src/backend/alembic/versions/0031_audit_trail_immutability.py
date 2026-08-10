"""Restore append-only enforcement on the partitioned system_audit_trails.

GH #732: migration 17 created ``no_update_audit`` / ``no_delete_audit`` RULES,
but 72_partition_audit_trail.sql replaced the plain table with a range-
partitioned parent and dropped the backup table (and with it both rules).
PostgreSQL rules cannot enforce on partitions, so existing databases that
already converged on the partitioned schema are mutable by any principal that
bypasses RLS (e.g. superuser maintenance paths).

This revision installs the canonical parent-level protection: BEFORE
UPDATE/DELETE row triggers on ``wims.system_audit_trails`` that raise an error
(SQLSTATE 55000), cloned onto every existing partition and automatically
applied to partitions created later. The DDL is read from the same canonical
file used by the clean bootstrap (``postgres-init/100_audit_trail_immutability.sql``)
so both schema paths stay aligned.

Revision ID: 0031
Revises: 0030
Create Date: 2026-07-21
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0031"
down_revision: Union[str, None] = "0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.migration.0031")

_IMMUTABILITY_SQL_FILE = "100_audit_trail_immutability.sql"


def _get_sql_dir() -> Path:
    """Resolve the ``postgres-init`` directory (same contract as revision 0001)."""
    env_dir = os.environ.get("POSTGRES_INIT_DIR")
    if env_dir:
        return Path(env_dir).resolve()

    # alembic/versions/0031_audit_trail_immutability.py ->
    # alembic/versions/ -> alembic/ -> backend/ -> src/ -> postgres-init/
    return Path(__file__).resolve().parents[3] / "postgres-init"


def _strip_sql_transaction_wrapper(sql: str) -> str:
    """Strip BEGIN;/COMMIT; so DDL runs inside Alembic's own transaction."""
    lines = []
    for line in sql.splitlines():
        normalized = line.strip().upper()
        if normalized in {"BEGIN;", "COMMIT;"}:
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def upgrade() -> None:
    """Install the append-only triggers on the final system_audit_trails schema."""
    connection = op.get_bind()
    exists = connection.execute(
        text("SELECT to_regclass('wims.system_audit_trails') IS NOT NULL")
    ).scalar()
    if not exists:
        logger.warning(
            "wims.system_audit_trails does not exist — skipping append-only trigger install"
        )
        return

    sql_dir = _get_sql_dir()
    sql_file = sql_dir / _IMMUTABILITY_SQL_FILE
    if not sql_file.is_file():
        raise FileNotFoundError(
            f"Canonical immutability SQL not found at {sql_file}. "
            "Set POSTGRES_INIT_DIR to point at the postgres-init directory."
        )

    raw = sql_file.read_text(encoding="utf-8").strip()
    sql = _strip_sql_transaction_wrapper(raw)
    if not sql:
        raise RuntimeError(f"{_IMMUTABILITY_SQL_FILE} is empty after stripping wrappers")

    op.execute(text(sql))
    logger.info("Append-only UPDATE/DELETE triggers installed on wims.system_audit_trails")


def downgrade() -> None:
    """Drop the append-only UPDATE/DELETE triggers.

    WARNING: this removes the only superuser-resistant append-only enforcement
    on ``wims.system_audit_trails`` and returns the partitioned audit trail to
    the pre-#732 (unprotected) state: any principal that bypasses RLS (e.g. a
    superuser maintenance path) can UPDATE or DELETE audit rows again. Run only
    when the audit trail is intentionally allowed to become mutable.
    """
    connection = op.get_bind()
    exists = connection.execute(
        text("SELECT to_regclass('wims.system_audit_trails') IS NOT NULL")
    ).scalar()
    if not exists:
        logger.warning("wims.system_audit_trails does not exist — nothing to drop")
        return

    op.execute(
        text("DROP TRIGGER IF EXISTS trg_audit_trails_no_update ON wims.system_audit_trails")
    )
    op.execute(
        text("DROP TRIGGER IF EXISTS trg_audit_trails_no_delete ON wims.system_audit_trails")
    )
    # The trigger function is shared and harmless; keep it so a later upgrade
    # can recreate the triggers without redefining the function.
    logger.warning(
        "Append-only UPDATE/DELETE triggers dropped from wims.system_audit_trails "
        "(downgrade) — append-only enforcement is removed and the partitioned "
        "audit trail is mutable to any principal that bypasses RLS"
    )
