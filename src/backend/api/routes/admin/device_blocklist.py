"""System Admin API — device blocklist routes (unblock + list).

Mounted at /device-blocklist under the admin router, resulting in:
  - DELETE /api/admin/device-blocklist/{token_hash}
  - GET    /api/admin/device-blocklist

Pattern follows api/routes/admin/ip_blocklist.py.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_system_admin, get_db_with_rls
from services.device_blocklist import unblock_device, list_blocked_devices

router = APIRouter()


@router.delete("/{token_hash}")
async def unblock_device_endpoint(
    token_hash: str,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Soft-unblock a device. Returns 404 if the device is not actively blocked."""
    result = await unblock_device(db, token_hash, _admin["user_id"])
    if result["unblocked_rows"] == 0:
        raise HTTPException(status_code=404, detail="Device not actively blocked")
    return {"status": "ok", "device_token_hash": token_hash}


@router.get("")
async def list_blocked_devices_endpoint(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """List all actively blocked devices with derived block counts."""
    return await list_blocked_devices(db)
