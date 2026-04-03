"""wims.citizen_reports model — Community Triage."""

import enum
import uuid
from typing import TYPE_CHECKING

from geoalchemy2 import Geography
from geoalchemy2.elements import WKBElement
from sqlalchemy import CheckConstraint, Enum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, validates

from .base import Base
from .geometry_validation import validate_location

if TYPE_CHECKING:
    pass


class CitizenReportStatus(str, enum.Enum):
    """CHECK (status IN ('PENDING', 'VERIFIED', 'FALSE_ALARM', 'DUPLICATE'))."""

    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    FALSE_ALARM = "FALSE_ALARM"
    DUPLICATE = "DUPLICATE"


class CitizenReport(Base):
    """Community Triage table."""

    __tablename__ = "citizen_reports"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'VERIFIED', 'FALSE_ALARM', 'DUPLICATE')",
            name="citizen_reports_status_check",
        ),
        CheckConstraint(
            "trust_score >= -100 AND trust_score <= 100",
            name="citizen_reports_trust_score_check",
        ),
        {"schema": "wims"},
    )

    report_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    location: Mapped[WKBElement] = mapped_column(
        Geography(geometry_type="POINT", srid=4326),
        nullable=False,
    )
    status: Mapped[CitizenReportStatus] = mapped_column(
        Enum(CitizenReportStatus),
        default=CitizenReportStatus.PENDING,
    )
    trust_score: Mapped[int] = mapped_column(default=0)
    validated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("wims.users.user_id"),
        nullable=True,
    )
    verified_incident_id: Mapped[int | None] = mapped_column(
        ForeignKey("wims.fire_incidents.incident_id"),
        nullable=True,
    )

    @validates("location")
    def _validate_location(self, _key: str, value: object) -> object:
        return validate_location(value)
