"""System Admin API — analytics backfill route."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls
from services.analytics_read_model import backfill_analytics_facts

router = APIRouter()


@router.post("/analytics/backfill")
def backfill_analytics(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Backfill wims.analytics_incident_facts from existing VERIFIED non-archived incidents."""
    count = backfill_analytics_facts(db)
    return {"status": "ok", "synced_count": count}
