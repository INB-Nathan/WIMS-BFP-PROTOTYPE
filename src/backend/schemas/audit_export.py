"""Pydantic contracts for secure audit-export packages and verification."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


HASH_PATTERN = r"^sha256:[0-9a-f]{64}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AuditExportIdentity(StrictModel):
    user_id: UUID
    username: str | None = None
    role: str


class AuditExportCsvDialect(StrictModel):
    delimiter: Literal[","] = ","
    quoting: Literal["MINIMAL"] = "MINIMAL"
    encoding: Literal["UTF-8"] = "UTF-8"
    newline: Literal["LF"] = "LF"
    columns: list[str] = Field(min_length=1)


class AuditExportSigningKey(StrictModel):
    provider: Literal["openbao_transit"]
    key_name: str = Field(min_length=1, max_length=128)
    key_version: int = Field(ge=1)
    algorithm: Literal["sha2-256"]
    key_fingerprint: str = Field(pattern=HASH_PATTERN)


class AuditExportManifest(StrictModel):
    version: Literal[1]
    export_uuid: UUID
    exported_at: datetime
    exported_by: AuditExportIdentity
    export_scope: Literal["admin", "validator"]
    filters: dict[str, Any]
    filter_hash: str = Field(pattern=HASH_PATTERN)
    row_count: int = Field(ge=0, le=50_000)
    csv_hash: str = Field(pattern=HASH_PATTERN)
    csv_chain_final_hash: str = Field(pattern=HASH_PATTERN)
    csv_dialect: AuditExportCsvDialect
    pdf_hash: str = Field(pattern=HASH_PATTERN)
    signing_key: AuditExportSigningKey
    signature: str = Field(min_length=1, max_length=4096)


class AuditExportCheck(StrictModel):
    status: Literal["pass", "fail", "warn", "unavailable"]
    detail: str | None = None
    rows_verified: int | None = None
    hash: str | None = None
    key_version: int | None = None
    latest_export_uuid: UUID | None = None


class AuditExportVerificationResponse(StrictModel):
    verified: bool
    warnings: list[str] = Field(default_factory=list)
    checks: dict[str, AuditExportCheck]
    manifest: AuditExportManifest | None = None
