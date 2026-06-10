from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel


class FireStatus(str, Enum):
    ACTIVE = "ACTIVE"
    CONTAINED = "CONTAINED"
    FIRE_OUT = "FIRE_OUT"


class OperationCreate(BaseModel):
    fire_status: FireStatus
    start_time: datetime
    location: str
    size_hectares: Optional[float] = None
    notes: Optional[str] = None


class OperationUpdate(BaseModel):
    fire_status: Optional[FireStatus] = None
    start_time: Optional[datetime] = None
    location: Optional[str] = None
    size_hectares: Optional[float] = None
    notes: Optional[str] = None


class OperationResponse(BaseModel):
    operation_id: int
    fire_status: FireStatus
    start_time: datetime
    location: str
    size_hectares: Optional[float]
    notes: Optional[str]
    created_by: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime
    linked_report_ids: list[int] = []

    class Config:
        from_attributes = True


class LinkReportRequest(BaseModel):
    report_id: int
