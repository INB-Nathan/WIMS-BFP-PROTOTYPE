"""System Admin API — offline sync failure management.

Tracks sync operations that have exceeded retry limits across all encoders,
surfacing them for admin intervention (retry / remove from queue).
"""

from typing import Annotated
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException

from auth import get_system_admin

router = APIRouter()

# ── In-memory failure log (per-session, reset on restart) ──────────────────
# Keys are opId strings. Production would store this in PostgreSQL.
_failed_syncs: dict[str, dict] = {}


@router.get("/sync/failed")
def list_failed_syncs(
    _admin: Annotated[dict, Depends(get_system_admin)],
):
    """List sync ops that have reached the retry ceiling."""
    return {
        "items": sorted(
            _failed_syncs.values(),
            key=lambda r: r.get("failed_at", ""),
            reverse=True,
        ),
        "total": len(_failed_syncs),
    }


@router.post("/sync/report")
async def report_sync_failure(payload: dict, _admin: Annotated[dict, Depends(get_system_admin)]):
    """Report a sync op that has permanently failed (called by sync engine)."""
    op_id = payload.get("localId")
    if not op_id:
        raise HTTPException(status_code=400, detail="localId is required")
    _failed_syncs[str(op_id)] = {
        "localId": op_id,
        "operation": payload.get("operation", "unknown"),
        "errorCode": payload.get("errorCode"),
        "errorMessage": payload.get("errorMessage", ""),
        "encoderId": payload.get("encoderId", ""),
        "regionId": payload.get("regionId"),
        "retryCount": payload.get("retryCount", 0),
        "failed_at": datetime.now(timezone.utc).isoformat(),
    }
    return {"status": "logged"}


@router.post("/sync/{op_id}/retry")
async def retry_sync_op(
    op_id: str,
    _admin: Annotated[dict, Depends(get_system_admin)],
):
    """Reset a failed sync op so the client will retry on next sync cycle.

    The actual retry happens client-side (IndexedDB); this endpoint clears the
    server-side failure record so the admin dashboard reflects the reset.
    """
    if op_id not in _failed_syncs:
        raise HTTPException(status_code=404, detail="Sync op not found")
    _failed_syncs.pop(op_id)
    return {"status": "retry", "opId": op_id}


@router.delete("/sync/{op_id}")
async def delete_sync_op(
    op_id: str,
    _admin: Annotated[dict, Depends(get_system_admin)],
):
    """Remove a failed sync op from the queue entirely (admin override)."""
    if op_id not in _failed_syncs:
        raise HTTPException(status_code=404, detail="Sync op not found")
    _failed_syncs.pop(op_id)
    return {"status": "deleted", "opId": op_id}
