"""wims.fire_incidents model — Verified Incidents."""

import enum
import uuid
from typing import TYPE_CHECKING

from geoalchemy2 import Geography
from geoalchemy2.elements import WKBElement
from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, validates

from .base import Base
from .geometry_validation import validate_location

if TYPE_CHECKING:
    pass


class VerificationStatus(str, enum.Enum):
    """CHECK (verification_status IN ('DRAFT', 'PENDING', 'VERIFIED', 'REJECTED'))."""

    DRAFT = "DRAFT"
    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"


class FireIncident(Base):
    """Verified Incidents table."""

    __tablename__ = "fire_incidents"
    __table_args__ = (
        CheckConstraint(
            "verification_status IN ('DRAFT', 'PENDING', 'VERIFIED', 'REJECTED')",
            name="fire_incidents_verification_status_check",
        ),
        {"schema": "wims"},
    )

    incident_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    location: Mapped[WKBElement] = mapped_column(
        Geography(geometry_type="POINT", srid=4326),
        nullable=False,
    )
    encoder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("wims.users.user_id"),
        nullable=True,
    )
    verification_status: Mapped[VerificationStatus] = mapped_column(
        Enum(VerificationStatus),
        default=VerificationStatus.DRAFT,
    )
    region_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("wims.ref_regions.region_id"),
        nullable=False,
    )
    import_batch_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("wims.data_import_batches.batch_id"),
        nullable=True,
    )
    is_archived: Mapped[bool] = mapped_column(default=False)

    @validates("location")
    def _validate_location(self, _key: str, value: object) -> object:
        return validate_location(value)
