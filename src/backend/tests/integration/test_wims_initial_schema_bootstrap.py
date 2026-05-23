"""
TDD: WIMS initial schema bootstrap (PostGIS + v2 + AFOR extensions).

Applies `01_wims_initial.sql` + `03_seed_reference.sql` from `postgres-init/`
against a disposable database, then asserts critical objects exist. Requires
`psql` on PATH and a superuser-capable PostgreSQL URL (see
WIMS_SCHEMA_BOOTSTRAP_ADMIN_URL).

Run (repo root):
  pytest src/backend/tests/integration/test_wims_initial_schema_bootstrap.py -q

Or from src/ with Docker network:
  docker compose run --rm backend pytest tests/integration/test_wims_initial_schema_bootstrap.py -q
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url


def _postgres_init_dir() -> Path:
    """Resolve repo `postgres-init` from host layout or `/app/postgres-init` in Docker."""
    override = os.environ.get("WIMS_POSTGRES_INIT_DIR")
    if override:
        p = Path(override)
        numbered = [f for f in p.glob("*.sql") if f.name and f.name[0].isdigit()]
        if numbered:
            return p.resolve()
        pytest.fail(
            f"WIMS_POSTGRES_INIT_DIR has no numbered SQL files in {p}: found {[f.name for f in p.glob('*.sql')]}"
        )

    here = Path(__file__).resolve()
    for parent in here.parents:
        for rel in ("src/postgres-init", "postgres-init"):
            candidate = parent / rel
            if (candidate / "01_extensions_roles.sql").is_file() or list(
                candidate.glob("[0-9]*.sql")
            ):
                return candidate
    pytest.fail(
        "Cannot find postgres-init/ directory with numbered SQL files (set WIMS_POSTGRES_INIT_DIR)."
    )


def _parse_admin_urls() -> tuple[str, str]:
    """
    Return (admin_base_url, target_database_name) for CREATE DATABASE.
    WIMS_SCHEMA_BOOTSTRAP_ADMIN_URL overrides; otherwise uses DATABASE_URL with
    database switched to 'postgres' when DATABASE_URL is set (Docker network).
    """
    explicit = os.environ.get("WIMS_SCHEMA_BOOTSTRAP_ADMIN_URL")
    if explicit:
        admin = explicit
    else:
        db_url = os.environ.get("DATABASE_URL", "")
        if db_url.startswith("postgresql") and "@postgres:" in db_url:
            u = make_url(db_url).set(database="postgres")
            admin = u.render_as_string(hide_password=False)
        else:
            admin = "postgresql://postgres:password@127.0.0.1:5432/postgres"
    target = os.environ.get("WIMS_SCHEMA_BOOTSTRAP_TEST_DB", "wims_bootstrap_test")
    return admin, target


def _psql_files(db_url: str, *sql_paths: Path) -> None:
    u = make_url(db_url)
    if u.get_backend_name() != "postgresql":
        raise RuntimeError("Only postgresql URLs supported for bootstrap test")
    host = u.host or "127.0.0.1"
    port = u.port or 5432
    user = u.username or "postgres"
    password = u.password or ""
    database = u.database or "postgres"
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    psql = shutil.which("psql")
    if not psql:
        pytest.skip("psql not on PATH; install postgresql-client to run bootstrap test")
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


@pytest.fixture(scope="module")
def bootstrap_engine():
    """Create empty DB, apply bootstrap SQL, yield engine, then drop DB."""
    admin_url, test_db = _parse_admin_urls()
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        admin_engine.dispose()
        pytest.skip(f"PostgreSQL admin unreachable ({admin_url}): {e}")

    init_dir = _postgres_init_dir()
    # Ordered bootstrap sequence; include all numbered .sql files (00-36+)
    import re

    bootstrap_files = sorted(init_dir.glob("*.sql"))
    sql_files = [f for f in bootstrap_files if re.match(r"^\d", f.name)]
    for f in sql_files:
        if not f.is_file():
            pytest.fail(f"Missing bootstrap SQL file: {f}")

    with admin_engine.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{test_db}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{test_db}"'))

    u = make_url(admin_url).set(database=test_db)
    test_url = u.render_as_string(hide_password=False)

    try:
        _psql_files(test_url, *sql_files)
    except subprocess.CalledProcessError as e:
        pytest.fail(
            f"psql bootstrap failed:\nstdout={e.stdout!r}\nstderr={e.stderr!r}\nargs={e.cmd!r}"
        )

    eng = create_engine(test_url)
    yield eng

    eng.dispose()
    with admin_engine.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{test_db}" WITH (FORCE)'))
    admin_engine.dispose()


def test_bootstrap_creates_v2_and_afor_objects(bootstrap_engine):
    """Critical v2 tables + AFOR extension tables/indexes exist after bootstrap."""
    insp = inspect(bootstrap_engine)
    assert "wims" in insp.get_schema_names()

    tables = set(insp.get_table_names(schema="wims"))
    for name in (
        "ref_regions",
        "users",
        "fire_incidents",
        "citizen_reports",
        "citizen_report_clusters",
        "citizen_report_cluster_members",
        "incident_nonsensitive_details",
        "incident_sensitive_details",
        "incident_wildland_afor",
        "wildland_afor_alarm_statuses",
        "wildland_afor_assistance_rows",
    ):
        assert name in tables, f"missing table wims.{name}"

    with bootstrap_engine.connect() as conn:
        loc_type = conn.execute(
            text(
                """
                SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
                FROM pg_catalog.pg_attribute a
                JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
                JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
                WHERE n.nspname = 'wims' AND c.relname = 'fire_incidents'
                  AND a.attname = 'location' AND NOT a.attisdropped
                """
            )
        ).scalar()
        assert loc_type is not None
        assert "geography" in loc_type.lower()

        roles = conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conname = 'users_role_check'
                  AND conrelid = 'wims.users'::regclass
                """
            )
        ).scalar()
        assert roles and "NATIONAL_ANALYST" in roles
        assert "REGIONAL_ENCODER" in roles

        chk = conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conname = 'chk_verified_requires_validator'
                  AND conrelid = 'wims.citizen_reports'::regclass
                """
            )
        ).scalar()
        assert chk

        cols = {
            r[0]
            for r in conn.execute(
                text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'wims' AND table_name = 'citizen_reports'
        """)
            )
        }
        assert "trust_score" in cols
        assert "source_url" in cols
        assert "category" in cols
        assert "safety_status" in cols
        assert "status_explanation" in cols
        assert "previous_report_id" in cols
        assert "linked_to_report_id" in cols
        assert "link_count" in cols

        src = conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conname = 'incident_wildland_afor_source_check'
                  AND conrelid = 'wims.incident_wildland_afor'::regclass
                """
            )
        ).scalar()
        assert src and "AFOR_IMPORT" in src

        fire_type_chk = conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conname = 'incident_wildland_afor_fire_type_check'
                  AND conrelid = 'wims.incident_wildland_afor'::regclass
                """
            )
        ).scalar()
        assert fire_type_chk and "peatland fire" in fire_type_chk.lower()

        alarm_chk = conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conname = 'wildland_afor_alarm_status_value_check'
                  AND conrelid = 'wims.wildland_afor_alarm_statuses'::regclass
                """
            )
        ).scalar()
        assert alarm_chk and "No Firefighting Conducted" in alarm_chk

        idx_names = {
            r[0]
            for r in conn.execute(
                text("""
            SELECT indexname FROM pg_indexes WHERE schemaname = 'wims'
        """)
            )
        }
        for idx in (
            "idx_fire_incidents_location",
            "idx_citizen_reports_location",
            "idx_incident_wildland_afor_created",
            "idx_wildland_afor_alarm_parent",
        ):
            assert idx in idx_names, f"missing index {idx}"

        # NCR seed
        ncr = conn.execute(
            text("SELECT region_id FROM wims.ref_regions WHERE region_code = 'NCR' LIMIT 1")
        ).fetchone()
        assert ncr is not None

        # ── citizen_report_clusters ──────────────────────────────────────────────
        cluster_cols = {
            r[0]
            for r in conn.execute(
                text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'wims' AND table_name = 'citizen_report_clusters'
        """)
            )
        }
        for col in (
            "anchor_report_id",
            "status",
            "status_note",
            "internal_note",
            "acted_by",
            "assigned_to",
            "review_started_at",
            "created_at",
            "updated_at",
            "closed_at",
            "merged_into_cluster_id",
        ):
            assert col in cluster_cols, f"missing cluster col {col}"

        cluster_statuses = {
            r[0]
            for r in conn.execute(
                text("""
            SELECT DISTINCT status FROM wims.citizen_report_clusters
        """)
            )
        }
        assert cluster_statuses <= {
            "CLUSTER_MONITORING",
            "CLUSTER_UNDER_REVIEW",
            "CLUSTER_ACTIONED",
            "CLUSTER_CLOSED",
        }

        # ── citizen_report_cluster_members ──────────────────────────────────────
        member_cols = {
            r[0]
            for r in conn.execute(
                text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'wims' AND table_name = 'citizen_report_cluster_members'
        """)
            )
        }
        for col in ("cluster_id", "report_id", "linked_by", "created_at"):
            assert col in member_cols, f"missing member col {col}"

        # ── ref_fire_stations.phone ─────────────────────────────────────────────
        station_cols = {
            r[0]
            for r in conn.execute(
                text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'wims' AND table_name = 'ref_fire_stations'
        """)
            )
        }
        assert "phone" in station_cols, "ref_fire_stations missing phone column"

        # ── Phase 2 indexes ─────────────────────────────────────────────────────
        for idx in (
            "idx_citizen_reports_location",
            "idx_citizen_reports_status",
            "idx_citizen_reports_device",
            "idx_citizen_reports_linked_to",
            "idx_citizen_reports_previous",
            "idx_citizen_reports_created",
            "idx_citizen_reports_nearest_station",
            "idx_citizen_reports_region",
            "idx_clusters_anchor",
            "idx_clusters_status",
            "idx_clusters_assigned",
            "idx_clusters_merged",
            "idx_clusters_created",
            "idx_cluster_members_report",
        ):
            assert idx in idx_names, f"missing index {idx}"

        # ── Phase 2 check constraints on citizen_reports.status ────────────────
        status_values = {
            r[0]
            for r in conn.execute(
                text("""
            SELECT DISTINCT status FROM wims.citizen_reports
        """)
            )
        }
        allowed = {
            "PENDING",
            "UNDER_REVIEW",
            "LINKED",
            "ACTIONED",
            "REJECTED_BOGUS",
            "REJECTED_DUPLICATE",
            "REJECTED_INSUFFICIENT",
            "REJECTED_TIMEOUT",
        }
        assert status_values <= allowed, f"unexpected status values: {status_values - allowed}"
