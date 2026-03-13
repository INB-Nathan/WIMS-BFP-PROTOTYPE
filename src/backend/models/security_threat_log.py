"""wims.security_threat_logs model — Security telemetry."""

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, Enum, String, text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SeverityLevel(str, enum.Enum):
    """CHECK (severity_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))."""

    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class SecurityThreatLog(Base):
    """Security threat logs table."""

    __tablename__ = "security_threat_logs"
    __table_args__ = (
        CheckConstraint("suricata_sid IS NULL OR suricata_sid > 0", name="security_threat_logs_suricata_sid_check"),
        CheckConstraint(
            "severity_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')",
            name="security_threat_logs_severity_level_check",
        ),
        {"schema": "wims"},
    )

    log_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_timestamp: Mapped[datetime] = mapped_column(
        server_default=text("now()"),
        nullable=False,
    )
    source_ip: Mapped[str] = mapped_column(String(45), nullable=False)
    suricata_sid: Mapped[int | None] = mapped_column(nullable=True)
    severity_level: Mapped[SeverityLevel] = mapped_column(
        Enum(SeverityLevel),
        nullable=False,
    )
    raw_payload: Mapped[str | None] = mapped_column(String(65535), nullable=True)
    xai_narrative: Mapped[str | None] = mapped_column(String(10000), nullable=True)
