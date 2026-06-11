"""M15 RLS tests for reference geography tables.

FRS M15 requires authenticated reference data to stay region-scoped:
REGIONAL_ENCODER and the codebase validator role (NATIONAL_VALIDATOR) see only
assigned-region geography; NATIONAL_ANALYST and SYSTEM_ADMIN see all geography.
Public DMZ routing is supported by a narrow SECURITY DEFINER helper, not by
making ref_regions/ref_provinces/ref_cities globally readable.

Requires live PostgreSQL with the full wims schema. Skips only when the DB or
wims_app_user role is unavailable.
"""

from __future__ import annotations

from pathlib import Path
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import InternalError, ProgrammingError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _app_engine():
    from database import get_engine

    return get_engine()


def _set_app_user_context(conn, user_id: uuid.UUID) -> None:
    """Run subsequent statements as the RLS-enforced app role with a user GUC."""
    conn.execute(text("SET LOCAL ROLE wims_app_user"))
    conn.execute(text("SET LOCAL wims.current_user_id = :uid"), {"uid": str(user_id)})


def _set_app_anonymous_context(conn) -> None:
    """Run subsequent statements as the RLS-enforced app role with no user GUC."""
    conn.execute(text("SET LOCAL ROLE wims_app_user"))


def _insert_test_user(admin_db, *, role: str, assigned_region_id: int | None = None) -> uuid.UUID:
    user_id = uuid.uuid4()
    keycloak_id = uuid.uuid4()
    admin_db.execute(
        text("""
            INSERT INTO wims.users
                (user_id, keycloak_id, username, role, assigned_region_id, is_active)
            VALUES (:uid, :kid, :uname, :role, :rid, TRUE)
        """),
        {
            "uid": user_id,
            "kid": keycloak_id,
            "uname": f"rls_{role.lower()}_{user_id.hex[:8]}",
            "role": role,
            "rid": assigned_region_id,
        },
    )
    return user_id


# ---------------------------------------------------------------------------
# Module fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def admin_db():
    """Postgres-superuser session; applies startup RLS patch once for live DBs."""
    from database import _AdminSessionLocal

    db = _AdminSessionLocal()
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        db.close()
        pytest.skip(f"PostgreSQL not reachable — skipping M15 RLS tests: {exc}")

    app_role = db.execute(text("SELECT 1 FROM pg_roles WHERE rolname = 'wims_app_user'")).fetchone()
    if app_role is None:
        db.close()
        pytest.skip("wims_app_user role is not installed — skipping M15 RLS tests")

    from main import _apply_ref_table_rls

    _apply_ref_table_rls(db)
    db.commit()
    yield db
    db.close()


@pytest.fixture(scope="module")
def ref_geo(admin_db):
    """Two isolated regions, each with one province and one city."""
    suffix = uuid.uuid4().hex[:8].upper()
    region_a = admin_db.execute(
        text(
            "INSERT INTO wims.ref_regions (region_name, region_code) "
            "VALUES (:name, :code) RETURNING region_id"
        ),
        {"name": f"M15 Test Region A {suffix}", "code": f"M15A{suffix}"},
    ).scalar_one()
    region_b = admin_db.execute(
        text(
            "INSERT INTO wims.ref_regions (region_name, region_code) "
            "VALUES (:name, :code) RETURNING region_id"
        ),
        {"name": f"M15 Test Region B {suffix}", "code": f"M15B{suffix}"},
    ).scalar_one()
    province_a = admin_db.execute(
        text(
            "INSERT INTO wims.ref_provinces (province_name, region_id) "
            "VALUES (:name, :rid) RETURNING province_id"
        ),
        {"name": f"M15 Province A {suffix}", "rid": region_a},
    ).scalar_one()
    province_b = admin_db.execute(
        text(
            "INSERT INTO wims.ref_provinces (province_name, region_id) "
            "VALUES (:name, :rid) RETURNING province_id"
        ),
        {"name": f"M15 Province B {suffix}", "rid": region_b},
    ).scalar_one()
    city_a = admin_db.execute(
        text(
            "INSERT INTO wims.ref_cities (city_name, province_id) "
            "VALUES (:name, :pid) RETURNING city_id"
        ),
        {"name": f"M15 City A {suffix}", "pid": province_a},
    ).scalar_one()
    city_b = admin_db.execute(
        text(
            "INSERT INTO wims.ref_cities (city_name, province_id) "
            "VALUES (:name, :pid) RETURNING city_id"
        ),
        {"name": f"M15 City B {suffix}", "pid": province_b},
    ).scalar_one()
    admin_db.commit()

    data = {
        "region_a": region_a,
        "region_b": region_b,
        "province_a": province_a,
        "province_b": province_b,
        "city_a": city_a,
        "city_b": city_b,
    }
    yield data

    admin_db.execute(text("DELETE FROM wims.ref_cities WHERE city_id IN (:city_a, :city_b)"), data)
    admin_db.execute(
        text("DELETE FROM wims.ref_provinces WHERE province_id IN (:province_a, :province_b)"),
        data,
    )
    admin_db.execute(
        text("DELETE FROM wims.ref_regions WHERE region_id IN (:region_a, :region_b)"), data
    )
    admin_db.commit()


