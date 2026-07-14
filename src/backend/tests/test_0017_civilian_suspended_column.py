"""
Contract test for the civilian_contributors.suspended column (issue #576).

Validates the column exists on wims.civilian_contributors with the expected
type (boolean), nullability (NOT NULL), and default (false), whether the schema
was produced by the Alembic 0017 migration or the clean-bootstrap postgres-init
path (86_civilian_contributor_snapshot.sql).

Prerequisites:
  - wims-postgres container running with PostGIS
  - Schema applied through 0017 (alembic) OR a clean postgres-init bootstrap

Run:
  cd src && docker compose run --rm backend pytest tests/test_0017_civilian_suspended_column.py -v
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import text
from sqlalchemy.engine import create_engine
from sqlalchemy.engine.base import Engine


def _get_engine() -> Engine:
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:password@postgres:5432/wims",
    )
    return create_engine(url, isolation_level="AUTOCOMMIT")


@pytest.fixture(scope="module")
def engine():
    return _get_engine()


@pytest.fixture(autouse=True)
def _skip_if_no_db(engine):
    """Skip integration tests if database is unreachable."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        pytest.skip(f"Database unreachable: {e}")


class TestCivilianSuspendedColumn:
    """wims.civilian_contributors.suspended contract."""

    @pytest.mark.parametrize(
        "column,expected_type,nullable,expected_default",
        [
            ("suspended", "boolean", "NO", "false"),
        ],
    )
    def test_column_contract(self, engine, column, expected_type, nullable, expected_default):
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT data_type, is_nullable, column_default "
                    "FROM information_schema.columns "
                    "WHERE table_schema = 'wims' AND table_name = 'civilian_contributors' "
                    "AND column_name = :col"
                ),
                {"col": column},
            ).fetchone()
        assert row is not None, f"Column {column} not found on civilian_contributors"
        assert row[0] == expected_type, (
            f"Column {column}: expected type {expected_type}, got {row[0]}"
        )
        assert row[1] == nullable, f"Column {column}: expected nullable={nullable}, got {row[1]}"
        assert row[2] is not None, f"Column {column}: expected a default value"
        assert str(row[2]).strip() == expected_default, (
            f"Column {column}: expected default {expected_default}, got {row[2]}"
        )

    def test_default_false_on_insert(self, engine):
        """A fresh civilian_contributors row defaults suspended to false."""
        with engine.connect() as conn:
            # Use a throwaway user row so we don't depend on seed data.
            import uuid

            user_id = uuid.uuid4()
            conn.execute(
                text(
                    "INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active) "
                    "VALUES (:uid, :kid, :uname, 'CIVILIAN_REPORTER', TRUE) "
                    "ON CONFLICT (user_id) DO NOTHING"
                ),
                {"uid": str(user_id), "kid": str(uuid.uuid4()), "uname": f"sus_test_{user_id.hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO wims.civilian_contributors (user_id) "
                    "VALUES (:uid) ON CONFLICT (user_id) DO NOTHING"
                ),
                {"uid": str(user_id)},
            )
            suspended = conn.execute(
                text("SELECT suspended FROM wims.civilian_contributors WHERE user_id = :uid"),
                {"uid": str(user_id)},
            ).scalar()
            conn.execute(
                text("DELETE FROM wims.civilian_contributors WHERE user_id = :uid"),
                {"uid": str(user_id)},
            )
            conn.execute(
                text("DELETE FROM wims.users WHERE user_id = :uid"),
                {"uid": str(user_id)},
            )
        assert suspended is False, f"Expected suspended default false, got {suspended}"
