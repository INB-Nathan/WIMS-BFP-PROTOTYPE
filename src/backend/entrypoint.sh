#!/bin/bash
set -e

# WIMS Backend Entrypoint
# 
# Runs startup handlers explicitly before launching uvicorn, working around
# a uvicorn lifespan protocol hang observed on the VPS (uvicorn 0.50.0 /
# Python 3.12 with FastAPI @app.on_event("startup") handlers).
#
# With --lifespan off (needed to avoid the hang), uvicorn never sends the
# lifespan.startup event, so the registered @app.on_event("startup")
# handlers would never run. This entrypoint calls them directly.
#
# Only runs for uvicorn commands. Celery worker, shell, and other commands
# skip the startup handlers.
#
# Env var SKIP_STARTUP_HANDLERS=1 unconditionally skips the handler step.

if [ "$1" = "uvicorn" ] && [ "${SKIP_STARTUP_HANDLERS:-0}" != "1" ]; then
    echo "[entrypoint] === Running startup handlers before uvicorn ==="
    if ! python3 << 'PYEOF'
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

from main import apply_schema_patches, _resync_blocklist_on_boot
import asyncio

print("[entrypoint] Applying schema patches...")
apply_schema_patches()
print("[entrypoint] Schema patches done. Resyncing blocklist...")
asyncio.run(_resync_blocklist_on_boot())
print("[entrypoint] Startup handlers completed successfully")
PYEOF
    then
        echo "[entrypoint] FATAL: startup handlers failed" >&2
        exit 1
    fi
    echo "[entrypoint] Startup handlers finished — starting uvicorn"
elif [ "$1" != "uvicorn" ]; then
    echo "[entrypoint] Non-uvicorn command ($1) — skipping startup handlers"
fi

exec "$@"
