"""
Integration tests for 42_ref_table_rls.sql — RLS enforcement on reference geography tables.

These tests require a running PostgreSQL container with migration 42 applied.
Run inside Docker:
    docker compose run --rm backend pytest tests/test_ref_table_rls.py -v

Seed users (from 03_users.sql + 14a_assign_ncr_to_test_users.sql):
  encoder  11111111-1111-4111-8111-111111111111  REGIONAL_ENCODER  assigned to NCR (region 1)
  analyst  33333333-3333-4333-8333-333333333333  NATIONAL_ANALYST  no region

Expected behavior:
  REGIONAL_ENCODER → sees only their region's ref_regions row, only that region's provinces,
                      and only cities in those provinces.
  NATIONAL_ANALYST  → sees all regions, provinces, cities.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from auth import get_current_wims_user
from main import app

_ENCODER_UID = uuid.UUID("11111111-1111-4111-8111-111111111111")
_ANALYST_UID = uuid.UUID("33333333-3333-4333-8333-333333333333")

_NCR_REGION_ID = 1  # seeded by 21_all_regions.sql


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _enc_override(region_id: int):
    async def _user():
        return {
            "user_id": _ENCODER_UID,
            "keycloak_id": str(_ENCODER_UID),
            "role": "REGIONAL_ENCODER",
            "assigned_region_id": region_id,
        }

    return _user


def _analyst_override():
    async def _user():
        return {
            "user_id": _ANALYST_UID,
            "keycloak_id": str(_ANALYST_UID),
            "role": "NATIONAL_ANALYST",
            "assigned_region_id": None,
        }

    return _user


# ---------------------------------------------------------------------------
# ref_regions
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_encoder_sees_only_own_region_in_regions():
    app.dependency_overrides[get_current_wims_user] = _enc_override(_NCR_REGION_ID)
    with TestClient(app) as client:
        resp = client.get("/api/ref/regions")
    assert resp.status_code == 200
    regions = resp.json()
    assert isinstance(regions, list)
    assert len(regions) == 1, f"Expected 1 region, got {len(regions)}: {regions}"
    assert regions[0]["region_id"] == _NCR_REGION_ID


@pytest.mark.integration
def test_analyst_sees_all_regions():
    app.dependency_overrides[get_current_wims_user] = _analyst_override()
    with TestClient(app) as client:
        resp = client.get("/api/ref/regions")
    assert resp.status_code == 200
    regions = resp.json()
    assert isinstance(regions, list)
    assert len(regions) > 1, "NATIONAL_ANALYST should see all 18 PH regions"


# ---------------------------------------------------------------------------
# ref_provinces
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_encoder_sees_only_own_region_provinces():
    from sqlalchemy import text
    from database import _SessionLocal  # noqa: SLF001

    # Resolve expected province count for NCR
    db = _SessionLocal()
    try:
        row = db.execute(
            text("SELECT COUNT(*) FROM wims.ref_provinces WHERE region_id = :rid"),
            {"rid": _NCR_REGION_ID},
        ).fetchone()
        ncr_province_count = row[0] if row else 0
    finally:
        db.close()

    app.dependency_overrides[get_current_wims_user] = _enc_override(_NCR_REGION_ID)
    with TestClient(app) as client:
        resp = client.get("/api/ref/provinces")
    assert resp.status_code == 200
    provinces = resp.json()
    assert isinstance(provinces, list)
    assert len(provinces) == ncr_province_count, (
        f"Encoder should see {ncr_province_count} NCR province(s), got {len(provinces)}"
    )


@pytest.mark.integration
def test_analyst_sees_all_provinces():
    from sqlalchemy import text
    from database import _SessionLocal  # noqa: SLF001

    db = _SessionLocal()
    try:
        row = db.execute(text("SELECT COUNT(*) FROM wims.ref_provinces")).fetchone()
        total = row[0] if row else 0
    finally:
        db.close()

    app.dependency_overrides[get_current_wims_user] = _analyst_override()
    with TestClient(app) as client:
        resp = client.get("/api/ref/provinces")
    assert resp.status_code == 200
    provinces = resp.json()
    assert len(provinces) == total, (
        f"NATIONAL_ANALYST should see all {total} provinces, got {len(provinces)}"
    )


# ---------------------------------------------------------------------------
# ref_cities
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_encoder_sees_only_own_region_cities():
    from sqlalchemy import text
    from database import _SessionLocal  # noqa: SLF001

    db = _SessionLocal()
    try:
        row = db.execute(
            text("""
                SELECT COUNT(*) FROM wims.ref_cities c
                JOIN wims.ref_provinces p ON p.province_id = c.province_id
                WHERE p.region_id = :rid
            """),
            {"rid": _NCR_REGION_ID},
        ).fetchone()
        ncr_city_count = row[0] if row else 0
    finally:
        db.close()

    app.dependency_overrides[get_current_wims_user] = _enc_override(_NCR_REGION_ID)
    with TestClient(app) as client:
        resp = client.get("/api/ref/cities")
    assert resp.status_code == 200
    cities = resp.json()
    assert isinstance(cities, list)
    assert len(cities) == ncr_city_count, (
        f"Encoder should see {ncr_city_count} NCR cities, got {len(cities)}"
    )


@pytest.mark.integration
def test_analyst_sees_all_cities():
    from sqlalchemy import text
    from database import _SessionLocal  # noqa: SLF001

    db = _SessionLocal()
    try:
        row = db.execute(text("SELECT COUNT(*) FROM wims.ref_cities")).fetchone()
        total = row[0] if row else 0
    finally:
        db.close()

    app.dependency_overrides[get_current_wims_user] = _analyst_override()
    with TestClient(app) as client:
        resp = client.get("/api/ref/cities")
    assert resp.status_code == 200
    cities = resp.json()
    assert len(cities) == total, (
        f"NATIONAL_ANALYST should see all {total} cities, got {len(cities)}"
    )
