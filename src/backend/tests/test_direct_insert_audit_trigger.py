"""Integration tests for RP-20: direct-insert audit trigger on wims.fire_incidents.

These tests require a live PostgreSQL instance with the full schema applied
(including 63_fire_incidents_insert_audit_trigger.sql).  They are skipped
automatically when the DB is unreachable or the trigger does not exist.
"""

import pathlib

import pytest
from sqlalchemy import text

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _db_available(db) -> bool:
    try:
        db.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def _trigger_exists(db) -> bool:
    row = db.execute(
        text("SELECT 1 FROM pg_trigger WHERE tgname = 'trg_detect_direct_fire_incident_insert'")
    ).fetchone()
    return row is not None


def _first_region_id(db):
    row = db.execute(
        text("SELECT region_id FROM wims.ref_regions ORDER BY region_id LIMIT 1")
    ).fetchone()
    return row[0] if row else None


def _insert_incident(db, region_id):
    """Insert a minimal fire_incidents row and return the new incident_id."""
    row = db.execute(
        text(
            """
            INSERT INTO wims.fire_incidents (region_id, location)
            VALUES (:rid, ST_SetSRID(ST_MakePoint(121.0, 14.6), 4326))
            RETURNING incident_id
            """
        ),
        {"rid": region_id},
    ).fetchone()
    return row[0]


def _count_direct_insert_rows(db, incident_id) -> int:
    row = db.execute(
        text(
            """
            SELECT COUNT(*) FROM wims.system_audit_trails
            WHERE action_type = 'DIRECT_DB_INSERT'
              AND record_id = :iid
            """
        ),
        {"iid": incident_id},
    ).fetchone()
    return row[0] if row else 0


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def admin_db():
    """Yield an admin SQLAlchemy session; skip if DB unreachable."""
    try:
        from database import _AdminSessionLocal
    except ImportError:
        pytest.skip("database module not importable")

    db = _AdminSessionLocal()
    if not _db_available(db):
        db.close()
        pytest.skip("Database not reachable")

    try:
        yield db
    finally:
        db.rollback()
        db.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_insert_without_guc_creates_audit_row(admin_db):
    """INSERT without app.audit_source GUC must produce a DIRECT_DB_INSERT row."""
    if not _trigger_exists(admin_db):
        pytest.skip("trigger trg_detect_direct_fire_incident_insert not installed")

    region_id = _first_region_id(admin_db)
    if region_id is None:
        pytest.skip("No ref_regions rows — cannot test trigger")

    sp = admin_db.begin_nested()
    try:
        # Explicitly clear GUC so trigger fires
        admin_db.execute(text("SET LOCAL app.audit_source = ''"))
        incident_id = _insert_incident(admin_db, region_id)
        count = _count_direct_insert_rows(admin_db, incident_id)
        assert count == 1, f"Expected 1 DIRECT_DB_INSERT row, got {count}"
    finally:
        sp.rollback()


def test_insert_with_guc_no_audit_row(admin_db):
    """INSERT with app.audit_source='app' must NOT produce a DIRECT_DB_INSERT row."""
    if not _trigger_exists(admin_db):
        pytest.skip("trigger trg_detect_direct_fire_incident_insert not installed")

    region_id = _first_region_id(admin_db)
    if region_id is None:
        pytest.skip("No ref_regions rows — cannot test trigger")

    sp = admin_db.begin_nested()
    try:
        admin_db.execute(text("SET LOCAL app.audit_source = 'app'"))
        incident_id = _insert_incident(admin_db, region_id)
        count = _count_direct_insert_rows(admin_db, incident_id)
        assert count == 0, f"Expected 0 DIRECT_DB_INSERT rows, got {count}"
    finally:
        sp.rollback()


def test_trigger_idempotent(admin_db):
    """Re-applying the trigger SQL must not raise an error."""
    if not _trigger_exists(admin_db):
        pytest.skip("trigger trg_detect_direct_fire_incident_insert not installed")

    sql_path = (
        pathlib.Path(__file__).parents[2]
        / "postgres-init"
        / "63_fire_incidents_insert_audit_trigger.sql"
    )
    if not sql_path.exists():
        pytest.skip("SQL file not found")

    sql = sql_path.read_text(encoding="utf-8")
    # Strip BEGIN/COMMIT so we can run inside the test transaction
    lines = [line for line in sql.splitlines() if line.strip().upper() not in {"BEGIN;", "COMMIT;"}]
    clean_sql = "\n".join(lines)

    sp = admin_db.begin_nested()
    try:
        admin_db.execute(text(clean_sql))
    finally:
        sp.rollback()


def test_get_db_sets_audit_source_guc():
    """get_db() must contain SET LOCAL app.audit_source = 'app' to prevent false positives."""
    src = (pathlib.Path(__file__).parents[1] / "database.py").read_text(encoding="utf-8")
    assert "SET LOCAL app.audit_source = 'app'" in src, (
        "database.py get_db() does not set app.audit_source GUC — direct inserts will be misidentified"
    )


def test_get_db_with_rls_sets_audit_source_guc():
    """get_db_with_rls() must contain SET LOCAL app.audit_source = 'app'."""
    src = (pathlib.Path(__file__).parents[1] / "auth.py").read_text(encoding="utf-8")
    assert "SET LOCAL app.audit_source = 'app'" in src, (
        "auth.py get_db_with_rls() does not set app.audit_source GUC — direct inserts will be misidentified"
    )
