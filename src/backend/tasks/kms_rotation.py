"""Phase 6 #152 — Automated 90-day OpenBao KMS key rotation + rewrap orchestration.

Scheduled daily by Celery beat. Rotates the OpenBao Transit key used for PII
encryption when the last successful rotation exceeds OPENBAO_ROTATION_INTERVAL_DAYS
(default 90), then rewraps all affected rows to the new key version.

Single-run guard: checks for an active RUNNING row before proceeding.

Never logs plaintext, ciphertext, nonces, keys, or tokens.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text

from celery_config import celery_app
from database import _AdminSessionLocal, SYSTEM_TASK_USER_ID, set_rls_context
from services.kms.openbao_client import KmsSecurityProvider, OpenBaoClientError

logger = logging.getLogger("wims.kms.rotation")

OPENBAO_ROTATION_INTERVAL_DAYS = int(os.environ.get("OPENBAO_ROTATION_INTERVAL_DAYS", "90"))
DEFAULT_REWRAP_BATCH_SIZE = int(os.environ.get("KMS_REWRAP_BATCH_SIZE", "500"))


# ── Helpers ───────────────────────────────────────────────────────────────────


def is_rotation_due(
    last_success: datetime | None,
    interval_days: int = OPENBAO_ROTATION_INTERVAL_DAYS,
    *,
    now: datetime | None = None,
) -> bool:
    """Return True if rotation is due (last success older than interval_days).

    Args:
        last_success: ``completed_at`` of the last successful rotation run, or None.
        interval_days: Rotation interval in days (default from env).
        now: Injectible current time for test determinism.

    Returns:
        True if rotation is due, False otherwise.
    """
    if last_success is None:
        return True  # never rotated → due immediately
    cutoff = (now or datetime.now(timezone.utc)).timestamp() - (interval_days * 86400)
    return last_success.timestamp() <= cutoff


# ── Run-state mutations ───────────────────────────────────────────────────────


def start_rotation_run(
    db,
    key_name: str,
    from_version: int | None,
    to_version: int,
) -> UUID:
    """Insert a RUNNING rotation run row and return its run_id.

    Args:
        db: SQLAlchemy admin session (RLS context already set).
        key_name: Name of the OpenBao Transit key being rotated.
        from_version: Key version before rotation (None if unknown).
        to_version: Key version after rotation.

    Returns:
        The new run's UUID.
    """
    result = db.execute(
        text(
            """
            INSERT INTO wims.kms_key_rotation_runs
                (key_name, status, from_version, to_version, started_at)
            VALUES
                (:key_name, 'RUNNING', :from_version, :to_version, now())
            RETURNING run_id
            """
        ),
        {
            "key_name": key_name,
            "from_version": from_version,
            "to_version": to_version,
        },
    )
    run_id: UUID = result.scalar()
    return run_id


def mark_rotation_success(
    db,
    run_id: UUID,
    rows_scanned: int,
    rows_rewrapped: int,
    rows_skipped: int,
    rows_failed: int,
) -> None:
    """Mark a rotation run as SUCCEEDED with final counters.

    Args:
        db: SQLAlchemy admin session.
        run_id: The run to mark.
        rows_scanned: Total rows examined.
        rows_rewrapped: Rows successfully re-wrapped.
        rows_skipped: Rows already at target version.
        rows_failed: Rows where rewrap errored (should be 0 for SUCCEEDED).
    """
    db.execute(
        text(
            """
            UPDATE wims.kms_key_rotation_runs
            SET status = 'SUCCEEDED',
                completed_at = now(),
                rows_scanned = :rows_scanned,
                rows_rewrapped = :rows_rewrapped,
                rows_skipped = :rows_skipped,
                rows_failed = :rows_failed
            WHERE run_id = :run_id
            """
        ),
        {
            "run_id": run_id,
            "rows_scanned": rows_scanned,
            "rows_rewrapped": rows_rewrapped,
            "rows_skipped": rows_skipped,
            "rows_failed": rows_failed,
        },
    )


def mark_rotation_failure(
    db,
    run_id: UUID,
    rows_scanned: int,
    rows_rewrapped: int,
    rows_skipped: int,
    rows_failed: int,
    error_message: str,
) -> None:
    """Mark a rotation run as FAILED with final counters and error message.

    Args:
        db: SQLAlchemy admin session.
        run_id: The run to mark.
        rows_scanned: Total rows examined.
        rows_rewrapped: Rows successfully re-wrapped.
        rows_skipped: Rows already at target version.
        rows_failed: Rows where rewrap errored.
        error_message: Human-readable error summary (no secrets).
    """
    db.execute(
        text(
            """
            UPDATE wims.kms_key_rotation_runs
            SET status = 'FAILED',
                completed_at = now(),
                rows_scanned = :rows_scanned,
                rows_rewrapped = :rows_rewrapped,
                rows_skipped = :rows_skipped,
                rows_failed = :rows_failed,
                error_message = :error_message
            WHERE run_id = :run_id
            """
        ),
        {
            "run_id": run_id,
            "rows_scanned": rows_scanned,
            "rows_rewrapped": rows_rewrapped,
            "rows_skipped": rows_skipped,
            "rows_failed": rows_failed,
            "error_message": error_message,
        },
    )


# ── Rewrap logic ──────────────────────────────────────────────────────────────


def rewrap_openbao_rows(
    db,
    kms_provider: KmsSecurityProvider,
    run_id: UUID,
    key_name: str,
    target_version: int,
    batch_size: int = DEFAULT_REWRAP_BATCH_SIZE,
) -> dict[str, int]:
    """Rewrap all OpenBao Transit rows for *key_name* to *target_version*.

    Reads rows in cursor-paginated batches, rewraps each one via
    ``OpenBaoClient.rewrap``, and UPDATEs ``pii_blob_enc`` + ``key_version``
    (when the column exists).  Commits per batch.

    Args:
        db: SQLAlchemy admin session (RLS context already set).
        kms_provider: Initialised KmsSecurityProvider for rewrap calls.
        run_id: The rotation run UUID (for logging, not mutated here).
        key_name: OpenBao Transit key name to rewrap rows for.
        target_version: Target key version rows should be rewrapped to.
        batch_size: Rows to fetch per batch (default 500).

    Returns:
        Dict with counters: scanned, rewrapped, skipped, failed.
    """
    stats = {"scanned": 0, "rewrapped": 0, "skipped": 0, "failed": 0}

    # Detect key_version column presence for UPDATE
    has_kv_col = _has_key_version_column(db)

    cursor = 0
    while True:
        rows = db.execute(
            text(
                """
                SELECT incident_id, pii_blob_enc, key_version
                FROM wims.incident_sensitive_details
                WHERE crypto_provider = 'openbao_transit'
                  AND kms_key_name = :key_name
                  AND pii_blob_enc IS NOT NULL
                  AND incident_id > :cursor
                ORDER BY incident_id ASC
                LIMIT :batch_limit
                """
            ),
            {
                "key_name": key_name,
                "cursor": cursor,
                "batch_limit": batch_size,
            },
        ).fetchall()

        if not rows:
            break

        for row in rows:
            stats["scanned"] += 1
            incident_id: int = row.incident_id
            ciphertext: str = row.pii_blob_enc
            row_key_version: int | None = getattr(row, "key_version", None) if has_kv_col else None

            # Skip rows already at target version
            if row_key_version is not None and row_key_version == target_version:
                stats["skipped"] += 1
                continue

            # ── Rewrap ────────────────────────────────────────────────────
            try:
                aad = f"incident_id:{incident_id}".encode("utf-8")
                result = kms_provider._client.rewrap(key_name, ciphertext, aad)
                new_ct = result.ciphertext
            except OpenBaoClientError as exc:
                logger.error(
                    "Rewrap failed for incident_id=%s key=%s — skipping row. Error: %s",
                    incident_id,
                    key_name,
                    exc,
                )
                stats["failed"] += 1
                continue
            except Exception as exc:
                logger.error(
                    "Rewrap unexpected failure for incident_id=%s key=%s — skipping row. Error: %s",
                    incident_id,
                    key_name,
                    exc,
                )
                stats["failed"] += 1
                continue

            # ── Update row ────────────────────────────────────────────────
            set_parts = ["pii_blob_enc = :blob"]
            update_params: dict = {
                "iid": incident_id,
                "blob": new_ct,
            }
            if has_kv_col:
                set_parts.append("key_version = :key_version")
                update_params["key_version"] = target_version

            try:
                db.execute(
                    text(
                        f"UPDATE wims.incident_sensitive_details "
                        f"SET {', '.join(set_parts)} "
                        f"WHERE incident_id = :iid"
                    ),
                    update_params,
                )
                stats["rewrapped"] += 1
            except Exception as exc:
                logger.error(
                    "UPDATE failed for incident_id=%s during rewrap — row skipped. Error: %s",
                    incident_id,
                    exc,
                )
                stats["failed"] += 1
                continue

            cursor = incident_id  # advance keyset cursor

        # Commit batch
        try:
            db.commit()
            logger.info(
                "Rewrap batch committed — run=%s scanned=%d rewrapped=%d skipped=%d failed=%d",
                run_id,
                stats["scanned"],
                stats["rewrapped"],
                stats["skipped"],
                stats["failed"],
            )
        except Exception as exc:
            db.rollback()
            logger.error("Batch commit failed during rewrap, rolling back: %s", exc)
            stats["failed"] += 1
            # Continue with next batch if possible

    return stats


# ── Column detection ──────────────────────────────────────────────────────────


def _has_key_version_column(db) -> bool:
    """Check if wims.incident_sensitive_details has a key_version column."""
    row = db.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'wims'
                  AND table_name = 'incident_sensitive_details'
                  AND column_name = 'key_version'
            )
            """
        )
    ).scalar()
    return bool(row)


