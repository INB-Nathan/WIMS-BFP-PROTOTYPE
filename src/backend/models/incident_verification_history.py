"""wims.incident_verification_history — Audit trail for every validator status decision."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class TargetType(str, enum.Enum):
    """Type of record being reviewed by the validator."""

    OFFICIAL = "OFFICIAL"  # wims.fire_incidents (encoder-submitted)
    CIVILIAN = "CIVILIAN"  # wims.citizen_reports (public DMZ submission)


class IncidentVerificationHistory(Base):
    """Records every status decision made by a NATIONAL_VALIDATOR.

    One row per decision.  Never updated — only inserted.
    """

    __tablename__ = "incident_verification_history"
    __table_args__ = {"schema": "wims"}

    history_id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True
    )

    # Which record was acted upon
    target_type: Mapped[TargetType] = mapped_column(String(16), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)

    # Who made the decision
    action_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("wims.users.user_id"),
        nullable=False,
    )

    # What the status was before and after
    previous_status: Mapped[str] = mapped_column(String(32), nullable=False)
    new_status: Mapped[str] = mapped_column(String(32), nullable=False)

    # Optional free-text reason / notes from the validator
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    action_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
