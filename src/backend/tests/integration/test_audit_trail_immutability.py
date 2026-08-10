"""GH #732 — final-schema append-only enforcement for partitioned audit trails.

Regression tests for the canonical immutability control installed by
``postgres-init/100_audit_trail_immutability.sql`` (clean bootstrap) and
Alembic revision 0031 (existing databases): BEFORE UPDATE/DELETE row triggers
on the partitioned parent ``wims.system_audit_trails`` that FAIL CLOSED by
raising an error (SQLSTATE 55000), cloned onto current partitions and
automatically applied to future partitions.

Pinned behavior:
- application role (``wims_app_user``): UPDATE/DELETE match zero rows (RLS has
  no UPDATE/DELETE policies) and the row survives;
- superuser-capable principal (postgres): UPDATE/DELETE raise an error and the
  row survives;
- INSERT remains allowed (append-only = insert-only);
- ``wims.incident_verification_history`` keeps its independent rule-based
  append-only enforcement (no_delete_ivh / no_update_ivh).

Run against a disposable database carrying the full final schema, e.g.:
    DATABASE_URL=postgresql://postgres:postgres@localhost:55432/wims_test \
      pytest tests/integration/test_audit_trail_immutability.py -v
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import InternalError, OperationalError, ProgrammingError

_SEED_USER = uuid.UUID("00000000-0000-0000-0000-000000000001")
_TEST_PARTITION = "wims.system_audit_trails_immutability_test"
_FUTURE_PARTITION = "wims.system_audit_trails_immutability_future"


def _insert_audit_row(db, ts: str = "2098-06-01 00:00:00+00") -> int:
    """Insert one audit row into the dedicated test partition; return audit_id."""
    return db.execute(
        text(
            "INSERT INTO wims.system_audit_trails "
            "    (user_id, action_type, table_affected, record_id, timestamp) "
            "VALUES (:uid, 'TEST_MUTATION_GUARD', 'wims.system_audit_trails', :rid, :ts) "
            "RETURNING audit_id"
        ),
        {"uid": str(_SEED_USER), "rid": 1, "ts": ts},
    ).scalar_one()


@pytest.fixture(scope="module")
def admin_db():
    """Postgres-superuser session against the final schema; skips when absent."""
    from database import _AdminSessionLocal

    db = _AdminSessionLocal()
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        db.close()
        pytest.skip(f"PostgreSQL not reachable — skipping audit immutability tests: {exc}")

    app_role = db.execute(text("SELECT 1 FROM pg_roles WHERE rolname = 'wims_app_user'")).fetchone()
    if app_role is None:
        db.close()
        pytest.skip("wims_app_user role is not installed — skipping audit immutability tests")

    audit_table = db.execute(
        text(
            "SELECT 1 FROM pg_tables "
            "WHERE schemaname = 'wims' AND tablename = 'system_audit_trails'"
        )
    ).fetchone()
    if audit_table is None:
        db.close()
        pytest.skip("wims.system_audit_trails is not installed — skipping audit immutability tests")

    yield db
    db.close()


@pytest.fixture(autouse=True)
def _clean_transaction(admin_db):
    """Each test starts from a clean transaction so a previous abort cannot leak."""
    admin_db.rollback()
    yield
    admin_db.rollback()


@pytest.fixture(scope="module")
def audit_partition(admin_db):
    """Dedicated future-year partition holding this module's audit test rows.

    Created AFTER the immutability triggers exist on the parent, so it also
    proves that partitions added later automatically receive the cloned
    triggers. Dropped (with its rows) in teardown, so no trigger-bypassing
    cleanup is needed.
    """
    admin_db.execute(text(f"DROP TABLE IF EXISTS {_TEST_PARTITION}"))
    admin_db.execute(
        text(
            f"CREATE TABLE {_TEST_PARTITION} "
            "PARTITION OF wims.system_audit_trails "
            "FOR VALUES FROM ('2098-01-01 00:00:00+00') TO ('2100-01-01 00:00:00+00')"
        )
    )
    admin_db.commit()
    yield
    admin_db.execute(text(f"DROP TABLE IF EXISTS {_TEST_PARTITION}"))
    admin_db.commit()


# ---------------------------------------------------------------------------
# Trigger presence on the final schema
# ---------------------------------------------------------------------------


def test_parent_has_immutability_triggers(admin_db):
    rows = admin_db.execute(
        text(
            "SELECT tgname, tgenabled FROM pg_trigger "
            "WHERE tgrelid = 'wims.system_audit_trails'::regclass "
            "  AND tgname IN ('trg_audit_trails_no_update', 'trg_audit_trails_no_delete') "
            "ORDER BY tgname"
        )
    ).fetchall()
    assert [tuple(r) for r in rows] == [
        ("trg_audit_trails_no_delete", "O"),
        ("trg_audit_trails_no_update", "O"),
    ], (
        "expected enabled (tgenabled='O') UPDATE/DELETE immutability triggers on "
        "wims.system_audit_trails — apply 100_audit_trail_immutability.sql / alembic 0031"
    )


def test_every_partition_has_cloned_triggers(admin_db):
    partitions = admin_db.execute(
        text(
            "SELECT c.relname FROM pg_inherits i "
            "JOIN pg_class c ON c.oid = i.inhrelid "
            "JOIN pg_class p ON p.oid = i.inhparent "
            "JOIN pg_namespace n ON n.oid = p.relnamespace "
            "WHERE n.nspname = 'wims' AND p.relname = 'system_audit_trails' "
            "ORDER BY c.relname"
        )
    ).fetchall()
    assert partitions, "expected wims.system_audit_trails to have at least one partition"

    for (relname,) in partitions:
        triggers = admin_db.execute(
            text(
                "SELECT t.tgname FROM pg_trigger t "
                "JOIN pg_class c ON c.oid = t.tgrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'wims' AND c.relname = :rel "
                "  AND t.tgname IN ('trg_audit_trails_no_update', 'trg_audit_trails_no_delete') "
                "ORDER BY t.tgname"
            ),
            {"rel": relname},
        ).fetchall()
        assert [t[0] for t in triggers] == [
            "trg_audit_trails_no_delete",
            "trg_audit_trails_no_update",
        ], f"partition wims.{relname} is missing the cloned immutability triggers"


def test_no_obsolete_rules_on_audit_table(admin_db):
    """The pre-partition rule mechanism must not linger on the final parent."""
    rows = admin_db.execute(
        text(
            "SELECT rulename FROM pg_rules "
            "WHERE schemaname = 'wims' AND tablename = 'system_audit_trails'"
        )
    ).fetchall()
    assert rows == [], (
        "rules on wims.system_audit_trails are ineffective on partitions; "
        "protection must come from the parent-level triggers"
    )


# ---------------------------------------------------------------------------
# Insert stays allowed (append-only = insert-only)
# ---------------------------------------------------------------------------


def test_insert_still_allowed(admin_db, audit_partition):
    audit_id = _insert_audit_row(admin_db)
    admin_db.commit()
    row = admin_db.execute(
        text("SELECT action_type FROM wims.system_audit_trails WHERE audit_id = :aid"),
        {"aid": audit_id},
    ).fetchone()
    assert row is not None and row[0] == "TEST_MUTATION_GUARD"


# ---------------------------------------------------------------------------
# Application role: UPDATE/DELETE fail closed (RLS deny, zero rows)
# ---------------------------------------------------------------------------


def test_app_role_update_and_delete_fail_closed(admin_db, audit_partition):
    from database import _AdminSessionLocal

    audit_id = _insert_audit_row(admin_db)
    admin_db.commit()

    sess = _AdminSessionLocal()
    try:
        conn = sess.connection()
        conn.execute(text("SET LOCAL ROLE wims_app_user"))
        conn.execute(text("SET LOCAL wims.current_user_id = :uid"), {"uid": str(_SEED_USER)})
        upd = conn.execute(
            text(
                "UPDATE wims.system_audit_trails SET action_type = 'HACKED' WHERE audit_id = :aid"
            ),
            {"aid": audit_id},
        )
        dele = conn.execute(
            text("DELETE FROM wims.system_audit_trails WHERE audit_id = :aid"),
            {"aid": audit_id},
        )
        sess.commit()
    finally:
        sess.close()

    assert upd.rowcount == 0, "app role UPDATE must match zero rows (no RLS UPDATE policy)"
    assert dele.rowcount == 0, "app role DELETE must match zero rows (no RLS DELETE policy)"
    row = admin_db.execute(
        text("SELECT action_type FROM wims.system_audit_trails WHERE audit_id = :aid"),
        {"aid": audit_id},
    ).fetchone()
    assert row is not None and row[0] == "TEST_MUTATION_GUARD", "audit row must survive"


# ---------------------------------------------------------------------------
# Superuser-capable principal: UPDATE/DELETE fail closed by raising
# ---------------------------------------------------------------------------


def test_superuser_update_raises(admin_db, audit_partition):
    audit_id = _insert_audit_row(admin_db)
    admin_db.commit()

    with pytest.raises((OperationalError, ProgrammingError, InternalError), match="append-only"):
        admin_db.execute(
            text(
                "UPDATE wims.system_audit_trails SET action_type = 'MUTATED' WHERE audit_id = :aid"
            ),
            {"aid": audit_id},
        )
    admin_db.rollback()

    row = admin_db.execute(
        text("SELECT action_type FROM wims.system_audit_trails WHERE audit_id = :aid"),
        {"aid": audit_id},
    ).fetchone()
    assert row is not None and row[0] == "TEST_MUTATION_GUARD", "UPDATE must not silently no-op"


def test_superuser_delete_raises(admin_db, audit_partition):
    audit_id = _insert_audit_row(admin_db)
    admin_db.commit()

    with pytest.raises((OperationalError, ProgrammingError, InternalError), match="append-only"):
        admin_db.execute(
            text("DELETE FROM wims.system_audit_trails WHERE audit_id = :aid"),
            {"aid": audit_id},
        )
    admin_db.rollback()

    row = admin_db.execute(
        text("SELECT 1 FROM wims.system_audit_trails WHERE audit_id = :aid"),
        {"aid": audit_id},
    ).fetchone()
    assert row is not None, "DELETE must not silently succeed"


def test_superuser_update_via_partition_raises(admin_db, audit_partition):
    """Direct partition-targeted DML is blocked too (trigger lives on the partition)."""
    audit_id = _insert_audit_row(admin_db)
    admin_db.commit()

    with pytest.raises((OperationalError, ProgrammingError, InternalError), match="append-only"):
        admin_db.execute(
            text(
                "UPDATE wims.system_audit_trails_immutability_test "
                "SET action_type = 'MUTATED' WHERE audit_id = :aid"
            ),
            {"aid": audit_id},
        )
    admin_db.rollback()


# ---------------------------------------------------------------------------
# Future partitions: triggers are cloned automatically and enforced
# ---------------------------------------------------------------------------


def test_future_partition_receives_triggers_and_is_enforced(admin_db):
    admin_db.execute(text(f"DROP TABLE IF EXISTS {_FUTURE_PARTITION}"))
    admin_db.execute(
        text(
            f"CREATE TABLE {_FUTURE_PARTITION} "
            "PARTITION OF wims.system_audit_trails "
            "FOR VALUES FROM ('2100-01-01 00:00:00+00') TO ('2101-01-01 00:00:00+00')"
        )
    )
    admin_db.commit()
    try:
        triggers = admin_db.execute(
            text(
                "SELECT t.tgname FROM pg_trigger t "
                "JOIN pg_class c ON c.oid = t.tgrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'wims' AND c.relname = :rel "
                "  AND t.tgname IN ('trg_audit_trails_no_update', 'trg_audit_trails_no_delete') "
                "ORDER BY t.tgname"
            ),
            {"rel": "system_audit_trails_immutability_future"},
        ).fetchall()
        assert [t[0] for t in triggers] == [
            "trg_audit_trails_no_delete",
            "trg_audit_trails_no_update",
        ], "partitions created later must automatically receive the immutability triggers"

        audit_id = _insert_audit_row(admin_db, ts="2100-03-01 00:00:00+00")
        admin_db.commit()

        with pytest.raises(
            (OperationalError, ProgrammingError, InternalError), match="append-only"
        ):
            admin_db.execute(
                text("DELETE FROM wims.system_audit_trails WHERE audit_id = :aid"),
                {"aid": audit_id},
            )
        admin_db.rollback()

        remaining = admin_db.execute(
            text("SELECT 1 FROM wims.system_audit_trails WHERE audit_id = :aid"),
            {"aid": audit_id},
        ).fetchone()
        assert remaining is not None, "future-partition DELETE must fail closed"
    finally:
        admin_db.execute(text(f"DROP TABLE IF EXISTS {_FUTURE_PARTITION}"))
        admin_db.commit()


# ---------------------------------------------------------------------------
# incident_verification_history keeps its independent append-only enforcement
# ---------------------------------------------------------------------------


def test_ivh_remains_append_only(admin_db):
    admin_db.rollback()
    row = admin_db.execute(
        text(
            "INSERT INTO wims.incident_verification_history "
            "    (target_type, target_id, action_by_user_id, previous_status, new_status, notes) "
            "VALUES ('OFFICIAL', 1, :uid, 'DRAFT', 'VERIFIED', 'append-only guard test') "
            "RETURNING history_id"
        ),
        {"uid": str(_SEED_USER)},
    ).fetchone()
    admin_db.commit()
    history_id = row[0]

    try:
        upd = admin_db.execute(
            text(
                "UPDATE wims.incident_verification_history SET new_status = 'HACKED' "
                "WHERE history_id = :hid"
            ),
            {"hid": history_id},
        )
        dele = admin_db.execute(
            text("DELETE FROM wims.incident_verification_history WHERE history_id = :hid"),
            {"hid": history_id},
        )
        admin_db.commit()

        assert upd.rowcount == 0, "IVH UPDATE must be a no-op (no_update_ivh rule)"
        assert dele.rowcount == 0, "IVH DELETE must be a no-op (no_delete_ivh rule)"
        remaining = admin_db.execute(
            text(
                "SELECT new_status FROM wims.incident_verification_history WHERE history_id = :hid"
            ),
            {"hid": history_id},
        ).fetchone()
        assert remaining is not None and remaining[0] == "VERIFIED", (
            "IVH row must survive UPDATE/DELETE attempts"
        )
    finally:
        # Row intentionally remains — IVH is append-only (consistent with
        # test_immutable_records.py, which also leaves IVH rows behind).
        admin_db.rollback()