# ── Celery task entrypoint ────────────────────────────────────────────────────


@celery_app.task(name="tasks.kms_rotation.ensure_pii_key_rotation")
def ensure_pii_key_rotation() -> dict:
    """Daily check: rotate OpenBao PII key if 90 days since last rotation.

    Behaviour:
    1. Single-run guard: check for active RUNNING row.
    2. Read OpenBao key metadata via KmsSecurityProvider.
    3. Read last successful rotation run from DB.
    4. If rotation is due, rotate key, record run, rewrap rows.
    5. Mark run SUCCEEDED or FAILED; return summary dict.

    Returns:
        Dict with keys: rotated (bool), run_id (str|None), reason (str),
        counters (dict[str, int]|None).
    """
    db = _AdminSessionLocal()
    try:
        # RLS context for SYSTEM_TASK_USER_ID (SYSTEM_ADMIN service account)
        set_rls_context(db, SYSTEM_TASK_USER_ID)

        # ── 1. Single-run guard ──────────────────────────────────────────
        active = db.execute(
            text(
                """
                SELECT run_id FROM wims.kms_key_rotation_runs
                WHERE status = 'RUNNING'
                LIMIT 1
                """
            )
        ).fetchone()

        if active is not None:
            logger.info(
                "Rotation skipped — an active RUNNING run exists: %s",
                active.run_id,
            )
            return {
                "rotated": False,
                "run_id": None,
                "reason": f"active RUNNING run {active.run_id}",
                "counters": None,
            }

        # ── 2. Get key metadata from OpenBao ────────────────────────────
        try:
            kms_provider = KmsSecurityProvider()
        except OpenBaoClientError as exc:
            logger.error("Failed to initialise KmsSecurityProvider: %s", exc)
            return {
                "rotated": False,
                "run_id": None,
                "reason": f"KmsSecurityProvider init failed: {exc}",
                "counters": None,
            }

        key_name = kms_provider.kms_key_name

        try:
            metadata = kms_provider._client.metadata(key_name)
        except OpenBaoClientError as exc:
            logger.error("Failed to read OpenBao key metadata for %s: %s", key_name, exc)
            return {
                "rotated": False,
                "run_id": None,
                "reason": f"metadata read failed for {key_name}: {exc}",
                "counters": None,
            }

        from_version = metadata.latest_version

        # ── 3. Last successful rotation run ──────────────────────────────
        last = db.execute(
            text(
                """
                SELECT completed_at FROM wims.kms_key_rotation_runs
                WHERE key_name = :key_name AND status = 'SUCCEEDED'
                ORDER BY completed_at DESC
                LIMIT 1
                """
            ),
            {"key_name": key_name},
        ).fetchone()

        last_success: datetime | None = last.completed_at if last else None

        # ── 4. Due? ──────────────────────────────────────────────────────
        if not is_rotation_due(last_success):
            logger.info(
                "Rotation not due — last success=%s, interval=%d days",
                last_success,
                OPENBAO_ROTATION_INTERVAL_DAYS,
            )
            return {
                "rotated": False,
                "run_id": None,
                "reason": f"last rotation {last_success}, interval "
                f"{OPENBAO_ROTATION_INTERVAL_DAYS}d not elapsed",
                "counters": None,
            }

        # ── 5. Rotate key ───────────────────────────────────────────────
        try:
            new_metadata = kms_provider._client.rotate(key_name)
            to_version = new_metadata.latest_version
        except OpenBaoClientError as exc:
            logger.error("Key rotation failed for %s: %s", key_name, exc)
            # Record a failed run so we have a paper trail
            run_id = start_rotation_run(db, key_name, from_version, from_version or 0)
            db.commit()
            mark_rotation_failure(db, run_id, 0, 0, 0, 0, f"rotate failed: {exc}")
            db.commit()
            return {
                "rotated": False,
                "run_id": str(run_id),
                "reason": f"rotate failed: {exc}",
                "counters": {
                    "scanned": 0,
                    "rewrapped": 0,
                    "skipped": 0,
                    "failed": 0,
                },
            }

        logger.info(
            "Key %s rotated from version %s → %s",
            key_name,
            from_version,
            to_version,
        )

        # ── 5a. Record run row ───────────────────────────────────────────
        run_id = start_rotation_run(db, key_name, from_version, to_version)
        db.commit()

        # ── 5b. Rewrap rows ──────────────────────────────────────────────
        counters = rewrap_openbao_rows(db, kms_provider, run_id, key_name, to_version)

        # ── 6. Mark final status ────────────────────────────────────────
        if counters["failed"] > 0:
            mark_rotation_failure(
                db,
                run_id,
                counters["scanned"],
                counters["rewrapped"],
                counters["skipped"],
                counters["failed"],
                f"Rewrap completed with {counters['failed']} row failures",
            )
            db.commit()
            logger.warning(
                "Rotation run %s FAILED — rewrap had %d failures",
                run_id,
                counters["failed"],
            )
            return {
                "rotated": True,
                "run_id": str(run_id),
                "reason": "rewrap had failures",
                "counters": counters,
            }

        mark_rotation_success(
            db,
            run_id,
            counters["scanned"],
            counters["rewrapped"],
            counters["skipped"],
            counters["failed"],
        )
        db.commit()
        logger.info(
            "Rotation run %s SUCCEEDED — rewrapped=%d skipped=%d",
            run_id,
            counters["rewrapped"],
            counters["skipped"],
        )
        return {
            "rotated": True,
            "run_id": str(run_id),
            "reason": "rotation + rewrap completed",
            "counters": counters,
        }

    except Exception as exc:
        logger.exception("ensure_pii_key_rotation failed with unhandled error: %s", exc)
        db.rollback()
        return {
            "rotated": False,
            "run_id": None,
            "reason": f"unhandled exception: {exc}",
            "counters": None,
        }
    finally:
        db.close()