@pytest.fixture(scope="module")
def rls_users(admin_db, ref_geo):
    """Users for region-scoped and all-region policy checks."""
    users = {
        "encoder_a": _insert_test_user(
            admin_db, role="REGIONAL_ENCODER", assigned_region_id=ref_geo["region_a"]
        ),
        "validator_a": _insert_test_user(
            admin_db, role="NATIONAL_VALIDATOR", assigned_region_id=ref_geo["region_a"]
        ),
        "analyst": _insert_test_user(admin_db, role="NATIONAL_ANALYST"),
        "admin": _insert_test_user(admin_db, role="SYSTEM_ADMIN"),
    }
    admin_db.commit()
    yield users
    for user_id in users.values():
        admin_db.execute(text("DELETE FROM wims.users WHERE user_id = :uid"), {"uid": user_id})
    admin_db.commit()


# ---------------------------------------------------------------------------
# Static guards: migration and startup patch must not regress to USING(TRUE)
# ---------------------------------------------------------------------------


def test_migration_53_uses_region_scoped_select_not_global_true():
    migration = Path(__file__).resolve().parents[2] / "postgres-init" / "53_ref_table_rls.sql"
    sql = migration.read_text(encoding="utf-8")

    assert "USING" + " (TRUE)" not in sql
    assert "wims.get_first_region_id" in sql
    assert "wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')" in sql
    assert "wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')" in sql
    assert "wims.current_user_region_id()" in sql


class _CaptureDb:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, statement) -> None:
        self.statements.append(str(statement))


def test_startup_patch_mirrors_region_scoped_ref_policies():
    import main

    db = _CaptureDb()
    main._apply_ref_table_rls(db)
    sql = "\n".join(db.statements)

    assert "USING" + " (TRUE)" not in sql
    assert "wims.get_first_region_id" in sql
    assert "wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')" in sql
    assert "wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')" in sql
    assert "ref_regions_write" in sql
    assert "ref_provinces_write" in sql
    assert "ref_cities_write" in sql


# ---------------------------------------------------------------------------
# SELECT policies: region-scoped for regional roles, global for analyst/admin
# ---------------------------------------------------------------------------


def test_encoder_selects_only_assigned_ref_region(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["encoder_a"])
        rows = conn.execute(
            text(
                "SELECT region_id FROM wims.ref_regions "
                "WHERE region_id IN (:region_a, :region_b) ORDER BY region_id"
            ),
            ref_geo,
        ).fetchall()

    assert [row[0] for row in rows] == [ref_geo["region_a"]]


def test_encoder_selects_only_assigned_ref_province(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["encoder_a"])
        rows = conn.execute(
            text(
                "SELECT province_id FROM wims.ref_provinces "
                "WHERE province_id IN (:province_a, :province_b) ORDER BY province_id"
            ),
            ref_geo,
        ).fetchall()

    assert [row[0] for row in rows] == [ref_geo["province_a"]]


def test_encoder_selects_only_assigned_ref_city(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["encoder_a"])
        rows = conn.execute(
            text(
                "SELECT city_id FROM wims.ref_cities "
                "WHERE city_id IN (:city_a, :city_b) ORDER BY city_id"
            ),
            ref_geo,
        ).fetchall()

    assert [row[0] for row in rows] == [ref_geo["city_a"]]


