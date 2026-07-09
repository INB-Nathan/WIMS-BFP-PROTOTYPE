"""Alembic migration environment — WIMS-BFP backend.

Reads DATABASE_ADMIN_URL (or DATABASE_URL) from the environment at runtime.
Models are discovered via the ``models`` package's declarative Base.

Usage
-----
    cd src/backend
    DATABASE_ADMIN_URL=postgresql://... alembic upgrade head
"""

from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Import the declarative base so Base.metadata captures all models.
# The models package __init__.py imports every subclass of Base,
# which registers them with Base.metadata for autogenerate support.
from models import Base

# This is the Alembic Config object, which provides access to
# the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Add your model's MetaData object here for 'autogenerate' support.
target_metadata = Base.metadata

# ── Runtime database URL ─────────────────────────────────────────────────────
# Priority: DATABASE_ADMIN_URL > DATABASE_URL
# The ADMIN URL is a superuser connection, needed for DDL operations.
# Fall back to DATABASE_URL when ADMIN is not set (e.g., CI environments).
_RUNTIME_URL: str = os.environ.get(
    "DATABASE_ADMIN_URL",
    os.environ.get("DATABASE_URL", ""),
)
if not _RUNTIME_URL:
    raise RuntimeError(
        "Neither DATABASE_ADMIN_URL nor DATABASE_URL is set. "
        "Set one of these environment variables before running Alembic."
    )


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL and not an Engine,
    though an Engine is acceptable here as well.  By skipping the Engine
    creation we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given SQL string to the
    script output.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    Creates an Engine from the runtime database URL and associates it
    with the Alembic migration context.
    """
    # Override the config's placeholder URL with the runtime one.
    alembic_config = config.get_section(config.config_ini_section, {})
    alembic_config["sqlalchemy.url"] = _RUNTIME_URL

    connectable = engine_from_config(
        alembic_config,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
