"""Pydantic schemas for RA 10173 privacy-rights endpoints (M10)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class SubjectType(str, Enum):
    USER = "USER"
    REPORT = "REPORT"


class ConsentAction(str, Enum):
    GRANTED = "GRANTED"
    WITHDRAWN = "WITHDRAWN"


# ── Consent ──────────────────────────────────────────────────────────────────


class ConsentRequest(BaseModel):
    subject_type: SubjectType
    subject_id: str
    consent_type: str = Field(..., max_length=100)
    action: ConsentAction


class ConsentRecord(BaseModel):
    consent_id: int
    subject_type: SubjectType
    subject_id: str
    consent_type: str
    action: ConsentAction
    recorded_at: datetime


# ── Export ────────────────────────────────────────────────────────────────────


class ExportResponse(BaseModel):
    subject_type: SubjectType
    subject_id: str
    exported_at: datetime
    user_profile: Optional[dict[str, Any]] = None
    citizen_report: Optional[dict[str, Any]] = None
    incident_sensitive_details: Optional[dict[str, Any]] = None
    consent_history: list[ConsentRecord] = []


# ── Anonymize ─────────────────────────────────────────────────────────────────


class AnonymizeRequest(BaseModel):
    subject_type: SubjectType
    subject_id: str
    confirm: bool

    @field_validator("confirm")
    @classmethod
    def must_confirm(cls, v: bool) -> bool:
        if not v:
            raise ValueError("confirm must be true to proceed with irreversible anonymization")
        return v


class AnonymizeResponse(BaseModel):
    anonymized: bool
    subject_type: SubjectType
    subject_id: str
    tables_affected: list[str]
    warning: str = "irreversible"
