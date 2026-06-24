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
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_meters: Optional[float] = None


class OperationUpdate(BaseModel):
    fire_status: Optional[FireStatus] = None
    start_time: Optional[datetime] = None
    location: Optional[str] = None
    size_hectares: Optional[float] = None
    notes: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_meters: Optional[float] = None


class OperationLinkedReport(BaseModel):
    report_id: int
    status: str
    category: str
    sub_category: Optional[str] = None
    reported_at: Optional[datetime] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    trust_score: Optional[int] = None
    safety_status: Optional[str] = None
    reporting_context: Optional[str] = None
    linked_operation_id: Optional[int] = None
    linked_operation_label: Optional[str] = None
    distance_meters: Optional[float] = None


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
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_meters: Optional[float] = None
    linked_report_ids: list[int] = []
    linked_reports: list[OperationLinkedReport] = []

    class Config:
        from_attributes = True


class LinkableReportSearchResponse(OperationLinkedReport):
    link_disabled: bool = False
    disabled_reason: Optional[str] = None


class LinkReportRequest(BaseModel):
    report_id: int
