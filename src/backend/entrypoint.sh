#!/bin/bash
set -e

# WIMS Backend Entrypoint
# 
# Validates Alembic migration status and resyncs Redis blocklist before
# launching uvicorn. Works around a uvicorn lifespan protocol hang observed
# on the VPS (uvicorn 0.50.0 / Python 3.12): with --lifespan off, uvicorn
# never sends the lifespan.startup event, so @app.on_event("startup")
# handlers never run.
#
# Schema DDL (previously in apply_schema_patches()) runs via Alembic
# migrations (0002_startup_schema_patches.py), not at every boot.
#
# Env vars:
#   SKIP_MIGRATION_CHECK=1 — skip the Alembic head check (break-glass)
#   SKIP_STARTUP_HANDLERS=1 — legacy alias for SKIP_MIGRATION_CHECK=1

# Compute skip-flag — accept both SKIP_MIGRATION_CHECK (new) and SKIP_STARTUP_HANDLERS (legacy).
_SKIP="${SKIP_MIGRATION_CHECK:-0}"
[ "$_SKIP" = "0" ] && _SKIP="${SKIP_STARTUP_HANDLERS:-0}"

if [ "$1" = "uvicorn" ] && [ "$_SKIP" != "1" ]; then
    echo "[entrypoint] === Checking Alembic migration status ==="
    # Verify the database is at the latest migration before starting.
    # alembic check returns 0 when current == head.
    if ! alembic check 2>/dev/null; then
        CURRENT=$(alembic current 2>/dev/null | head -1)
        HEAD=$(alembic heads 2>/dev/null | head -1)
        echo "[entrypoint] WARNING: Database may not be at latest migration"
        echo "[entrypoint]   Current: ${CURRENT:-unknown}"
        echo "[entrypoint]   Head:    ${HEAD:-unknown}"
        if [ "${SKIP_MIGRATION_CHECK:-0}" != "1" ]; then
            echo "[entrypoint] FATAL: Migration check failed. Set SKIP_MIGRATION_CHECK=1 to bypass." >&2
            exit 1
        fi
        echo "[entrypoint] SKIP_MIGRATION_CHECK=1 set — bypassing migration check"
    else
        echo "[entrypoint] Alembic migrations are up to date"
    fi

    echo "[entrypoint] === Resyncing blocklist from Postgres to Redis ==="
    if ! python3 << 'PYEOF'
import asyncio
from main import _resync_blocklist_on_boot
asyncio.run(_resync_blocklist_on_boot())
print("[entrypoint] Blocklist resync completed")
PYEOF
    then
        echo "[entrypoint] WARNING: blocklist resync failed (non-fatal)" >&2
    fi
    echo "[entrypoint] Startup checks done — starting uvicorn"
elif [ "$1" != "uvicorn" ]; then
    echo "[entrypoint] Non-uvicorn command ($1) — skipping startup handlers"
fi

exec "$@"
