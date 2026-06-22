"""System Admin API — IP blocklist routes (unblock + list).

Mounted at /ip-blocklist under the admin router, resulting in:
  - DELETE /api/admin/ip-blocklist/{ip}
  - GET    /api/admin/ip-blocklist
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_system_admin, get_db_with_rls
from services.ip_blocklist import unblock_ip, list_blocked_ips

router = APIRouter()


@router.delete("/{ip}")
async def unblock_ip_endpoint(
    ip: str,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Soft-unblock an IP. Returns 404 if the IP is not actively blocked."""
    result = await unblock_ip(db, ip, _admin["user_id"])
    if result["unblocked_rows"] == 0:
        raise HTTPException(status_code=404, detail="IP not actively blocked")
    return {"status": "ok", "ip": ip}


@router.get("")
async def list_blocked_ips_endpoint(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """List all actively blocked IPs with derived block counts."""
    return await list_blocked_ips(db)
