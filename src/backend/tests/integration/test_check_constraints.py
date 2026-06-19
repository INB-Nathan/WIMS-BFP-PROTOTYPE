"""CHECK constraint enforcement tests for incident_nonsensitive_details.

Tracer-bullet reproduction test for Issue #387: DB CHECK constraints migration.
Asserts that inserting negative values into incident_nonsensitive_details
numeric columns raises a constraint violation, and that NULL values are accepted
(nullable columns).
"""

from __future__ import annotations

import os
import shutil

import pytest
from sqlalchemy import text
from sqlalchemy.engine import create_engine, Engine, make_url
from sqlalchemy.exc import IntegrityError


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

    @pytest.mark.parametrize(
        "column, constraint_name",
        [
            ("civilian_deaths", "chk_incident_nonsensitive_details_civilian_deaths_non_negative"),
            ("civilian_injured", "chk_incident_nonsensitive_details_civilian_injured_non_negative"),
            (
                "firefighter_deaths",
                "chk_incident_nonsensitive_details_firefighter_deaths_non_negative",
            ),
            (
                "firefighter_injured",
                "chk_incident_nonsensitive_details_firefighter_injured_non_negative",
            ),
            (
                "estimated_damage_php",
                "chk_incident_nonsensitive_details_estimated_damage_php_non_negative",
            ),
            (
                "families_affected",
                "chk_incident_nonsensitive_details_families_affected_non_negative",
            ),
            (
                "water_tankers_used",
                "chk_incident_nonsensitive_details_water_tankers_used_non_negative",
            ),
            ("foam_liters_used", "chk_incident_nonsensitive_details_foam_liters_used_non_negative"),
            (
                "breathing_apparatus_used",
                "chk_incident_nonsensitive_details_breathing_apparatus_used_non_negative",
            ),
            (
                "structures_affected",
                "chk_incident_nonsensitive_details_structures_affected_non_negative",
            ),
            (
                "households_affected",
                "chk_incident_nonsensitive_details_households_affected_non_negative",
            ),
            (
                "individuals_affected",
                "chk_incident_nonsensitive_details_individuals_affected_non_negative",
            ),
            (
                "vehicles_affected",
                "chk_incident_nonsensitive_details_vehicles_affected_non_negative",
            ),
            (
                "total_response_time_minutes",
                "chk_incident_nonsensitive_details_total_response_time_minutes_non_negative",
            ),
            (
                "total_gas_consumed_liters",
                "chk_incident_nonsensitive_details_total_gas_consumed_liters_non_negative",
            ),
            (
                "extent_total_floor_area_sqm",
                "chk_incident_nonsensitive_details_extent_total_floor_area_sqm_non_negative",
            ),
            (
                "extent_total_land_area_hectares",
                "chk_incident_nonsensitive_details_extent_total_land_area_hectares_non_negative",
            ),
            (
                "distance_from_station_km",
                "chk_incident_nonsensitive_details_distance_from_station_km_non_negative",
            ),
        ],
    )
    def test_negative_value_fails(self, engine, incident_id, column, constraint_name):
        """Insert {column} = -1 must raise IntegrityError mentioning {constraint_name}."""
        with engine.connect() as conn:
            with pytest.raises(IntegrityError) as exc_info:
                conn.execute(
                    text(f"""
                        INSERT INTO wims.incident_nonsensitive_details
                        (incident_id, {column})
                        VALUES (:iid, -1)
                    """),
                    {"iid": incident_id},
                )
        assert constraint_name in str(exc_info.value)

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


@pytest.mark.skipif(shutil.which("psql") is None, reason="psql binary not installed")
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

        url = make_url(
            os.environ.get("DATABASE_URL", "postgresql://postgres:password@postgres:5432/wims")
        )

        env = os.environ.copy()
        env["PGPASSWORD"] = url.password
        result = subprocess.run(
            [
                "psql",
                "-h",
                url.host,
                "-U",
                url.username,
                "-d",
                url.database,
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
