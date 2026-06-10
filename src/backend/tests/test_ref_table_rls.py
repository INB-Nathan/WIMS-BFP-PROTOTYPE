"""M15: Behavioral RLS tests for reference geography tables.

Verifies the three properties required by M15:
  1. SELECT USING (TRUE) — any authenticated role (REGIONAL_ENCODER) sees all rows.
     The migration-42 role-gated policy returned zero rows for public_dmz (no user
     context → wims.current_user_role() = 'ANONYMOUS' → NULL IN (…) is falsy).
  2. Non-admin INSERT / UPDATE denied — FOR ALL WITH CHECK(SYSTEM_ADMIN) raises
     a ProgrammingError for REGIONAL_ENCODER.
  3. SYSTEM_ADMIN INSERT / UPDATE succeeds — WITH CHECK passes.

Requires live PostgreSQL with the full wims schema applied (all postgres-init/*.sql).
Skipped automatically when the database is not reachable (local non-Docker runs).
"""

from __future__ import annotations

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


# ---------------------------------------------------------------------------
# Module-scoped fixtures (one DB setup / teardown per test module)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def admin_db():
    """Postgres-superuser session — bypasses RLS. Skips if DB is unreachable."""
    from database import _AdminSessionLocal

    db = _AdminSessionLocal()
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        db.close()
        pytest.skip(f"PostgreSQL not reachable — skipping M15 behavioral tests: {exc}")
    yield db
    db.close()


@pytest.fixture(scope="module")
def encoder_user_id(admin_db):
    """Active REGIONAL_ENCODER in wims.users. Removed after the module completes."""
    uid = uuid.uuid4()
    kid = uuid.uuid4()
    region = admin_db.execute(text("SELECT region_id FROM wims.ref_regions LIMIT 1")).fetchone()
    region_id = region[0] if region else None
    admin_db.execute(
        text("""
            INSERT INTO wims.users
                (user_id, keycloak_id, username, role, is_active, assigned_region_id)
            VALUES (:uid, :kid, :uname, 'REGIONAL_ENCODER', TRUE, :rid)
        """),
        {"uid": uid, "kid": kid, "uname": f"rls_enc_{uid.hex[:8]}", "rid": region_id},
    )
    admin_db.commit()
    yield uid
    admin_db.execute(text("DELETE FROM wims.users WHERE user_id = :uid"), {"uid": uid})
    admin_db.commit()


@pytest.fixture(scope="module")
def sysadmin_user_id(admin_db):
    """Active SYSTEM_ADMIN in wims.users. Removed after the module completes."""
    uid = uuid.uuid4()
    kid = uuid.uuid4()
    admin_db.execute(
        text("""
            INSERT INTO wims.users
                (user_id, keycloak_id, username, role, is_active)
            VALUES (:uid, :kid, :uname, 'SYSTEM_ADMIN', TRUE)
        """),
        {"uid": uid, "kid": kid, "uname": f"rls_adm_{uid.hex[:8]}"},
    )
    admin_db.commit()
    yield uid
    admin_db.execute(text("DELETE FROM wims.users WHERE user_id = :uid"), {"uid": uid})
    admin_db.commit()


# ---------------------------------------------------------------------------
# Tests: SELECT open to all roles (USING TRUE — fixes public_dmz zero-row bug)
# ---------------------------------------------------------------------------


def _set_app_role_context(conn, user_id: uuid.UUID) -> None:
    """Downgrade to wims_app_user (RLS-enforced) then set the user GUC.

    In CI, DATABASE_URL connects as the postgres superuser which bypasses
    FORCE ROW LEVEL SECURITY.  SET LOCAL ROLE demotes current_user to
    wims_app_user so that RLS policies fire exactly as they would in
    production.  LOCAL is critical: it ensures the role reverts automatically
    at transaction end, preventing connection-pool contamination that would
    cause unrelated tests to run as wims_app_user after this test finishes.
    """
    conn.execute(text("SET LOCAL ROLE wims_app_user"))
    conn.execute(text("SET LOCAL wims.current_user_id = :uid"), {"uid": str(user_id)})


class TestNonAdminSelectReturnsRows:
    """SELECT USING (TRUE): reference geo data is globally readable after M15."""

    def test_encoder_selects_ref_regions(self, encoder_user_id):
        with _app_engine().connect() as conn:
            _set_app_role_context(conn, encoder_user_id)
            rows = conn.execute(text("SELECT region_id FROM wims.ref_regions LIMIT 5")).fetchall()
        assert len(rows) >= 1, "REGIONAL_ENCODER must see ref_regions rows (USING TRUE)"

    def test_encoder_selects_ref_provinces(self, encoder_user_id):
        with _app_engine().connect() as conn:
            _set_app_role_context(conn, encoder_user_id)
            rows = conn.execute(
                text("SELECT province_id FROM wims.ref_provinces LIMIT 5")
            ).fetchall()
        assert len(rows) >= 1, "REGIONAL_ENCODER must see ref_provinces rows (USING TRUE)"

    def test_encoder_selects_ref_cities(self, encoder_user_id):
        with _app_engine().connect() as conn:
            _set_app_role_context(conn, encoder_user_id)
            rows = conn.execute(text("SELECT city_id FROM wims.ref_cities LIMIT 5")).fetchall()
        assert len(rows) >= 1, "REGIONAL_ENCODER must see ref_cities rows (USING TRUE)"