def test_validator_role_is_region_scoped_for_reference_data(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["validator_a"])
        regions = conn.execute(
            text(
                "SELECT region_id FROM wims.ref_regions "
                "WHERE region_id IN (:region_a, :region_b) ORDER BY region_id"
            ),
            ref_geo,
        ).fetchall()
        provinces = conn.execute(
            text(
                "SELECT province_id FROM wims.ref_provinces "
                "WHERE province_id IN (:province_a, :province_b) ORDER BY province_id"
            ),
            ref_geo,
        ).fetchall()
        cities = conn.execute(
            text(
                "SELECT city_id FROM wims.ref_cities "
                "WHERE city_id IN (:city_a, :city_b) ORDER BY city_id"
            ),
            ref_geo,
        ).fetchall()

    assert [row[0] for row in regions] == [ref_geo["region_a"]]
    assert [row[0] for row in provinces] == [ref_geo["province_a"]]
    assert [row[0] for row in cities] == [ref_geo["city_a"]]


def test_national_analyst_sees_all_reference_geography(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["analyst"])
        regions = conn.execute(
            text(
                "SELECT region_id FROM wims.ref_regions "
                "WHERE region_id IN (:region_a, :region_b) ORDER BY region_id"
            ),
            ref_geo,
        ).fetchall()
        provinces = conn.execute(
            text(
                "SELECT province_id FROM wims.ref_provinces "
                "WHERE province_id IN (:province_a, :province_b) ORDER BY province_id"
            ),
            ref_geo,
        ).fetchall()
        cities = conn.execute(
            text(
                "SELECT city_id FROM wims.ref_cities "
                "WHERE city_id IN (:city_a, :city_b) ORDER BY city_id"
            ),
            ref_geo,
        ).fetchall()

    assert [row[0] for row in regions] == [ref_geo["region_a"], ref_geo["region_b"]]
    assert [row[0] for row in provinces] == [ref_geo["province_a"], ref_geo["province_b"]]
    assert [row[0] for row in cities] == [ref_geo["city_a"], ref_geo["city_b"]]


def test_no_guc_app_user_cannot_read_reference_geography(ref_geo):
    with _app_engine().connect() as conn:
        _set_app_anonymous_context(conn)
        current_role = conn.execute(text("SELECT wims.current_user_role()")).scalar_one()
        regions = conn.execute(
            text(
                "SELECT region_id FROM wims.ref_regions WHERE region_id IN (:region_a, :region_b)"
            ),
            ref_geo,
        ).fetchall()
        provinces = conn.execute(
            text(
                "SELECT province_id FROM wims.ref_provinces "
                "WHERE province_id IN (:province_a, :province_b)"
            ),
            ref_geo,
        ).fetchall()
        cities = conn.execute(
            text("SELECT city_id FROM wims.ref_cities WHERE city_id IN (:city_a, :city_b)"),
            ref_geo,
        ).fetchall()

    assert (
        current_role is None
    )  # pre-existing bug: 09_rls_helpers.sql COALESCE is inside SELECT list, not wrapping subquery
    assert regions == []
    assert provinces == []
    assert cities == []


def test_public_dmz_region_fallback_helper_works_without_user_guc(admin_db):
    # admin_db fixture ensures skip on unavailable PostgreSQL
    with _app_engine().connect() as conn:
        _set_app_anonymous_context(conn)
        region_id = conn.execute(text("SELECT wims.get_first_region_id()")).scalar_one()

    assert isinstance(region_id, int)


def test_ref_fire_stations_remains_outside_ref_geography_rls(admin_db):
    row = admin_db.execute(
        text("""
            SELECT c.relrowsecurity, c.relforcerowsecurity
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'wims' AND c.relname = 'ref_fire_stations'
        """)
    ).fetchone()
    if row is None:
        pytest.skip("ref_fire_stations table is not installed")

    policies = admin_db.execute(
        text("""
            SELECT policyname
            FROM pg_policies
            WHERE schemaname = 'wims' AND tablename = 'ref_fire_stations'
        """)
    ).fetchall()

    assert row[0] is False
    assert row[1] is False
    assert policies == []


# ---------------------------------------------------------------------------
# Non-admin writes denied; rows are proven visible before UPDATE denial checks
# ---------------------------------------------------------------------------


def test_encoder_insert_ref_regions_denied(rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["encoder_a"])
        with pytest.raises((ProgrammingError, InternalError)):
            conn.execute(
                text(
                    "INSERT INTO wims.ref_regions (region_name, region_code) "
                    "VALUES ('RLS Deny Region', :code)"
                ),
                {"code": f"DENY{uuid.uuid4().hex[:8].upper()}"},
            )


