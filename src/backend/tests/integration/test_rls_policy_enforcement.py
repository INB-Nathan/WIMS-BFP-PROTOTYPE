"""
RLS Policy Enforcement — CRITICAL-1 Regression Tests.

Tests wims.current_user_role() COALESCE guard and the deny-by-default
posture for ANONYMOUS/inactive/unauthenticated sessions.

Run (from project root with Docker/DB available):
  pytest src/backend/tests/integration/test_rls_policy_enforcement.py -v

Requires:
  - PostgreSQL with wims schema applied
  - DATABASE_URL or WIMS_SCHEMA_BOOTSTRAP_ADMIN_URL set
  - psql on PATH (for bootstrap fixture — creates disposable test DB)

TDD coverage:
  1. current_user_role() returns 'ANONYMOUS' when no session (NULL user_id)
  2. current_user_role() returns 'ANONYMOUS' when user is is_active=FALSE
  3. current_user_role() returns actual role when user is active
  4. RLS denies INSERT on fire_incidents with no session
  5. RLS denies UPDATE on fire_incidents with no session
  6. RLS denies INSERT as inactive user (even with matching region_id)
  7. CHECK constraint rejects role='ANONYMOUS' (invalid literal)
  8. CHECK constraint rejects role=NULL
  9. CHECK constraint rejects deprecated role aliases
 10. RLS allows INSERT for active REGIONAL_ENCODER with matching region
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DataError, IntegrityError, InternalError, ProgrammingError

import os


def _parse_admin_urls() -> tuple[str, str]:
    explicit = os.environ.get("WIMS_SCHEMA_BOOTSTRAP_ADMIN_URL")
    if explicit:
        admin = explicit
    else:
        db_url = os.environ.get(
            "DATABASE_URL",
            "postgresql://postgres:***@postgres:5432/wims",
        )
        if db_url.startswith("postgresql") and "@postgres:" in db_url:
            u = make_url(db_url).set(database="postgres")
            admin = u.render_as_string(hide_password=True)
        else:
            admin = "postgresql://postgres:***@127.0.0.1:5432/postgres"
    target = os.environ.get("WIMS_SCHEMA_BOOTSTRAP_TEST_DB", "wims_rls_test")
    return admin, target


def _psql_files(db_url: str, *sql_paths) -> None:
    import shutil
    import subprocess

    u = make_url(db_url)
    host = u.host or "127.0.0.1"
    port = u.port or 5432
    user = u.username or "postgres"
    password = u.password or ""
    database = u.database or "postgres"
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    psql = shutil.which("psql")
    if not psql:
        pytest.skip("psql not on PATH; install postgresql-client to run RLS tests")
    args = [
        psql,
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        host,
        "-p",
        str(port),
        "-U",
        user,
        "-d",
        database,
    ]
    for p in sql_paths:
        args.extend(["-f", str(p)])
    subprocess.run(args, check=True, env=env, capture_output=True, text=True)


def _postgres_init_dir():
    from pathlib import Path

    here = Path(__file__).resolve()
    for parent in here.parents:
        for rel in ("src/postgres-init", "postgres-init"):
            candidate = parent / rel
            if (candidate / "01_wims_initial.sql").is_file():
                return candidate
    pytest.fail(
        "Cannot find postgres-init/01_wims_initial.sql (set WIMS_POSTGRES_INIT_DIR)"
    )


@pytest.fixture(scope="module")
def bootstrap_engine():
    """
    Build a fresh disposable DB from 01_wims_initial.sql + 03_seed_reference.sql.
    Yields a SQLAlchemy engine. DB is dropped on teardown.
    """
    admin_url, test_db = _parse_admin_urls()
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        admin_engine.dispose()
        pytest.skip(f"PostgreSQL admin unreachable: {e}")

    init_dir = _postgres_init_dir()
    sql_01 = init_dir / "01_wims_initial.sql"
    sql_03 = init_dir / "03_seed_reference.sql"
    for f in (sql_01, sql_03):
        if not f.is_file():
            pytest.fail(f"Missing bootstrap SQL: {f}")

    with admin_engine.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{test_db}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{test_db}"'))

    u = make_url(admin_url).set(database=test_db)
    test_url = u.render_as_string(hide_password=True)

    try:
        _psql_files(test_url, sql_01, sql_03)
    except Exception as e:
        pytest.fail(f"psql bootstrap failed: {e}")

    eng = create_engine(test_url)
    yield eng
    eng.dispose()
    with admin_engine.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{test_db}" WITH (FORCE)'))
    admin_engine.dispose()


@pytest.fixture
def region_id(bootstrap_engine):
    """Return a valid region_id from seed data."""
    with bootstrap_engine.connect() as conn:
        row = conn.execute(
            text("SELECT region_id FROM wims.ref_regions LIMIT 1")
        ).fetchone()
    if row is None:
        pytest.skip("No ref_regions seed data")
    return row[0]


# ---------------------------------------------------------------------------
# Test 1: current_user_uuid() returns NULL without session
# ---------------------------------------------------------------------------
class TestCurrentUserUuidNoSession:
    def test_current_user_uuid_is_null_without_session(self, bootstrap_engine):
        with bootstrap_engine.connect() as conn:
            result = conn.execute(text("SELECT wims.current_user_uuid()")).scalar()
        assert result is None, (
            f"current_user_uuid() must be NULL when session not set, got {result!r}"
        )


# ---------------------------------------------------------------------------
# Test 2: current_user_role() returns 'ANONYMOUS' without session
# ---------------------------------------------------------------------------
class TestCurrentUserRoleNoSession:
    def test_current_user_role_is_anonymous_without_session(self, bootstrap_engine):
        """
        CRITICAL-1: Without a session, current_user_role() must return
        'ANONYMOUS' — not NULL.  NULL IN ('ROLE') = NULL (not FALSE),
        which would allow RLS to fall through to OR branches (e.g. region_id check).
        'ANONYMOUS' IN ('ROLE') = FALSE, correctly denying access.
        """
        with bootstrap_engine.connect() as conn:
            role = conn.execute(text("SELECT wims.current_user_role()")).scalar()
        assert role == "ANONYMOUS", (
            f"current_user_role() must return 'ANONYMOUS' without session, got {role!r}"
        )


# ---------------------------------------------------------------------------
# Test 3: current_user_role() returns 'ANONYMOUS' for inactive user
# ---------------------------------------------------------------------------
class TestCurrentUserRoleInactiveUser:
    def test_current_user_role_is_anonymous_for_inactive_user(self, bootstrap_engine):
        """
        A user with is_active=FALSE must resolve to 'ANONYMOUS' even if
        their user_id is set in the session.
        """
        user_id = uuid.uuid4()
        keycloak_id = uuid.uuid4()
        try:
            with bootstrap_engine.connect() as conn:
                conn.execute(
                    text("""
                        INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active)
                        VALUES (:uid, :kid, :username, 'REGIONAL_ENCODER', FALSE)
                    """),
                    {
                        "uid": user_id,
                        "kid": keycloak_id,
                        "username": f"inactive_{user_id.hex[:8]}",
                    },
                )
                conn.commit()
                conn.execute(
                    text("SET LOCAL wims.current_user_id = :uid"), {"uid": str(user_id)}
                )
                role = conn.execute(text("SELECT wims.current_user_role()")).scalar()
        finally:
            with bootstrap_engine.connect() as conn:
                conn.execute(
                    text("DELETE FROM wims.users WHERE user_id = :uid"),
                    {"uid": user_id},
                )
                conn.commit()

        assert role == "ANONYMOUS", (
            f"current_user_role() must return 'ANONYMOUS' for is_active=FALSE user, got {role!r}"
        )


# ---------------------------------------------------------------------------
# Test 4: current_user_role() returns actual role for active user
# ---------------------------------------------------------------------------
class TestCurrentUserRoleActiveUser:
    @pytest.mark.parametrize(
        "role_literal",
        [
            "SYSTEM_ADMIN",
            "NATIONAL_ANALYST",
            "REGIONAL_ENCODER",
            "NATIONAL_VALIDATOR",
            "CIVILIAN_REPORTER",
        ],
    )
    def test_current_user_role_returns_correct_role_for_active_user(
        self, bootstrap_engine, role_literal
    ):
        user_id = uuid.uuid4()
        keycloak_id = uuid.uuid4()
        try:
            with bootstrap_engine.connect() as conn:
                conn.execute(
                    text("""
                        INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active)
                        VALUES (:uid, :kid, :username, :role, TRUE)
                    """),
                    {
                        "uid": user_id,
                        "kid": keycloak_id,
                        "username": f"active_{user_id.hex[:8]}",
                        "role": role_literal,
                    },
                )
                conn.commit()
                conn.execute(
                    text("SET LOCAL wims.current_user_id = :uid"), {"uid": str(user_id)}
                )
                role = conn.execute(text("SELECT wims.current_user_role()")).scalar()
        finally:
            with bootstrap_engine.connect() as conn:
                conn.execute(
                    text("DELETE FROM wims.users WHERE user_id = :uid"),
                    {"uid": user_id},
                )
                conn.commit()

        assert role == role_literal, (
            f"current_user_role() for active user must return '{role_literal}', got {role!r}"
        )


# ---------------------------------------------------------------------------
# Test 5: RLS denies INSERT on fire_incidents without session
# ---------------------------------------------------------------------------
class TestRLSDeniesInsertNoSession:
    def test_rls_denies_insert_fire_incidents_without_session(
        self, bootstrap_engine, region_id
    ):
        """
        Without a session, current_user_role() = 'ANONYMOUS'.
        'ANONYMOUS' is NOT in any fire_incidents INSERT WITH CHECK IN clause.
        INSERT must be rejected by RLS.
        """
        with bootstrap_engine.connect() as conn:
            with pytest.raises((IntegrityError, ProgrammingError)):
                conn.execute(
                    text("""
                        INSERT INTO wims.fire_incidents
                            (location, region_id, verification_status, encoder_id)
                        VALUES
                            (ST_GeogFromText('SRID=4326;POINT(120.9842 14.5995)'), :rid, 'PENDING_VALIDATION', NULL)
                    """),
                    {"rid": region_id},
                )


# ---------------------------------------------------------------------------
# Test 6: RLS denies UPDATE on fire_incidents without session
# ---------------------------------------------------------------------------
class TestRLSDeniesUpdateNoSession:
    def test_rls_denies_update_fire_incidents_without_session(
        self, bootstrap_engine, region_id
    ):
        """
        Without a session, UPDATE on fire_incidents must be denied by RLS USING clause.
        Uses a second connection (no session) to attempt the UPDATE.
        """
        # Insert a test row using a SYSTEM_ADMIN session
        admin_id = uuid.uuid4()
        admin_kid = uuid.uuid4()
        incident_id = None
        try:
            with bootstrap_engine.connect() as conn:
                conn.execute(
                    text("""
                        INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active)
                        VALUES (:uid, :kid, :username, 'SYSTEM_ADMIN', TRUE)
                    """),
                    {
                        "uid": admin_id,
                        "kid": admin_kid,
                        "username": f"sysadmin_{admin_id.hex[:8]}",
                    },
                )
                conn.commit()
                conn.execute(
                    text("SET LOCAL wims.current_user_id = :uid"),
                    {"uid": str(admin_id)},
                )
                result = conn.execute(
                    text("""
                        INSERT INTO wims.fire_incidents
                            (location, region_id, verification_status, encoder_id)
                        VALUES
                            (ST_GeogFromText('SRID=4326;POINT(120.9842 14.5995)'), :rid, 'PENDING_VALIDATION', :eid)
                        RETURNING incident_id
                    """),
                    {"rid": region_id, "eid": str(admin_id)},
                )
                incident_id = result.fetchone()[0]
                conn.commit()
        finally:
            with bootstrap_engine.connect() as conn:
                conn.execute(
                    text("DELETE FROM wims.users WHERE user_id = :uid"),
                    {"uid": admin_id},
                )
                conn.commit()

        # Second connection: no session — attempt UPDATE (must be denied)
        with bootstrap_engine.connect() as conn:
            with pytest.raises((IntegrityError, ProgrammingError)):
                conn.execute(
                    text("""
                        UPDATE wims.fire_incidents
                        SET verification_status = 'CONFIRMED'
                        WHERE incident_id = :iid
                    """),
                    {"iid": incident_id},
                )

        # Cleanup
        with bootstrap_engine.connect() as conn:
            conn.execute(
                text("DELETE FROM wims.fire_incidents WHERE incident_id = :iid"),
                {"iid": incident_id},
            )
            conn.commit()


# ---------------------------------------------------------------------------
# Test 7: RLS denies INSERT as inactive user
# ---------------------------------------------------------------------------
class TestRLSDeniesInsertInactiveUser:
    def test_rls_denies_insert_fire_incidents_as_inactive_user(
        self, bootstrap_engine, region_id
    ):
        """
        Even with region_id match, an inactive user's role resolves to
        'ANONYMOUS' which is not in the INSERT WITH CHECK IN clause.
        INSERT must be denied.
        """
        user_id = uuid.uuid4()
        keycloak_id = uuid.uuid4()
        try:
            with bootstrap_engine.connect() as conn:
                conn.execute(
                    text("""
                        INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active, assigned_region_id)
                        VALUES (:uid, :kid, :username, 'REGIONAL_ENCODER', FALSE, :rid)
                    """),
                    {
                        "uid": user_id,
                        "kid": keycloak_id,
                        "username": f"inactive_{user_id.hex[:8]}",
                        "rid": region_id,
                    },
                )
                conn.commit()
                conn.execute(
                    text("SET LOCAL wims.current_user_id = :uid"), {"uid": str(user_id)}
                )
                with pytest.raises((IntegrityError, ProgrammingError)):
                    conn.execute(
                        text("""
                            INSERT INTO wims.fire_incidents
                                (location, region_id, verification_status, encoder_id)
                            VALUES
                                (ST_GeogFromText('SRID=4326;POINT(120.9842 14.5995)'), :rid, 'PENDING_VALIDATION', :eid)
                        """),
                        {"rid": region_id, "eid": str(user_id)},
                    )
        finally:
            with bootstrap_engine.connect() as conn:
                conn.execute(
                    text("DELETE FROM wims.users WHERE user_id = :uid"),
                    {"uid": user_id},
                )
                conn.commit()


# ---------------------------------------------------------------------------
# Test 8: CHECK constraint rejects role='ANONYMOUS'
# ---------------------------------------------------------------------------
class TestUsersRoleCheckConstraint:
    def test_insert_user_with_role_anonymous_fails(self, bootstrap_engine):
        """
        role='ANONYMOUS' is not in the CHECK constraint literal list.
        INSERT must fail the CHECK constraint.
        """
        user_id = uuid.uuid4()
        keycloak_id = uuid.uuid4()
        with bootstrap_engine.connect() as conn:
            with pytest.raises((IntegrityError, ProgrammingError)):
                conn.execute(
                    text("""
                        INSERT INTO wims.users (user_id, keycloak_id, username, role)
                        VALUES (:uid, :kid, 'anon_test', 'ANONYMOUS')
                    """),
                    {"uid": user_id, "kid": keycloak_id},
                )

    def test_insert_user_with_role_null_fails(self, bootstrap_engine):
        """
        role=NULL must fail — NOT NULL constraint + CHECK constraint.
        """
        user_id = uuid.uuid4()
        keycloak_id = uuid.uuid4()
        with bootstrap_engine.connect() as conn:
            with pytest.raises(
                (DataError, IntegrityError, InternalError, ProgrammingError)
            ):
                conn.execute(
                    text("""
                        INSERT INTO wims.users (user_id, keycloak_id, username, role)
                        VALUES (:uid, :kid, 'null_role_test', NULL)
                    """),
                    {"uid": user_id, "kid": keycloak_id},
                )

    def test_insert_user_with_invalid_role_alias_fails(self, bootstrap_engine):
        """
        role='ADMIN' (deprecated alias) must fail the CHECK constraint.
        Only the 5 strict FRS literals are allowed.
        """
        user_id = uuid.uuid4()
        keycloak_id = uuid.uuid4()
        with bootstrap_engine.connect() as conn:
            with pytest.raises((IntegrityError, ProgrammingError)):
                conn.execute(
                    text("""
                        INSERT INTO wims.users (user_id, keycloak_id, username, role)
                        VALUES (:uid, :kid, 'admin_alias_test', 'ADMIN')
                    """),
                    {"uid": user_id, "kid": keycloak_id},
                )


# ---------------------------------------------------------------------------
# Test 9: RLS allows INSERT for active REGIONAL_ENCODER with matching region
# ---------------------------------------------------------------------------
class TestRLSAllowsActiveEncoder:
    def test_rls_allows_insert_as_active_encoder_matching_region(
        self, bootstrap_engine, region_id
    ):
        """
        Sanity check: the COALESCE fix must NOT break legitimate access.
        Active REGIONAL_ENCODER with assigned_region_id = fire_incidents.region_id
        must be permitted by RLS.
        """
        user_id = uuid.uuid4()
        keycloak_id = uuid.uuid4()
        incident_id = None
        try:
            with bootstrap_engine.connect() as conn:
                conn.execute(
                    text("""
                        INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active, assigned_region_id)
                        VALUES (:uid, :kid, :username, 'REGIONAL_ENCODER', TRUE, :rid)
                    """),
                    {
                        "uid": user_id,
                        "kid": keycloak_id,
                        "username": f"encoder_{user_id.hex[:8]}",
                        "rid": region_id,
                    },
                )
                conn.commit()
                conn.execute(
                    text("SET LOCAL wims.current_user_id = :uid"), {"uid": str(user_id)}
                )
                result = conn.execute(
                    text("""
                        INSERT INTO wims.fire_incidents
                            (location, region_id, verification_status, encoder_id)
                        VALUES
                            (ST_GeogFromText('SRID=4326;POINT(120.9842 14.5995)'), :rid, 'PENDING_VALIDATION', :eid)
                        RETURNING incident_id
                    """),
                    {"rid": region_id, "eid": str(user_id)},
                )
                row = result.fetchone()
                incident_id = row[0]
        finally:
            with bootstrap_engine.connect() as conn:
                if incident_id:
                    conn.execute(
                        text(
                            "DELETE FROM wims.fire_incidents WHERE incident_id = :iid"
                        ),
                        {"iid": incident_id},
                    )
                conn.execute(
                    text("DELETE FROM wims.users WHERE user_id = :uid"),
                    {"uid": user_id},
                )
                conn.commit()

        assert incident_id is not None, (
            "Active REGIONAL_ENCODER with matching region must be allowed to INSERT"
        )
