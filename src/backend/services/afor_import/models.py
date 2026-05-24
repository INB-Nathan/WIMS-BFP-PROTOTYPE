"""Shared Pydantic types for the AFOR import module."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class AforParsedRow(BaseModel):
    row_index: int
    status: str  # VALID | INVALID
    errors: list[str]
    data: dict[str, Any]


AforFormKind = Literal["STRUCTURAL_AFOR", "WILDLAND_AFOR"]
WildlandRowSource = Literal["AFOR_IMPORT", "MANUAL"]


class AforParseResponse(BaseModel):
    total_rows: int
    valid_rows: int
    invalid_rows: int
    rows: list[AforParsedRow]
    form_kind: AforFormKind
    # True when the file does not supply reliable WGS84 coordinates; client must collect lat/lon before commit.
    requires_location: bool = True


DuplicateAction = Literal["skip", "merge", "force"]


class RowResolution(BaseModel):
    row_index: int
    action: DuplicateAction
    existing_incident_id: int | None = None


class AforCommitRequest(BaseModel):
    rows: list[dict[str, Any]]
    form_kind: AforFormKind = "STRUCTURAL_AFOR"
    wildland_row_source: WildlandRowSource | None = None
    # WGS84 (SRID 4326). PostGIS stores POINT(longitude latitude), not GeoJSON [lat, lon].
    latitude: float | None = None
    longitude: float | None = None
    # M4-D: per-row duplicate resolutions on second commit call.
    # None means first call: backend runs duplicate scan and may return DUPLICATE_CHECK_REQUIRED.
    resolutions: list[RowResolution] | None = None


class AforCommitResponse(BaseModel):
    status: str
    batch_id: int
    incident_ids: list[int]
    total_committed: int