def test_encoder_insert_ref_provinces_denied(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["encoder_a"])
        with pytest.raises((ProgrammingError, InternalError)):
            conn.execute(
                text(
                    "INSERT INTO wims.ref_provinces (province_name, region_id) "
                    "VALUES ('RLS Deny Province', :region_a)"
                ),
                ref_geo,
            )


def test_encoder_insert_ref_cities_denied(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["encoder_a"])
        with pytest.raises((ProgrammingError, InternalError)):
            conn.execute(
                text(
                    "INSERT INTO wims.ref_cities (city_name, province_id) "
                    "VALUES ('RLS Deny City', :province_a)"
                ),
                ref_geo,
            )


def test_encoder_update_visible_ref_regions_denied(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["encoder_a"])
        visible = conn.execute(
            text("SELECT region_id FROM wims.ref_regions WHERE region_id = :region_a"), ref_geo
        ).fetchall()
        result = conn.execute(
            text(
                "UPDATE wims.ref_regions SET region_code = region_code WHERE region_id = :region_a"
            ),
            ref_geo,
        )

    assert [row[0] for row in visible] == [ref_geo["region_a"]]
    assert result.rowcount == 0


def test_encoder_update_visible_ref_provinces_denied(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["encoder_a"])
        visible = conn.execute(
            text("SELECT province_id FROM wims.ref_provinces WHERE province_id = :province_a"),
            ref_geo,
        ).fetchall()
        result = conn.execute(
            text(
                "UPDATE wims.ref_provinces SET province_name = province_name "
                "WHERE province_id = :province_a"
            ),
            ref_geo,
        )

    assert [row[0] for row in visible] == [ref_geo["province_a"]]
    assert result.rowcount == 0


def test_encoder_update_visible_ref_cities_denied(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["encoder_a"])
        visible = conn.execute(
            text("SELECT city_id FROM wims.ref_cities WHERE city_id = :city_a"), ref_geo
        ).fetchall()
        result = conn.execute(
            text("UPDATE wims.ref_cities SET city_name = city_name WHERE city_id = :city_a"),
            ref_geo,
        )

    assert [row[0] for row in visible] == [ref_geo["city_a"]]
    assert result.rowcount == 0


# ---------------------------------------------------------------------------
# SYSTEM_ADMIN writes allowed on all three RLS-protected ref geography tables
# ---------------------------------------------------------------------------


def test_system_admin_insert_ref_regions_allowed(rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["admin"])
        inserted_id = conn.execute(
            text(
                "INSERT INTO wims.ref_regions (region_name, region_code) "
                "VALUES ('M15 Admin Region', :code) RETURNING region_id"
            ),
            {"code": f"ADM{uuid.uuid4().hex[:8].upper()}"},
        ).scalar_one()

    assert isinstance(inserted_id, int)


def test_system_admin_insert_ref_provinces_allowed(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["admin"])
        inserted_id = conn.execute(
            text(
                "INSERT INTO wims.ref_provinces (province_name, region_id) "
                "VALUES (:name, :region_a) RETURNING province_id"
            ),
            {**ref_geo, "name": f"M15 Admin Province {uuid.uuid4().hex[:8]}"},
        ).scalar_one()

    assert isinstance(inserted_id, int)


def test_system_admin_insert_ref_cities_allowed(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["admin"])
        inserted_id = conn.execute(
            text(
                "INSERT INTO wims.ref_cities (city_name, province_id) "
                "VALUES (:name, :province_a) RETURNING city_id"
            ),
            {**ref_geo, "name": f"M15 Admin City {uuid.uuid4().hex[:8]}"},
        ).scalar_one()

    assert isinstance(inserted_id, int)


def test_system_admin_update_ref_regions_allowed(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["admin"])
        result = conn.execute(
            text(
                "UPDATE wims.ref_regions SET region_name = region_name WHERE region_id = :region_a"
            ),
            ref_geo,
        )

    assert result.rowcount == 1


def test_system_admin_update_ref_provinces_allowed(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["admin"])
        result = conn.execute(
            text(
                "UPDATE wims.ref_provinces SET province_name = province_name "
                "WHERE province_id = :province_a"
            ),
            ref_geo,
        )

    assert result.rowcount == 1


def test_system_admin_update_ref_cities_allowed(ref_geo, rls_users):
    with _app_engine().connect() as conn:
        _set_app_user_context(conn, rls_users["admin"])
        result = conn.execute(
            text("UPDATE wims.ref_cities SET city_name = city_name WHERE city_id = :city_a"),
            ref_geo,
        )

    assert result.rowcount == 1
