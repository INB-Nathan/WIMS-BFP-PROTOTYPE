"""Admin civilian contributor management schemas (issue #576)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class CivilianListItem(BaseModel):
    """One row of the admin civilian contributor list."""

    user_id: UUID
    keycloak_id: UUID
    name: str  # wims.users.username (the only persisted display identifier)
    email: str | None = None  # not persisted in wims.users;预留 for Keycloak sync
    trust_score: int
    badge: str
    status: str  # "active" | "suspended"
    report_count: int
    last_active: datetime | None = None
    date_added: datetime | None = None


class CivilianActionResponse(BaseModel):
    """Result of a suspend/activate action."""

    status: str  # "suspended" | "active"
    user_id: UUID
    keycloak_id: UUID
    suspended: bool
    warning: str | None = None


class CivilianAuditEntry(BaseModel):
    """One audit-trail row relevant to a civilian contributor."""

    action_type: str
    created_at: datetime
    new_values: dict[str, Any] | None = None
    actor_user_id: UUID | None = None


class CivilianAuditPage(BaseModel):
    """Paginated audit history for a civilian contributor."""

    items: list[CivilianAuditEntry]
    page: int
    limit: int
    total: int
