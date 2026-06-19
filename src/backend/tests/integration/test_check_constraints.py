"""CHECK constraint enforcement tests for incident_nonsensitive_details.

Tracer-bullet reproduction test for Issue #387: DB CHECK constraints migration.
Asserts that inserting negative values into incident_nonsensitive_details
numeric columns raises a constraint violation, and that NULL values are accepted
(nullable columns).
"""

from __future__ import annotations

import os
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError, InternalError, ProgrammingError
from sqlalchemy.engine import create_engine, Engine


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


@pytest.fixture(scope="function")
def incident_id(engine):
    """Return a valid incident_id without existing nonsensitive details for FK ref.

    Scoped to function so each test gets a fresh incident without a detail row,
    avoiding UNIQUE violation on uq_nsd_incident_id.
    """
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                SELECT fi.incident_id
                FROM wims.fire_incidents fi
                WHERE NOT EXISTS (
                    SELECT 1 FROM wims.incident_nonsensitive_details ind
                    WHERE ind.incident_id = fi.incident_id
                )
                LIMIT 1
            """)
        ).fetchone()
    if row is None:
        pytest.skip("No fire_incidents without detail rows")
    return row[0]


class TestNonNegativeCheckConstraints:
    """CHECK constraints must reject negative values on incident_nonsensitive_details."""

    # -- Tracer bullet (casualties group) --

    def test_civilian_deaths_negative_fails(self, engine, incident_id):
        """Insert civilian_deaths = -1 must raise a constraint violation."""
        with engine.connect() as conn:
            with pytest.raises(
                (DataError, IntegrityError, InternalError, ProgrammingError)
            ) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.incident_nonsensitive_details
                        (incident_id, civilian_deaths)
                        VALUES (:iid, -1)
                    """),
                    {"iid": incident_id},
                )
        assert exc_info.value is not None

    def test_civilian_injured_negative_fails(self, engine, incident_id):
        """Insert civilian_injured = -1 must raise a constraint violation."""
        with engine.connect() as conn:
            with pytest.raises(
                (DataError, IntegrityError, InternalError, ProgrammingError)
            ) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.incident_nonsensitive_details
                        (incident_id, civilian_injured)
                        VALUES (:iid, -1)
                    """),
                    {"iid": incident_id},
                )
        assert exc_info.value is not None

    def test_firefighter_deaths_negative_fails(self, engine, incident_id):
        """Insert firefighter_deaths = -1 must raise a constraint violation."""
        with engine.connect() as conn:
            with pytest.raises(
                (DataError, IntegrityError, InternalError, ProgrammingError)
            ) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.incident_nonsensitive_details
                        (incident_id, firefighter_deaths)
                        VALUES (:iid, -1)
                    """),
                    {"iid": incident_id},
                )
        assert exc_info.value is not None

    def test_firefighter_injured_negative_fails(self, engine, incident_id):
        """Insert firefighter_injured = -1 must raise a constraint violation."""
        with engine.connect() as conn:
            with pytest.raises(
                (DataError, IntegrityError, InternalError, ProgrammingError)
            ) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.incident_nonsensitive_details
                        (incident_id, firefighter_injured)
                        VALUES (:iid, -1)
                    """),
                    {"iid": incident_id},
                )
        assert exc_info.value is not None

    # -- Damage / financial group --

    def test_estimated_damage_php_negative_fails(self, engine, incident_id):
        """Insert estimated_damage_php = -1 must raise a constraint violation."""
        with engine.connect() as conn:
            with pytest.raises(
                (DataError, IntegrityError, InternalError, ProgrammingError)
            ) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.incident_nonsensitive_details
                        (incident_id, estimated_damage_php)
                        VALUES (:iid, -1)
                    """),
                    {"iid": incident_id},
                )
        assert exc_info.value is not None

    def test_families_affected_negative_fails(self, engine, incident_id):
        """Insert families_affected = -1 must raise a constraint violation."""
        with engine.connect() as conn:
            with pytest.raises(
                (DataError, IntegrityError, InternalError, ProgrammingError)
            ) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.incident_nonsensitive_details
                        (incident_id, families_affected)
                        VALUES (:iid, -1)
                    """),
                    {"iid": incident_id},
                )
        assert exc_info.value is not None

    # -- Logistics group --

    def test_water_tankers_used_negative_fails(self, engine, incident_id):
        """Insert water_tankers_used = -1 must raise a constraint violation."""
        with engine.connect() as conn:
            with pytest.raises(
                (DataError, IntegrityError, InternalError, ProgrammingError)
            ) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.incident_nonsensitive_details
                        (incident_id, water_tankers_used)
                        VALUES (:iid, -1)
                    """),
                    {"iid": incident_id},
                )
        assert exc_info.value is not None

    def test_structures_affected_negative_fails(self, engine, incident_id):
        """Insert structures_affected = -1 must raise a constraint violation."""
        with engine.connect() as conn:
            with pytest.raises(
                (DataError, IntegrityError, InternalError, ProgrammingError)
            ) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.incident_nonsensitive_details
                        (incident_id, structures_affected)
                        VALUES (:iid, -1)
                    """),
                    {"iid": incident_id},
                )
        assert exc_info.value is not None

    def test_distance_from_station_km_negative_fails(self, engine, incident_id):
        """Insert distance_from_station_km = -1 must raise a constraint violation."""
        with engine.connect() as conn:
            with pytest.raises(
                (DataError, IntegrityError, InternalError, ProgrammingError)
            ) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO wims.incident_nonsensitive_details
                        (incident_id, distance_from_station_km)
                        VALUES (:iid, -1)
                    """),
                    {"iid": incident_id},
                )
        assert exc_info.value is not None

    # -- NULL-value acceptance tests (nullable columns must accept NULL) --

    def test_civilian_deaths_null_passes(self, engine, incident_id):
        """Insert civilian_deaths = NULL must succeed (nullable column)."""
        with engine.connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO wims.incident_nonsensitive_details
                    (incident_id, civilian_deaths)
                    VALUES (:iid, NULL)
                """),
                {"iid": incident_id},
            )
        # Clean up the successfully inserted row
        with engine.connect() as conn:
            conn.execute(
                text("DELETE FROM wims.incident_nonsensitive_details WHERE incident_id = :iid"),
                {"iid": incident_id},
            )

    def test_estimated_damage_php_null_passes(self, engine, incident_id):
        """Insert estimated_damage_php = NULL must succeed (nullable column)."""
        with engine.connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO wims.incident_nonsensitive_details
                    (incident_id, estimated_damage_php)
                    VALUES (:iid, NULL)
                """),
                {"iid": incident_id},
            )
        with engine.connect() as conn:
            conn.execute(
                text("DELETE FROM wims.incident_nonsensitive_details WHERE incident_id = :iid"),
                {"iid": incident_id},
            )

    def test_distance_from_station_km_null_passes(self, engine, incident_id):
        """Insert distance_from_station_km = NULL must succeed (nullable column)."""
        with engine.connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO wims.incident_nonsensitive_details
                    (incident_id, distance_from_station_km)
                    VALUES (:iid, NULL)
                """),
                {"iid": incident_id},
            )
        with engine.connect() as conn:
            conn.execute(
                text("DELETE FROM wims.incident_nonsensitive_details WHERE incident_id = :iid"),
                {"iid": incident_id},
            )


class TestMigrationIdempotency:
    """The 61_check_constraints migration must be safe to run more than once."""

    def test_migration_idempotent(self, engine):
        """Re-running the migration SQL should not raise any error."""
        import subprocess
        from pathlib import Path

        sql_file = (
            Path(__file__).resolve().parents[3] / "postgres-init" / "61_check_constraints.sql"
        )
        if not sql_file.exists():
            pytest.skip("Migration SQL file not found")

        db_url = os.environ.get(
            "DATABASE_URL",
            "postgresql://postgres:password@postgres:5432/wims",
        )
        # Parse connection params from URL
        # postgresql://user:password@host:port/dbname
        parsed = db_url.replace("postgresql://", "")
        user_pass, rest = parsed.split("@")
        user, password = user_pass.split(":")
        host_port, dbname = rest.split("/")
        host = host_port.split(":")[0]

        env = os.environ.copy()
        env["PGPASSWORD"] = password
        result = subprocess.run(
            [
                "psql",
                "-h",
                host,
                "-U",
                user,
                "-d",
                dbname,
                "-v",
                "ON_ERROR_STOP=1",
                "-f",
                str(sql_file),
            ],
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )
        # Migration should succeed (exit 0) even on second run
        assert result.returncode == 0, (
            f"Migration idempotency check failed.\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
        )
