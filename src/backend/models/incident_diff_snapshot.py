"""wims.incident_diff_snapshots model — stores the 'before' snapshot for diff view."""

import datetime

from sqlalchemy import ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class IncidentDiffSnapshot(Base):
    """One row per incident that has a pending diff to show the validator.

    snapshot_reason values:
      REJECTED              — validator rejected; snapshot captured at rejection time
      UPDATE_EXISTING_PENDING — encoder replaced data on an existing PENDING incident
      SUPERSEDES_VERIFIED   — encoder created a new submission superseding a verified one
    """

    __tablename__ = "incident_diff_snapshots"
    __table_args__ = {"schema": "wims"}

    snapshot_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("wims.fire_incidents.incident_id"),
        unique=True,
        nullable=False,
    )
    original_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    snapshot_reason: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(server_default=func.now())
