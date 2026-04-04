"""wims.users model — Identity & Actors."""

import enum
import uuid

from sqlalchemy import CheckConstraint, Enum, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class UserRole(str, enum.Enum):
    """FRS roles — must match users_role_check in the DB schema."""

    CIVILIAN_REPORTER = "CIVILIAN_REPORTER"
    REGIONAL_ENCODER = "REGIONAL_ENCODER"
    NATIONAL_VALIDATOR = "NATIONAL_VALIDATOR"
    NATIONAL_ANALYST = "NATIONAL_ANALYST"
    SYSTEM_ADMIN = "SYSTEM_ADMIN"


class User(Base):
    """Identity & Actors table."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role IN ('CIVILIAN_REPORTER', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN')",
            name="users_role_check",
        ),
        {"schema": "wims"},
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default="gen_random_uuid()",
    )
    keycloak_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        unique=True,
        nullable=False,
    )
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole),
        nullable=False,
    )
