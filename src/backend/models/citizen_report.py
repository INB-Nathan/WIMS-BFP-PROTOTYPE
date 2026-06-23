"""wims.citizen_reports model — Community Triage."""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from geoalchemy2 import Geography
from geoalchemy2.elements import WKBElement
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, validates

from .base import Base
from .geometry_validation import validate_location

if TYPE_CHECKING:
    pass


class CitizenReportStatus(str, enum.Enum):
    """Civilian Reporting Phase 2 row statuses."""

    PENDING = "PENDING"
    UNDER_REVIEW = "UNDER_REVIEW"
    LINKED = "LINKED"
    ACTIONED = "ACTIONED"
    REJECTED_BOGUS = "REJECTED_BOGUS"
    REJECTED_DUPLICATE = "REJECTED_DUPLICATE"
    REJECTED_INSUFFICIENT = "REJECTED_INSUFFICIENT"
    REJECTED_TIMEOUT = "REJECTED_TIMEOUT"


class CitizenReport(Base):
    """Civilian public signal report table."""

    __tablename__ = "citizen_reports"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'UNDER_REVIEW', 'LINKED', 'ACTIONED', "
            "'REJECTED_BOGUS', 'REJECTED_DUPLICATE', 'REJECTED_INSUFFICIENT', "
            "'REJECTED_TIMEOUT')",
            name="citizen_reports_status_check",
        ),
        CheckConstraint(
            "trust_score >= 0 AND trust_score <= 100",
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
    category: Mapped[str] = mapped_column(String(32))
    sub_category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reporting_context: Mapped[str] = mapped_column(String(32), default="WITNESS")
    safety_status: Mapped[str] = mapped_column(String(32), default="UNKNOWN")
    witness_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    witness_phone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    device_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    linked_to_report_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("wims.citizen_reports.report_id"),
        nullable=True,
    )
    link_count: Mapped[int] = mapped_column(default=0)
    previous_report_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("wims.citizen_reports.report_id"),
        nullable=True,
    )
    phone_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    phone_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_warning_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    validated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("wims.users.user_id"),
        nullable=True,
    )
    verified_incident_id: Mapped[int | None] = mapped_column(
        ForeignKey("wims.fire_incidents.incident_id"),
        nullable=True,
    )
    # ── Encrypted witness PII blob (PR #429) ────────────────────────
    witness_pii_blob_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    witness_encryption_iv: Mapped[str | None] = mapped_column(Text, nullable=True)
    witness_crypto_provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    witness_key_version: Mapped[int | None] = mapped_column(Integer, nullable=True)

    @validates("location")
    def _validate_location(self, _key: str, value: object) -> object:
        return validate_location(value)
