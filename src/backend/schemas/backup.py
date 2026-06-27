"""Pydantic schemas for backup management API contracts."""

from datetime import datetime

from croniter import croniter
from pydantic import BaseModel, field_validator


class BackupScheduleCreate(BaseModel):
    """Request schema for creating/updating the backup schedule."""

    enabled: bool
    cron_expr: str

    @field_validator("cron_expr")
    @classmethod
    def cron_must_be_valid(cls, v: str) -> str:
        """Validate cron expression using croniter (no hand-rolled regex)."""
        stripped = v.strip()
        try:
            croniter(stripped, datetime.now())
        except (ValueError, KeyError) as e:
            raise ValueError(f"Invalid cron expression: {e}")
        return stripped


class BackupScheduleResponse(BaseModel):
    """Response schema for backup schedule."""

    enabled: bool
    cron_expr: str
    next_run: str | None = None
    last_run_at: str | None = None
    last_backup_filename: str | None = None


class BackupFileResponse(BaseModel):
    """Response schema for a single backup file entry."""

    filename: str
    size_bytes: int
    created_at: str
    provider: str | None = None
    manifest: dict | None = None


class BackupTriggerResponse(BaseModel):
    """Response schema for trigger backup endpoint."""

    filename: str
    size_bytes: int
    created_at: str


class RestoreResponse(BaseModel):
    """Response schema for restore backup endpoint."""

    status: str
    filename: str
    restored_at: str
