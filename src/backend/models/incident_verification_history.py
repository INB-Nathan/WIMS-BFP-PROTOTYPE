"""wims.incident_verification_history model — Forensic Audit."""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Enum, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

if TYPE_CHECKING:
    pass


class TargetType(str, enum.Enum):
    """CHECK (target_type IN ('OFFICIAL', 'CITIZEN'))."""

    OFFICIAL = "OFFICIAL"
    CITIZEN = "CITIZEN"


class IncidentVerificationHistory(Base):
    """Captures status changes for fire_incidents and citizen_reports."""

    __tablename__ = "incident_verification_history"
    __table_args__ = (
        CheckConstraint(
            "target_type IN ('OFFICIAL', 'CITIZEN')",
            name="incident_verification_history_target_type_check",
        ),
        {"schema": "wims"},
    )

    history_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    target_type: Mapped[TargetType] = mapped_column(
        Enum(TargetType),
        nullable=False,
    )
    target_id: Mapped[int] = mapped_column(nullable=False)
    action_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("wims.users.user_id"),
        nullable=False,
    )
    previous_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    new_status: Mapped[str] = mapped_column(String(20), nullable=False)
    action_timestamp: Mapped[datetime] = mapped_column(
        server_default=text("now()"),
        nullable=False,
    )
