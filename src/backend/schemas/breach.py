"""Pydantic schemas for breach_notifications (M10d)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class BreachStatus(str, Enum):
    DETECTED = "DETECTED"
    DPO_NOTIFIED = "DPO_NOTIFIED"
    NPC_SUBMITTED = "NPC_SUBMITTED"
    CLOSED = "CLOSED"


class BreachResponse(BaseModel):
    model_config = {"from_attributes": True}

    breach_id: int
    threat_log_id: int
    detected_at: datetime
    npc_deadline_at: datetime
    status: BreachStatus
    affected_systems: Optional[str] = None
    data_scope: Optional[str] = None
    notes: Optional[str] = None
    reported_by: Optional[UUID] = None
    npc_submitted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class BreachUpdate(BaseModel):
    status: Optional[BreachStatus] = None
    affected_systems: Optional[str] = None
    data_scope: Optional[str] = None
    notes: Optional[str] = None
