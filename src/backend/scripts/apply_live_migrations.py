#!/usr/bin/env python3
"""Apply live SQL migrations with a Postgres-backed ledger.

This runner is intentionally conservative:

* Existing production databases with an empty ledger are baselined through
  79_schema_migrations.sql so historical bootstrap files are not replayed.
* Future files absent from the ledger are executed once and recorded.
* Already-baselined/applied files are immutable by checksum.
* Failed rows are not skipped; same-checksum failures are retried.

The canonical ledger DDL is src/postgres-init/79_schema_migrations.sql.  This
script executes that file for the mutating ensure path instead of maintaining a
second copy of the schema in Python.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine

LEDGER_FILENAME = "79_schema_migrations.sql"
ADVISORY_LOCK_NAME = "wims-live-migrations"
KNOWN_EXISTING_TABLE = "wims.users"
VALID_STATUSES = {"baseline", "applied", "failed"}
LOCK_TIMEOUT_RE = re.compile(r"^[0-9]+(?:ms|s|min|h)?$")


class MigrationError(RuntimeError):
    """Base class for migration-runner failures."""


class ChecksumDriftError(MigrationError):
    """Raised when an applied/baselined file's checksum changed."""


@dataclass(frozen=True)
class MigrationFile:
    filename: str
    path: Path
    checksum_sha256: str


@dataclass(frozen=True)
class LedgerRow:
    filename: str
    checksum_sha256: str
    status: str


@dataclass(frozen=True)
class MigrationAction:
    action: str
    migration: MigrationFile
    reason: str
    prior_status: str | None = None


def c_sort_key(value: str) -> bytes:
    """Return the byte-wise key matching LC_ALL=C for ASCII filenames."""
    return value.encode("utf-8")


def validate_lock_timeout(value: str) -> str:
    """Validate a simple Postgres interval literal used for lock_timeout."""
    if not LOCK_TIMEOUT_RE.fullmatch(value):
        raise MigrationError(
            "--lock-timeout must be a simple duration like 500ms, 30s, 5min, or 1h"
        )
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def discover_sql_files(directory: Path) -> list[MigrationFile]:
    if not directory.exists() or not directory.is_dir():
        raise MigrationError(f"SQL migration directory is not accessible: {directory}")

    paths = sorted(directory.glob("*.sql"), key=lambda p: c_sort_key(p.name))
    if not paths:
        raise MigrationError(f"No .sql files found in {directory}")

    return [
        MigrationFile(filename=path.name, path=path, checksum_sha256=sha256_file(path))
        for path in paths
    ]


def _index_files(files: Iterable[MigrationFile]) -> dict[str, MigrationFile]:
    indexed: dict[str, MigrationFile] = {}
    for migration in files:
        if migration.filename in indexed:
            raise MigrationError(f"Duplicate migration filename: {migration.filename}")
        indexed[migration.filename] = migration
    return indexed


def plan_migrations(
    files: list[MigrationFile],
    ledger_rows: dict[str, LedgerRow],
    *,
    existing_db: bool,
    baseline_existing: bool,
    baseline_through: str,
    allow_failed_checksum_change: bool = False,
) -> list[MigrationAction]:
    """Build a deterministic migration plan without mutating the database."""
    files_by_name = _index_files(files)
    if baseline_existing and baseline_through not in files_by_name:
        raise MigrationError(
            f"Baseline cutoff {baseline_through!r} is missing from the migration directory"
        )

    unknown_statuses = {
        row.status for row in ledger_rows.values() if row.status not in VALID_STATUSES
    }
    if unknown_statuses:
        raise MigrationError(
            f"Ledger contains unsupported status value(s): {sorted(unknown_statuses)}"
        )

    ledger_empty = len(ledger_rows) == 0
    baseline_mode = baseline_existing and ledger_empty and existing_db
    if baseline_existing and ledger_empty and not existing_db:
        raise MigrationError(
            f"Refusing to baseline because known production table {KNOWN_EXISTING_TABLE} "
            "does not exist. Bootstrap the database before running live migrations."
        )

    cutoff_key = c_sort_key(baseline_through)
    actions: list[MigrationAction] = []

    for migration in files:
        row = ledger_rows.get(migration.filename)
        if row is None:
            if baseline_mode and c_sort_key(migration.filename) <= cutoff_key:
                actions.append(
                    MigrationAction(
                        action="baseline",
                        migration=migration,
                        reason=f"existing DB empty ledger through {baseline_through}",
                    )
                )
            else:
                actions.append(
                    MigrationAction(
                        action="apply",
                        migration=migration,
                        reason="absent from ledger",
                    )
                )
            continue

        if row.status in {"baseline", "applied"}:
            if row.checksum_sha256 != migration.checksum_sha256:
                raise ChecksumDriftError(
                    f"Checksum drift for {migration.filename}: ledger={row.checksum_sha256} "
                    f"current={migration.checksum_sha256} status={row.status}"
                )
            actions.append(
                MigrationAction(
                    action="skip",
                    migration=migration,
                    reason=f"already {row.status}",
                    prior_status=row.status,
                )
            )
            continue

        # Failed rows are not applied.  Retry the same checksum; allow a changed
        # checksum only with an explicit operator flag.
        if row.checksum_sha256 != migration.checksum_sha256 and not allow_failed_checksum_change:
            raise ChecksumDriftError(
                f"Failed migration {migration.filename} changed checksum: "
                f"ledger={row.checksum_sha256} current={migration.checksum_sha256}. "
                "Use --allow-failed-checksum-change only after manual review."
            )
        actions.append(
            MigrationAction(
                action="retry_failed",
                migration=migration,
                reason="previous failed row is not treated as applied",
                prior_status=row.status,
            )
        )

    return actions


