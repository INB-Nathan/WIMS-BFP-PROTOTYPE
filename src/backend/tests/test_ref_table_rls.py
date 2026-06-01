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

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from auth import get_current_wims_user, get_db_with_rls
from database import set_rls_context
from main import app

_ENCODER_UID = uuid.UUID("11111111-1111-4111-8111-111111111111")
_ANALYST_UID = uuid.UUID("33333333-3333-4333-8333-333333333333")

_NCR_REGION_ID = 1  # seeded by 21_all_regions.sql


def _app_database_url() -> str:
    url = os.environ.get(
        "SQLALCHEMY_DATABASE_URL",
        os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/wims_test"),
    )
    return url.replace("postgres:postgres@", "wims_app_user:wimsapp@").replace(
        "postgres:password@", "wims_app_user:wimsapp@"
    )


_AppSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=create_engine(_app_database_url()),
)


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


def _rls_db_override(user_id: uuid.UUID):
    """Override for get_db_with_rls that sets the RLS GUC for the test session."""

    def _override():
        db = _AppSessionLocal()
        try:
            set_rls_context(db, user_id)
            yield db
        finally:
            db.close()

    return _override


# ---------------------------------------------------------------------------
# ref_regions
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_encoder_sees_only_own_region_in_regions():
    app.dependency_overrides[get_current_wims_user] = _enc_override(_NCR_REGION_ID)
    app.dependency_overrides[get_db_with_rls] = _rls_db_override(_ENCODER_UID)
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
    app.dependency_overrides[get_db_with_rls] = _rls_db_override(_ANALYST_UID)
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
    app.dependency_overrides[get_current_wims_user] = _enc_override(_NCR_REGION_ID)
    app.dependency_overrides[get_db_with_rls] = _rls_db_override(_ENCODER_UID)
    with TestClient(app) as client:
        resp = client.get("/api/ref/provinces")
    assert resp.status_code == 200
    provinces = resp.json()
    assert isinstance(provinces, list)
    assert len(provinces) > 0, "Encoder should see at least one NCR province"
    bad = [p for p in provinces if p["region_id"] != _NCR_REGION_ID]
    assert not bad, f"Encoder saw provinces outside NCR: {bad}"


@pytest.mark.integration
def test_analyst_sees_all_provinces():
    app.dependency_overrides[get_current_wims_user] = _analyst_override()
    app.dependency_overrides[get_db_with_rls] = _rls_db_override(_ANALYST_UID)
    with TestClient(app) as client:
        resp = client.get("/api/ref/provinces")
    assert resp.status_code == 200
    provinces = resp.json()
    assert isinstance(provinces, list)
    region_ids = {p["region_id"] for p in provinces}
    assert len(region_ids) > 1, (
        f"NATIONAL_ANALYST should see provinces from multiple regions; got region_ids={region_ids}"
    )


# ---------------------------------------------------------------------------
# ref_cities
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_encoder_sees_only_own_region_cities():
    # First get encoder's provinces to know which province_ids are valid for NCR
    app.dependency_overrides[get_current_wims_user] = _enc_override(_NCR_REGION_ID)
    app.dependency_overrides[get_db_with_rls] = _rls_db_override(_ENCODER_UID)
    with TestClient(app) as client:
        provinces_resp = client.get("/api/ref/provinces")
        cities_resp = client.get("/api/ref/cities")
    assert cities_resp.status_code == 200
    cities = cities_resp.json()
    assert isinstance(cities, list)
    # NCR (province_id=1 / Metro Manila) has no cities in the seed data, so 0 is valid.
    # The meaningful check is that no out-of-region cities leak through.
    valid_province_ids = {p["province_id"] for p in provinces_resp.json()}
    bad = [c for c in cities if c["province_id"] not in valid_province_ids]
    assert not bad, f"Encoder saw cities outside NCR provinces: {bad}"


@pytest.mark.integration
def test_analyst_sees_all_cities():
    app.dependency_overrides[get_current_wims_user] = _analyst_override()
    app.dependency_overrides[get_db_with_rls] = _rls_db_override(_ANALYST_UID)
    with TestClient(app) as client:
        resp = client.get("/api/ref/cities")
    assert resp.status_code == 200
    cities = resp.json()
    assert isinstance(cities, list)
    province_ids = {c["province_id"] for c in cities}
    assert len(province_ids) > 10, (
        f"NATIONAL_ANALYST should see cities from many provinces; got {len(province_ids)}"
    )