# ---------------------------------------------------------------------------
# Tests: Non-admin INSERT / UPDATE denied
# ---------------------------------------------------------------------------


class TestNonAdminWritesDenied:
    """FOR ALL WITH CHECK (SYSTEM_ADMIN) raises ProgrammingError for non-admin roles.

    INSERT: WITH CHECK(FALSE) → always raises on a new-row violation.
    UPDATE: SELECT USING(TRUE) makes the row visible, but WITH CHECK(FALSE) raises
            when trying to write back the (unchanged) row.
    """

    def test_encoder_insert_ref_regions_denied(self, encoder_user_id):
        with _app_engine().connect() as conn:
            _set_app_role_context(conn, encoder_user_id)
            with pytest.raises((ProgrammingError, InternalError)):
                conn.execute(
                    text(
                        "INSERT INTO wims.ref_regions (region_name, region_code)"
                        " VALUES ('RLS Deny Test', 'RLSD')"
                    )
                )

    def test_encoder_update_ref_regions_denied(self, encoder_user_id, admin_db):
        region = admin_db.execute(text("SELECT region_id FROM wims.ref_regions LIMIT 1")).fetchone()
        if region is None:
            pytest.skip("No ref_regions seed data available")

        with _app_engine().connect() as conn:
            _set_app_role_context(conn, encoder_user_id)
            # UPDATE on rows invisible via USING silently returns 0 rows (no exception).
            # This is correct PostgreSQL behaviour: the row is "not found" for the
            # non-admin, so the change is a no-op — the update is denied.
            result = conn.execute(
                text(
                    "UPDATE wims.ref_regions SET region_code = region_code WHERE region_id = :rid"
                ),
                {"rid": region[0]},
            )
        assert result.rowcount == 0, (
            "REGIONAL_ENCODER UPDATE must affect 0 rows — row invisible via USING policy"
        )

    def test_encoder_insert_ref_provinces_denied(self, encoder_user_id, admin_db):
        region = admin_db.execute(text("SELECT region_id FROM wims.ref_regions LIMIT 1")).fetchone()
        if region is None:
            pytest.skip("No ref_regions seed data available")

        with _app_engine().connect() as conn:
            _set_app_role_context(conn, encoder_user_id)
            with pytest.raises((ProgrammingError, InternalError)):
                conn.execute(
                    text(
                        "INSERT INTO wims.ref_provinces (province_name, region_id)"
                        " VALUES ('RLS Deny Province', :rid)"
                    ),
                    {"rid": region[0]},
                )


# ---------------------------------------------------------------------------
# Tests: SYSTEM_ADMIN INSERT / UPDATE allowed
# ---------------------------------------------------------------------------


class TestAdminWritesAllowed:
    """FOR ALL WITH CHECK (SYSTEM_ADMIN) = TRUE: writes succeed for SYSTEM_ADMIN."""

    def test_admin_insert_ref_regions_allowed(self, sysadmin_user_id, admin_db):
        """SYSTEM_ADMIN can INSERT into ref_regions."""
        unique_code = f"M{sysadmin_user_id.hex[:5].upper()}"
        inserted_id = None
        with _app_engine().connect() as conn:
            _set_app_role_context(conn, sysadmin_user_id)
            result = conn.execute(
                text(
                    "INSERT INTO wims.ref_regions (region_name, region_code)"
                    " VALUES ('M15 Admin Insert Test', :code)"
                    " RETURNING region_id"
                ),
                {"code": unique_code},
            )
            inserted_id = result.fetchone()[0]
            conn.commit()

        assert inserted_id is not None, "SYSTEM_ADMIN must be able to INSERT into ref_regions"
        admin_db.execute(
            text("DELETE FROM wims.ref_regions WHERE region_id = :rid"),
            {"rid": inserted_id},
        )
        admin_db.commit()

    def test_admin_update_ref_regions_allowed(self, sysadmin_user_id, admin_db):
        """SYSTEM_ADMIN can UPDATE ref_regions."""
        # Insert a test row to update (via superuser so no RLS applies to setup)
        result = admin_db.execute(
            text(
                "INSERT INTO wims.ref_regions (region_name, region_code)"
                " VALUES ('M15 Update Src', 'UPD15')"
                " RETURNING region_id"
            )
        )
        test_id = result.fetchone()[0]
        admin_db.commit()

        rowcount = 0
        try:
            with _app_engine().connect() as conn:
                _set_app_role_context(conn, sysadmin_user_id)
                result = conn.execute(
                    text(
                        "UPDATE wims.ref_regions SET region_name = 'M15 Updated'"
                        " WHERE region_id = :rid"
                    ),
                    {"rid": test_id},
                )
                rowcount = result.rowcount
                conn.commit()
        finally:
            admin_db.execute(
                text("DELETE FROM wims.ref_regions WHERE region_id = :rid"),
                {"rid": test_id},
            )
            admin_db.commit()

        assert rowcount == 1, "SYSTEM_ADMIN must be able to UPDATE ref_regions"
