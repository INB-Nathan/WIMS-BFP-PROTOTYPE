"""Baseline: initial WIMS-BFP schema from postgres-init SQL files.

Revision ID: 0001
Revises:
Create Date: 2026-07-09
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Sequence, Union

from alembic import context, op
from sqlalchemy import text

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.migration.0001")

# SQL files to exclude from baseline bootstrap.
# 00_keycloak_bootstrap.sql uses psql-only commands (\\gexec, \\connect)
# that SQLAlchemy cannot execute, and it manages a separate (keycloak)
# database outside the WIMS schema.
_EXCLUDED_FILES: set[str] = {"00_keycloak_bootstrap.sql"}

# Core tables that indicate an existing WIMS database.
_REQUIRED_TABLES = [
    "wims.users",
    "wims.fire_incidents",
    "wims.system_config",
]


def _schema_exists(connection) -> bool:
    """Check whether core WIMS tables exist on the target database.

    Returns True only when ALL ``_REQUIRED_TABLES`` exist.  If none
    exist the database is assumed fresh.  Partial presence raises
    because it indicates a corrupted or partially-migrated database.
    """
    found = 0
    for table in _REQUIRED_TABLES:
        schema, tbl = table.split(".")
        result = connection.execute(
            text("SELECT to_regclass(:schema || '.' || :tbl) IS NOT NULL"),
            {"schema": schema, "tbl": tbl},
        ).scalar()
        if result:
            found += 1

    if found == 0:
        return False
    if found == len(_REQUIRED_TABLES):
        return True

    # Partial schema — should not happen during normal operation.
    missing = [t for t in _REQUIRED_TABLES if not _table_exists(connection, t)]
    raise RuntimeError(
        f"Partial WIMS schema detected: {len(_REQUIRED_TABLES) - found} of "
        f"{len(_REQUIRED_TABLES)} core tables are missing. "
        f"Missing: {missing}. "
        "The database appears to be in an inconsistent state. "
        "Resolve manually before running migrations."
    )


def _table_exists(connection, table: str) -> bool:
    """Check whether a single table exists."""
    schema, tbl = table.split(".")
    return bool(
        connection.execute(
            text("SELECT to_regclass(:schema || '.' || :tbl) IS NOT NULL"),
            {"schema": schema, "tbl": tbl},
        ).scalar()
    )


def _get_sql_dir() -> Path:
    """Resolve the ``postgres-init`` directory.

    Uses ``POSTGRES_INIT_DIR`` env var if set, otherwise walks up from
    the migration file location.
    """
    env_dir = os.environ.get("POSTGRES_INIT_DIR")
    if env_dir:
        return Path(env_dir).resolve()

    # alembic/versions/0001_baseline_postgres_init.py ->
    # alembic/versions/ -> alembic/ -> backend/ -> src/ -> postgres-init/
    return Path(__file__).resolve().parents[3] / "postgres-init"


def upgrade() -> None:
    """Apply the baseline schema.

    *Existing database* — no-op (tables already exist).
    *Fresh database* — run all postgres-init SQL files in lexical order
    outside Alembic's transaction (AUTOCOMMIT), since most files contain
    explicit ``BEGIN`` / ``COMMIT`` blocks.
    """
    connection = op.get_bind()

    if _schema_exists(connection):
        logger.info(
            "Core WIMS tables exist — skipping baseline bootstrap. "
            "Stamping revision 0001 on existing database."
        )
        return

    # ── Offline mode guard ────────────────────────────────────────────
    # Offline mode has no real database connection, so we cannot run SQL.
    if context.is_offline_mode():
        logger.warning(
            "Offline migration mode — cannot execute SQL files. "
            "The baseline bootstrap must be applied online."
        )
        return

    # ── Fresh database — run SQL files ────────────────────────────────
    sql_dir = _get_sql_dir()
    if not sql_dir.is_dir():
        raise FileNotFoundError(
            f"postgres-init directory not found at {sql_dir}. "
            "Set POSTGRES_INIT_DIR env var to point to the correct location."
        )

    sql_files = sorted(sql_dir.glob("*.sql"))
    # Filter out excluded files
    sql_files = [f for f in sql_files if f.name not in _EXCLUDED_FILES]

    logger.info(
        "Bootstrapping fresh database from %d SQL files in %s (excluded: %s)",
        len(sql_files),
        sql_dir,
        ", ".join(sorted(_EXCLUDED_FILES)),
    )

    def _strip_sql_transaction_wrapper(sql: str) -> str:
        """Strip BEGIN; and COMMIT; so SQL runs cleanly in Alembic's transaction.

        Most postgres-init SQL files contain explicit BEGIN / COMMIT blocks.
        Alembic already wraps ``upgrade()`` in a transaction, so these would
        create subtransactions that interfere with savepoint-based error
        recovery.  Stripping them lets us wrap each file's DDL in a savepoint.
        """
        lines = []
        for line in sql.splitlines():
            normalized = line.strip().upper()
            if normalized in {"BEGIN;", "COMMIT;"}:
                continue
            lines.append(line)
        return "\n".join(lines).strip()

    applied: list[str] = []
    failed: list[str] = []
    for sql_file in sql_files:
        try:
            raw = sql_file.read_text(encoding="utf-8").strip()
            if not raw:
                continue

            # Strip BEGIN / COMMIT so we can wrap execution in savepoints.
            sql = _strip_sql_transaction_wrapper(raw)
            if not sql:
                logger.info("  Skipping (empty after stripping wrappers): %s", sql_file.name)
                continue

            logger.info("  Applying: %s", sql_file.name)
            # Use a savepoint so a failed SQL file doesn't abort the
            # entire transaction (PostgreSQL aborts the current transaction
            # on any error, even if Python catches the exception).
            sp_name = "sp_" + sql_file.stem[:40]
            try:
                op.execute(text('SAVEPOINT "' + sp_name + '"'))
                op.execute(text(sql))
            except Exception as exc:
                logger.warning(
                    "SQL file %s failed (non-fatal): %s",
                    sql_file.name,
                    exc,
                )
                op.execute(text('ROLLBACK TO SAVEPOINT "' + sp_name + '"'))
                failed.append(sql_file.name)
            else:
                op.execute(text('RELEASE SAVEPOINT "' + sp_name + '"'))
                applied.append(sql_file.name)
        except Exception as exc:
            logger.warning(
                "Unexpected error processing SQL file %s (non-fatal): %s",
                sql_file.name,
                exc,
            )
            failed.append(sql_file.name)

    logger.info(
        "Baseline bootstrap complete — %d applied, %d failed",
        len(applied),
        len(failed),
    )
    if failed:
        logger.warning("Failed files: %s", ", ".join(failed))


def downgrade() -> None:
    """Reverse the baseline schema.

    On an existing database this is a no-op (the baseline made no changes).
    On a fresh database this would drop the entire WIMS schema. We emit
    the DROP statements as a convenience but recommend manual verification.
    """
    connection = op.get_bind()
    if _schema_exists(connection):
        logger.info("Baseline downgrade: existing database — no-op (baseline made no changes).")
        return

    logger.warning("Baseline downgrade on fresh database — dropping WIMS schema.")
    connection.execute(text("DROP SCHEMA IF EXISTS wims CASCADE"))
    connection.execute(text("DROP SCHEMA IF EXISTS wims_private CASCADE"))
    logger.info("WIMS schemas dropped — baseline reverted.")
