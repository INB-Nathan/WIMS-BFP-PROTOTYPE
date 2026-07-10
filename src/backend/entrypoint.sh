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
    echo "[entrypoint] === Running Alembic migrations ==="
    alembic upgrade head
    echo "[entrypoint] === Migration status ==="
    alembic current

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