def sanitize_error(output: str, database_url: str) -> str:
    redacted = output.replace(database_url, "[DATABASE_ADMIN_URL]")
    # Best-effort redaction for postgresql://user:password@host/db strings if a
    # tool ever echoes a URL variant instead of the exact input.
    return re.sub(
        r"postgres(?:ql)?://([^:/\s]+):([^@\s]+)@", r"postgresql://\1:[REDACTED]@", redacted
    )


def run_psql_file(
    database_url: str,
    file_path: Path,
    *,
    lock_timeout: str,
) -> tuple[int, str, str, int]:
    if shutil.which("psql") is None:
        raise MigrationError("psql is not on PATH; install postgresql-client")

    validate_lock_timeout(lock_timeout)
    started = time.monotonic()
    proc = subprocess.run(
        [
            "psql",
            database_url,
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f"SET lock_timeout = '{lock_timeout}';",
            "-f",
            str(file_path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    duration_ms = int((time.monotonic() - started) * 1000)
    stdout = sanitize_error(proc.stdout, database_url)
    stderr = sanitize_error(proc.stderr, database_url)
    return proc.returncode, stdout, stderr, duration_ms


def create_admin_engine(database_url: str) -> Engine:
    return create_engine(database_url, future=True, pool_pre_ping=True)


def current_user_can_bypass_rls(conn: Connection) -> bool:
    row = conn.execute(
        text(
            """
            SELECT usesuper OR rolbypassrls AS can_bypass
            FROM pg_roles
            WHERE rolname = current_user
            """
        )
    ).one()
    return bool(row.can_bypass)


def table_exists(conn: Connection, regclass_name: str) -> bool:
    return bool(
        conn.execute(
            text("SELECT to_regclass(:name) IS NOT NULL"), {"name": regclass_name}
        ).scalar()
    )


def load_ledger(conn: Connection) -> dict[str, LedgerRow]:
    if not table_exists(conn, "wims.schema_migrations"):
        return {}
    rows = conn.execute(
        text(
            """
            SELECT filename, checksum_sha256, status
            FROM wims.schema_migrations
            ORDER BY filename
            """
        )
    ).mappings()
    return {
        str(row["filename"]): LedgerRow(
            filename=str(row["filename"]),
            checksum_sha256=str(row["checksum_sha256"]),
            status=str(row["status"]),
        )
        for row in rows
    }


def ensure_ledger_schema(
    database_url: str,
    migrations_dir: Path,
    *,
    lock_timeout: str,
) -> None:
    ledger_path = migrations_dir / LEDGER_FILENAME
    if not ledger_path.exists():
        raise MigrationError(f"Required ledger DDL file is missing: {ledger_path}")

    code, stdout, stderr, _duration_ms = run_psql_file(
        database_url,
        ledger_path,
        lock_timeout=lock_timeout,
    )
    if stdout.strip():
        print(stdout.rstrip())
    if code != 0:
        if stderr.strip():
            print(stderr.rstrip(), file=sys.stderr)
        raise MigrationError(f"Failed to ensure ledger schema from {LEDGER_FILENAME}")
    if stderr.strip():
        print(stderr.rstrip(), file=sys.stderr)


def acquire_advisory_lock(conn: Connection) -> None:
    acquired = conn.execute(
        text("SELECT pg_try_advisory_lock(hashtext(:lock_name))"),
        {"lock_name": ADVISORY_LOCK_NAME},
    ).scalar()
    conn.commit()
    if not acquired:
        raise MigrationError(f"Could not acquire advisory lock {ADVISORY_LOCK_NAME!r}")


def release_advisory_lock(conn: Connection) -> None:
    conn.execute(
        text("SELECT pg_advisory_unlock(hashtext(:lock_name))"),
        {"lock_name": ADVISORY_LOCK_NAME},
    )
    conn.commit()


def record_baseline(conn: Connection, action: MigrationAction, deploy_commit: str) -> None:
    with conn.begin():
        conn.execute(
            text(
                """
                INSERT INTO wims.schema_migrations (
                    filename, checksum_sha256, status, duration_ms, deploy_commit, error_text
                ) VALUES (
                    :filename, :checksum_sha256, 'baseline', 0, :deploy_commit, NULL
                )
                ON CONFLICT (filename) DO UPDATE SET
                    checksum_sha256 = EXCLUDED.checksum_sha256,
                    status = 'baseline',
                    applied_at = now(),
                    duration_ms = 0,
                    deploy_commit = EXCLUDED.deploy_commit,
                    error_text = NULL
                """
            ),
            {
                "filename": action.migration.filename,
                "checksum_sha256": action.migration.checksum_sha256,
                "deploy_commit": deploy_commit,
            },
        )


def record_success(
    conn: Connection,
    action: MigrationAction,
    *,
    duration_ms: int,
    deploy_commit: str,
) -> None:
    with conn.begin():
        conn.execute(
            text(
                """
                INSERT INTO wims.schema_migrations (
                    filename, checksum_sha256, status, duration_ms, deploy_commit, error_text
                ) VALUES (
                    :filename, :checksum_sha256, 'applied', :duration_ms, :deploy_commit, NULL
                )
                ON CONFLICT (filename) DO UPDATE SET
                    checksum_sha256 = EXCLUDED.checksum_sha256,
                    status = 'applied',
                    applied_at = now(),
                    duration_ms = EXCLUDED.duration_ms,
                    deploy_commit = EXCLUDED.deploy_commit,
                    error_text = NULL
                """
            ),
            {
                "filename": action.migration.filename,
                "checksum_sha256": action.migration.checksum_sha256,
                "duration_ms": duration_ms,
                "deploy_commit": deploy_commit,
            },
        )


def record_failure(
    conn: Connection,
    action: MigrationAction,
    *,
    duration_ms: int,
    deploy_commit: str,
    error_text: str,
) -> None:
    with conn.begin():
        conn.execute(
            text(
                """
                INSERT INTO wims.schema_migrations (
                    filename, checksum_sha256, status, duration_ms, deploy_commit, error_text
                ) VALUES (
                    :filename, :checksum_sha256, 'failed', :duration_ms, :deploy_commit, :error_text
                )
                ON CONFLICT (filename) DO UPDATE SET
                    checksum_sha256 = EXCLUDED.checksum_sha256,
                    status = 'failed',
                    applied_at = now(),
                    duration_ms = EXCLUDED.duration_ms,
                    deploy_commit = EXCLUDED.deploy_commit,
                    error_text = EXCLUDED.error_text
                """
            ),
            {
                "filename": action.migration.filename,
                "checksum_sha256": action.migration.checksum_sha256,
                "duration_ms": duration_ms,
                "deploy_commit": deploy_commit,
                "error_text": error_text[-20000:],
            },
        )


def print_plan(actions: list[MigrationAction], *, dry_run: bool) -> None:
    prefix = "dry-run " if dry_run else ""
    for action in actions:
        print(
            f"{prefix}{action.action}: {action.migration.filename} "
            f"sha256={action.migration.checksum_sha256} reason={action.reason}"
        )


def execute_actions(
    conn: Connection,
    actions: list[MigrationAction],
    *,
    database_url: str,
    deploy_commit: str,
    lock_timeout: str,
) -> None:
    for action in actions:
        if action.action == "skip":
            print(f"skip: {action.migration.filename} ({action.reason})")
            continue
        if action.action == "baseline":
            print(f"baseline: {action.migration.filename}")
            record_baseline(conn, action, deploy_commit)
            continue
        if action.action not in {"apply", "retry_failed"}:
            raise MigrationError(f"Unsupported migration action: {action.action}")

        verb = "retry_failed" if action.action == "retry_failed" else "apply"
        print(f"{verb}: {action.migration.filename}")
        code, stdout, stderr, duration_ms = run_psql_file(
            database_url,
            action.migration.path,
            lock_timeout=lock_timeout,
        )
        if stdout.strip():
            print(stdout.rstrip())
        if code == 0:
            if stderr.strip():
                print(stderr.rstrip(), file=sys.stderr)
            record_success(
                conn,
                action,
                duration_ms=duration_ms,
                deploy_commit=deploy_commit,
            )
            print(f"applied: {action.migration.filename} duration_ms={duration_ms}")
            continue

        combined_error = "\n".join(part for part in [stdout, stderr] if part.strip())
        if stderr.strip():
            print(stderr.rstrip(), file=sys.stderr)
        record_failure(
            conn,
            action,
            duration_ms=duration_ms,
            deploy_commit=deploy_commit,
            error_text=combined_error,
        )
        print(f"failed: {action.migration.filename} duration_ms={duration_ms}")
        raise MigrationError(f"Migration failed: {action.migration.filename}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True, type=Path, help="Directory containing *.sql files")
    parser.add_argument(
        "--baseline-existing",
        action="store_true",
        help="Baseline historical files on an existing DB when the ledger is empty",
    )
    parser.add_argument(
        "--baseline-through",
        default=LEDGER_FILENAME,
        help=f"Last filename to baseline on first existing-DB run (default: {LEDGER_FILENAME})",
    )
    parser.add_argument("--lock-timeout", default="30s", help="Postgres lock_timeout for psql")
    parser.add_argument("--deploy-commit", default="unknown", help="Commit SHA for ledger rows")
    parser.add_argument("--dry-run", action="store_true", help="Print the plan without mutations")
    parser.add_argument(
        "--allow-failed-checksum-change",
        action="store_true",
        help="Allow retrying a failed row whose SQL file checksum changed",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    lock_timeout = validate_lock_timeout(args.lock_timeout)
    migrations_dir = args.dir.resolve()
    database_url = os.environ.get("DATABASE_ADMIN_URL")
    if not database_url:
        raise MigrationError("DATABASE_ADMIN_URL must be set")

    files = discover_sql_files(migrations_dir)
    if args.baseline_existing and args.baseline_through not in {f.filename for f in files}:
        raise MigrationError(f"--baseline-through file not found: {args.baseline_through}")

    engine = create_admin_engine(database_url)
    with engine.connect() as conn:
        if not current_user_can_bypass_rls(conn):
            raise MigrationError(
                "DATABASE_ADMIN_URL user must be superuser or BYPASSRLS for the "
                "current FORCE RLS ledger implementation"
            )
        conn.commit()

        if args.dry_run:
            ledger_rows = load_ledger(conn)
            conn.commit()
            existing_db = table_exists(conn, KNOWN_EXISTING_TABLE)
            conn.commit()
            actions = plan_migrations(
                files,
                ledger_rows,
                existing_db=existing_db,
                baseline_existing=args.baseline_existing,
                baseline_through=args.baseline_through,
                allow_failed_checksum_change=args.allow_failed_checksum_change,
            )
            print_plan(actions, dry_run=True)
            return 0

        acquire_advisory_lock(conn)
        try:
            ensure_ledger_schema(database_url, migrations_dir, lock_timeout=lock_timeout)
            ledger_rows = load_ledger(conn)
            conn.commit()
            existing_db = table_exists(conn, KNOWN_EXISTING_TABLE)
            conn.commit()
            actions = plan_migrations(
                files,
                ledger_rows,
                existing_db=existing_db,
                baseline_existing=args.baseline_existing,
                baseline_through=args.baseline_through,
                allow_failed_checksum_change=args.allow_failed_checksum_change,
            )
            execute_actions(
                conn,
                actions,
                database_url=database_url,
                deploy_commit=args.deploy_commit,
                lock_timeout=lock_timeout,
            )
        finally:
            # If a DML statement failed after the psql subprocess returned,
            # clear any open transaction so the session-level advisory lock can
            # still be released cleanly.
            conn.rollback()
            release_advisory_lock(conn)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except MigrationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
