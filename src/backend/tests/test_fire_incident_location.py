"""
FireIncident location validation tests.

Validates that the model rejects plain string locations (e.g. "14.5995,120.9842")
per Constitution: GEOGRAPHY(POINT, 4326) only. No string-based approximations.

Uses synchronous SQLAlchemy (no AsyncSession) — the backend engine is sync.
pytest-asyncio is available for other test modules (e.g. rate limiting) but
this module does not require it.

Run (from project root, Docker only):
  docker run --rm -v "$(pwd)/src:/workspace" -w /workspace python:3.11-slim \
    bash -c "pip install -q geoalchemy2 shapely sqlalchemy pytest && \
    PYTHONPATH=. pytest backend/tests/test_fire_incident_location.py -v"

With DB (integration tests, cleans up after run):
  cd src && docker compose run --rm backend pytest backend/tests/test_fire_incident_location.py -v
"""

from __future__ import annotations

import os
import re

import pytest
from sqlalchemy import text
from sqlalchemy.exc import StatementError
from sqlalchemy.engine import create_engine

from backend.models.fire_incident import FireIncident
from backend.models.geometry_validation import InvalidLocationError


def _get_engine():
    """Return sync engine for optional integration tests."""
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:password@postgres:5432/wims",
    )
    return create_engine(url, isolation_level="AUTOCOMMIT")


@pytest.fixture(scope="module")
def engine():
    return _get_engine()


class TestFireIncidentLocationValidation:
    """FireIncident.location must reject non-WKT strings."""

    def test_string_location_raises_value_error(self):
        """Assigning comma-separated coords as plain string must raise ValueError or StatementError."""
        with pytest.raises((ValueError, InvalidLocationError, StatementError)) as exc_info:
            FireIncident(location="14.5995,120.9842")
        assert exc_info.value is not None

    def test_valid_wkt_point_accepted(self):
        """Valid WKT POINT string must be accepted."""
        inc = FireIncident(location="POINT(120.9842 14.5995)")
        assert inc.location is not None

    def test_valid_tuple_accepted(self):
        """Valid (lon, lat) tuple must be accepted."""
        inc = FireIncident(location=(120.9842, 14.5995))
        assert inc.location is not None

    def test_point_longitude_first_prevents_coordinate_flipping(self):
        """WKT POINT must use (lon lat) order; longitude first prevents GIS coordinate flipping bugs.

        Common bug: POINT(lat lon) instead of POINT(lon lat). For Philippines,
        Manila is ~(121.0°E, 14.5°N). POINT(121.0 14.5) is correct; POINT(14.5 121.0) is wrong.
        """
        inc = FireIncident(location=(121.0, 14.5))
        wkt = getattr(inc.location, "desc", None) or str(inc.location)
        m = re.search(r"POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)", wkt, re.IGNORECASE)
        assert m, f"WKT must match POINT(lon lat) pattern; got {wkt!r}"
        first, second = float(m.group(1)), float(m.group(2))
        assert first == 121.0 and second == 14.5, (
            "POINT must be (lon lat); first number must be longitude (121 for Manila), "
            "second latitude (14.5). Coordinate flipping causes wrong locations."
        )

    def test_wkt_string_longitude_first_philippines(self):
        """Explicit WKT POINT(121.0 14.5) must be accepted and preserve lon-first order."""
        inc = FireIncident(location="POINT(121.0 14.5)")
        assert inc.location is not None
        wkt = getattr(inc.location, "desc", None) or str(inc.location)
        assert "121" in wkt and "14.5" in wkt
        assert wkt.index("121") < wkt.index("14.5"), (
            "Longitude (121) must appear before latitude (14.5) in POINT string"
        )


class TestFireIncidentLocationIntegration:
    """Integration tests against PostGIS. Clean up all inserted data after run."""

    def test_point_longitude_first_roundtrip_and_cleanup(self, engine):
        """Insert POINT(121.0 14.5), verify lon-first on readback, then delete. No orphan data."""
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as e:
            pytest.skip(f"Database unreachable: {e}")

        incident_id = None
        try:
            with engine.connect() as conn:
                row = conn.execute(
                    text("SELECT region_id FROM wims.ref_regions LIMIT 1")
                ).fetchone()
                if row is None:
                    pytest.skip("No ref_regions seed data")
                region_id = row[0]

                result = conn.execute(
                    text("""
                        INSERT INTO wims.fire_incidents (region_id, location)
                        VALUES (:rid, ST_GeogFromText('SRID=4326;POINT(121.0 14.5)'))
                        RETURNING incident_id
                    """),
                    {"rid": region_id},
                )
                incident_id = result.fetchone()[0]

                # Verify longitude comes first in stored WKT
                readback = conn.execute(
                    text(
                        "SELECT ST_AsText(location) AS wkt FROM wims.fire_incidents WHERE incident_id = :iid"
                    ),
                    {"iid": incident_id},
                ).fetchone()
                wkt = readback[0]
                m = re.search(r"POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)", wkt)
                assert m, f"Readback WKT must match POINT(lon lat); got {wkt!r}"
                lon, lat = float(m.group(1)), float(m.group(2))
                assert lon == 121.0 and lat == 14.5, (
                    "Stored POINT must have longitude first (121, 14.5); got ({lon}, {lat})"
                )
        finally:
            if incident_id is not None:
                with engine.connect() as conn:
                    conn.execute(
                        text("DELETE FROM wims.fire_incidents WHERE incident_id = :iid"),
                        {"iid": incident_id},
                    )
