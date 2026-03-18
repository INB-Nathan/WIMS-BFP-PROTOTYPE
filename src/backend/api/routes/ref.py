"""Reference data endpoints (regions, provinces, cities)."""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user
from database import get_db

router = APIRouter(prefix="/api/ref", tags=["ref"])


@router.get("/regions")
def get_regions(
    _user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db)],
    region_id: Optional[int] = Query(None),
):
    """Return ref_regions. Optional region_id filter."""
    if region_id is not None:
        rows = db.execute(
            text("SELECT region_id, region_name, region_code FROM wims.ref_regions WHERE region_id = :rid"),
            {"rid": region_id},
        ).fetchall()
    else:
        rows = db.execute(
            text("SELECT region_id, region_name, region_code FROM wims.ref_regions ORDER BY region_id"),
        ).fetchall()
    return [
        {"region_id": r[0], "region_name": r[1], "region_code": r[2]}
        for r in rows
    ]
