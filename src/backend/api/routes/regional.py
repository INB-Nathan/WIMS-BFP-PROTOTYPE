"""Regional Office API — AFOR Import, Region-Scoped Incidents, Stats.

All endpoints protected by get_regional_encoder (REGIONAL_ENCODER role + assigned_region_id).
Data isolation: every query filters by the user's assigned_region_id.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import math
import re
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_regional_encoder
from database import get_db
from services.analytics_read_model import sync_incidents_batch
from utils.crypto import SecurityProvider, SecurityProviderError


# ── Lazy SecurityProvider singleton (avoids import-time env check in test mocks) ──
_sp_instance: SecurityProvider | None = None


def _get_security_provider() -> SecurityProvider:
    global _sp_instance  # noqa: PLW0603
    if _sp_instance is None:
        _sp_instance = SecurityProvider()
    return _sp_instance

logger = logging.getLogger("wims.regional")

router = APIRouter(prefix="/api/regional", tags=["regional"])


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

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


class AforCommitRequest(BaseModel):
    form_kind: AforFormKind
    rows: list[dict[str, Any]]
    # WILDLAND_AFOR: MANUAL for manual entry; omit or AFOR_IMPORT for file import.
    wildland_row_source: WildlandRowSource | None = None
    # WGS84 (SRID 4326). PostGIS stores POINT(longitude latitude) — not GeoJSON [lat, lon].
    latitude: float | None = None
    longitude: float | None = None


class AforCommitResponse(BaseModel):
    status: str
    batch_id: int
    incident_ids: list[int]
    total_committed: int


class RegionalStatsResponse(BaseModel):
    total_incidents: int
    by_category: list[dict[str, Any]]
    by_alarm_level: list[dict[str, Any]]
    by_status: list[dict[str, Any]]


AFOR_WGS84_INVALID_CODE = "AFOR_WGS84_INVALID"
AFOR_WGS84_INVALID_MESSAGE = (
    "AFOR commit requires valid WGS84 latitude and longitude as JSON numbers "
    "(latitude -90..90, longitude -180..180, both finite). "
    "PostGIS stores POINT(longitude latitude) in SRID 4326; do not confuse with GeoJSON [lat, lon]."
)


def _wgs84_pair_from_raw(latitude: Any, longitude: Any) -> tuple[float, float]:
    """Return (longitude, latitude) for ST_MakePoint. Validates JSON types from the raw request body."""
    if latitude is None or longitude is None:
        raise HTTPException(
            status_code=400,
            detail={"code": AFOR_WGS84_INVALID_CODE, "message": AFOR_WGS84_INVALID_MESSAGE},
        )
    if type(latitude) is bool or type(longitude) is bool:
        raise HTTPException(
            status_code=400,
            detail={"code": AFOR_WGS84_INVALID_CODE, "message": AFOR_WGS84_INVALID_MESSAGE},
        )
    if type(latitude) not in (int, float) or type(longitude) not in (int, float):
        raise HTTPException(
            status_code=400,
            detail={"code": AFOR_WGS84_INVALID_CODE, "message": AFOR_WGS84_INVALID_MESSAGE},
        )
    lat = float(latitude)
    lon = float(longitude)
    if not math.isfinite(lat) or not math.isfinite(lon):
        raise HTTPException(
            status_code=400,
            detail={"code": AFOR_WGS84_INVALID_CODE, "message": AFOR_WGS84_INVALID_MESSAGE},
        )
    if lat < -90.0 or lat > 90.0 or lon < -180.0 or lon > 180.0:
        raise HTTPException(
            status_code=400,
            detail={"code": AFOR_WGS84_INVALID_CODE, "message": AFOR_WGS84_INVALID_MESSAGE},
        )
    return lon, lat


# ---------------------------------------------------------------------------
# AFOR Parsing Utilities (Official BFP XLSX Refactor)
# ---------------------------------------------------------------------------

ALARM_LEVEL_MAP = {
    "1ST": "First Alarm",
    "1ST ALARM": "First Alarm",
    "FIRST": "First Alarm",
    "FIRST ALARM": "First Alarm",
    "2ND": "Second Alarm",
    "2ND ALARM": "Second Alarm",
    "SECOND": "Second Alarm",
    "SECOND ALARM": "Second Alarm",
    "3RD": "Third Alarm",
    "3RD ALARM": "Third Alarm",
    "THIRD": "Third Alarm",
    "THIRD ALARM": "Third Alarm",
    "4TH": "Fourth Alarm",
    "4TH ALARM": "Fourth Alarm",
    "FOURTH": "Fourth Alarm",
    "FOURTH ALARM": "Fourth Alarm",
    "5TH": "Fifth Alarm",
    "5TH ALARM": "Fifth Alarm",
    "FIFTH": "Fifth Alarm",
    "FIFTH ALARM": "Fifth Alarm",
    "TF ALPHA": "Task Force Alpha",
    "TASK FORCE ALPHA": "Task Force Alpha",
    "TF BRAVO": "Task Force Bravo",
    "TASK FORCE BRAVO": "Task Force Bravo",
    "TF CHARLIE": "Task Force Charlie",
    "TASK FORCE CHARLIE": "Task Force Charlie",
    "TF DELTA": "Task Force Delta",
    "TASK FORCE DELTA": "Task Force Delta",
    "GENERAL": "General Alarm",
    "GENERAL ALARM": "General Alarm",
}


def _safe_int(val: Any, default: int = 0) -> int:
    if val is None or val == "" or val == "N/A":
        return default
    try:
        if isinstance(val, (int, float)):
            return int(val)
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return default


def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None or val == "" or val == "N/A":
        return default
    try:
        return float(str(val).strip())
    except (ValueError, TypeError):
        return default


def _safe_dt(val: Any) -> str | None:
    """Safe datetime string conversion."""
    if isinstance(val, datetime):
        return val.isoformat()
    if not val:
        return None
    
    dt_str = str(val).strip()
    for fmt in ["%Y-%m-%d %H:%M", "%m-%d-%Y %H:%M", "%H:%M", "%Y-%m-%d", "%m-%d-%Y", "%m/%d/%Y"]:
        try:
            return datetime.strptime(dt_str, fmt).isoformat()
        except ValueError:
            continue
    return None


_COORD_RE = re.compile(r"^([A-Z]+)(\d+)$")


class _SheetCell:
    def __init__(self, value: Any):
        self.value = value


def _column_letters_to_index(letters: str) -> int:
    index = 0
    for char in letters:
        index = (index * 26) + (ord(char) - ord("A") + 1)
    return index - 1


class CsvWorksheetAdapter:
    """Expose CSV cells through worksheet-like `A1` coordinates."""

    def __init__(self, rows: list[list[str]]):
        self.rows = rows

    def __getitem__(self, coord: str) -> _SheetCell:
        match = _COORD_RE.match(coord.upper())
        if not match:
            raise KeyError(f"Invalid coordinate: {coord}")

        column_letters, row_number = match.groups()
        row_idx = int(row_number) - 1
        col_idx = _column_letters_to_index(column_letters)

        value = None
        if 0 <= row_idx < len(self.rows) and 0 <= col_idx < len(self.rows[row_idx]):
            raw_value = self.rows[row_idx][col_idx]
            if isinstance(raw_value, str):
                raw_value = raw_value.strip()
            value = raw_value or None

        return _SheetCell(value)


def _looks_like_official_afor_csv(rows: list[list[str]]) -> bool:
    if not rows:
        return False

    first_column_values = [
        (row[0].strip().upper() if row and isinstance(row[0], str) else "")
        for row in rows
    ]
    return (
        "AFTER FIRE OPERATIONS REPORT" in first_column_values
        and "A. RESPONSE DETAILS" in first_column_values
    )


def _cell_str(ws: Any, coord: str) -> str:
    try:
        v = ws[coord].value
    except Exception:
        return ""
    if v is None:
        return ""
    return str(v).strip()


def _sheet_has_structural_markers(ws: Any) -> bool:
    """Official structural AFOR: title in column A row 14, section header row 18."""
    a14 = _cell_str(ws, "A14").upper()
    a18 = _cell_str(ws, "A18").upper()
    return "AFTER FIRE OPERATIONS REPORT" in a14 and "A. RESPONSE DETAILS" in a18


def _sheet_has_wildland_markers(ws: Any) -> bool:
    """
    Wildland workbook: main sheet title in B12 and section A header in B13.
    Tie-break: sheet name containing 'WILDLAND FIRE AFOR' wins over structural when both match.
    """
    b12 = _cell_str(ws, "B12").upper()
    b13 = _cell_str(ws, "B13").upper()
    if "WILDLAND" in b12 and "A. DATES" in b13:
        return True
    if "WILDLAND FIRE" in b12:
        return True
    return False


def detect_afor_template_kind(wb: Any) -> AforFormKind | None:
    """
    Classify uploaded workbook as structural vs wildland AFOR.

    Detection:
        Wildland markers also match when B12 contains WILDLAND FIRE even if B13 is not the usual
        "A. DATES…" line (see `_sheet_has_wildland_markers`).

    Rules (order):
    1. If any sheet name contains 'WILDLAND FIRE AFOR' (case-insensitive) and that sheet
       has wildland markers (B12/B13 or title containing WILDLAND) → WILDLAND_AFOR.
    2. Else if any sheet has structural markers (A14 + A18) → STRUCTURAL_AFOR.
    3. Else if any sheet has wildland markers without relying on sheet name → WILDLAND_AFOR.
    4. Else None (ambiguous).
    """
    sheets: list[tuple[str, Any]] = [(n, wb[n]) for n in wb.sheetnames]

    for name, ws in sheets:
        if "WILDLAND FIRE AFOR" in name.upper() and _sheet_has_wildland_markers(ws):
            return "WILDLAND_AFOR"

    for name, ws in sheets:
        if _sheet_has_structural_markers(ws):
            return "STRUCTURAL_AFOR"

    for _name, ws in sheets:
        if _sheet_has_wildland_markers(ws):
            return "WILDLAND_AFOR"

    return None


def _pick_structural_worksheet(wb: Any) -> Any:
    for name in wb.sheetnames:
        if "AFOR" in name.upper():
            return wb[name]
    return wb.active


def _pick_wildland_worksheet(wb: Any) -> Any:
    for name in wb.sheetnames:
        if "WILDLAND" in name.upper() and "AFOR" in name.upper():
            return wb[name]
    for name in wb.sheetnames:
        if _sheet_has_wildland_markers(wb[name]):
            return wb[name]
    return wb.active


_WILDLAND_FIRE_TYPES_LOWER = {
    "fire",
    "agricultural land fire",
    "brush fire",
    "forest fire",
    "grassland fire",
    "grazing land fire",
    "mineral land fire",
    "peatland fire",
}


def _normalize_wildland_fire_type(raw: Any) -> str | None:
    if raw is None:
        return None
    t = str(raw).strip().lower()
    if t in _WILDLAND_FIRE_TYPES_LOWER:
        return t
    return None


def _parse_ha_from_area_text(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip()
    m = re.search(r"([\d.]+)\s*ha", s, re.IGNORECASE)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            return None
    return None


class WildlandXlsxParser:
    """Parser for BFP wildland AFOR workbook (sheet 'WILDLAND FIRE AFOR')."""

    def __init__(self, ws: Any):
        self.ws = ws

    def get(self, coord: str) -> Any:
        val = self.ws[coord].value
        if val is None:
            return None
        if isinstance(val, str):
            return val.strip()
        return val

    def parse(self) -> dict[str, Any]:
        def _dt_cell(coord: str) -> datetime | None:
            v = self.get(coord)
            if isinstance(v, datetime):
                return v
            return None

        call_received = _dt_cell("D15")
        fire_started = _dt_cell("D17")
        fire_arrival = _dt_cell("D19")
        fire_controlled = _dt_cell("D21")

        extras: list[str] = []
        for coord in ("E28", "E29"):
            v = self.get(coord)
            if v:
                extras.append(str(v))

        fire_behavior = {
            "elevation_ft": _safe_float(self.get("D51"), 0.0) or None,
            "relative_position_slope": self.get("D52"),
            "aspect": self.get("D53"),
            "flame_length_ft": _safe_float(self.get("D54"), 0.0) or None,
            "rate_of_spread_chains_per_hour": _safe_float(self.get("D55"), 0.0) or None,
        }

        problems: list[str] = []
        for r in range(76, 80):
            line = self.get(f"B{r}")
            if line and str(line).strip():
                problems.append(str(line).strip())

        recommendations: list[str] = []
        for r in range(83, 87):
            line = self.get(f"B{r}")
            if line and str(line).strip():
                recommendations.append(str(line).strip())

        alarm_rows: list[dict[str, Any]] = []
        for r in range(50, 65):
            status = self.get(f"J{r}")
            if not status or not str(status).strip():
                continue
            time_declared = self.get(f"K{r}")
            commander = self.get(f"L{r}")
            alarm_rows.append(
                {
                    "alarm_status": str(status).strip(),
                    "time_declared": str(time_declared).strip() if time_declared else "",
                    "ground_commander": str(commander).strip() if commander else "",
                }
            )

        raw_type = self.get("G44")
        wft = _normalize_wildland_fire_type(raw_type)

        return {
            "call_received_at": call_received,
            "fire_started_at": fire_started,
            "fire_arrival_at": fire_arrival,
            "fire_controlled_at": fire_controlled,
            "caller_transmitted_by": self.get("B33") or self.get("B32"),
            "caller_office_address": self.get("D33") or self.get("D32"),
            "call_received_by_personnel": self.get("F33") or self.get("F32"),
            "engine_dispatched": self.get("D23"),
            "incident_location_description": self.get("D31") or self.get("B31"),
            "distance_to_fire_station_km": _safe_float(self.get("D32"), 0.0)
            if self.get("D32") not in (None, "")
            else None,
            "primary_action_taken": self.get("E27"),
            "assistance_combined_summary": " | ".join(extras) if extras else None,
            "buildings_involved": _safe_int(self.get("B40")),
            "buildings_threatened": _safe_int(self.get("G40")),
            "ownership_and_property_notes": self.get("B41") or self.get("B39"),
            "total_area_burned_display": self.get("B44"),
            "total_area_burned_hectares": _parse_ha_from_area_text(self.get("B44")),
            "wildland_fire_type": wft,
            "raw_wildland_fire_type": raw_type,
            "area_type_summary": {},
            "causes_and_ignition_factors": {},
            "suppression_factors": {},
            "weather": {},
            "fire_behavior": {k: v for k, v in fire_behavior.items() if v not in (None, "", 0.0)},
            "peso_losses": {},
            "casualties": {},
            "narration": self.get("B68"),
            "problems_encountered": problems,
            "recommendations_list": recommendations,
            "prepared_by": self.get("B91"),
            "prepared_by_title": self.get("B92"),
            "noted_by": self.get("E88") or self.get("F88"),
            "noted_by_title": self.get("E91"),
            "wildland_alarm_statuses": alarm_rows,
            "wildland_assistance_rows": [],
        }


def parse_wildland_afor_report_data(data: dict[str, Any], region_id: int) -> AforParsedRow:
    """Map wildland workbook dict into commit payload + validation."""
    errors: list[str] = []

    primary = (data.get("primary_action_taken") or "").strip()
    engine = (data.get("engine_dispatched") or "").strip()
    narration = (data.get("narration") or "").strip()
    call_at = data.get("call_received_at")
    wft = data.get("wildland_fire_type")

    if not primary and not engine and not narration and not call_at and not wft:
        errors.append(
            "Missing wildland content: need at least one of call time (D15), primary action (E27), "
            "engine (D23), narration (B68), or wildland fire type (G44)."
        )

    if data.get("raw_wildland_fire_type") and not wft:
        errors.append(
            f"Wildland fire type value is not allowed: {data.get('raw_wildland_fire_type')!r}. "
            "Use the Sheet1 list (e.g. Brush Fire, Forest Fire)."
        )

    wl_payload = {k: v for k, v in data.items() if k not in ("raw_wildland_fire_type", "recommendations_list")}
    wl_payload["recommendations"] = data.get("recommendations_list") or []

    mapped: dict[str, Any] = {
        "_form_kind": "WILDLAND_AFOR",
        "_city_text": "",
        "region_id": region_id,
        "wildland": wl_payload,
    }

    status = "VALID" if not errors else "INVALID"
    return AforParsedRow(row_index=0, status=status, errors=errors, data=mapped)


def _combine_date_and_time(notification_dt: str | None, time_value: Any) -> str | None:
    if not notification_dt or not time_value:
        return None

    date_part = str(notification_dt).split("T", 1)[0]
    return _safe_dt(f"{date_part} {str(time_value).strip()}")


class BfpXlsxParser:
    """Parser for the official BFP manual entry form (AFOR)."""
    
    def __init__(self, ws):
        self.ws = ws

    def get(self, coord: str) -> Any:
        val = self.ws[coord].value
        if val is None: return None
        if isinstance(val, str): return val.strip()
        return val

    def _is_marked(self, coord: str) -> bool:
        val = str(self.get(coord)).strip().lower() if self.get(coord) else ""
        return val in ['x', '1', 'true', 'v', '✓', '✔', '/']

    def parse(self) -> dict[str, Any]:
        """Extract sections A through L into a comprehensive data dictionary."""
        
        # Section A: Response Details
        responder_type = "First Responder" if self._is_marked("B20") else ("Augmenting Team" if self._is_marked("B21") else "First Responder")
        
        # Section B: Classification
        classification = "Structural"
        cat_val = self.get("D48")
        if self._is_marked("B49"):
            classification = "Non-Structural"
            cat_val = self.get("D49")
        elif self._is_marked("B50"):
            classification = "Transportation"
            cat_val = self.get("D50")

        stage = self.get("D54") or self.get("B54")
        if stage and "pick from dropdown" in str(stage).lower():
            stage = None

        # Extent of Damage
        extent = "None / Minor"
        if self._is_marked("B57"): extent = "Confined to Object"
        elif self._is_marked("B58"): extent = "Confined to Room"
        elif self._is_marked("B59"): extent = "Confined to Structure"
        elif self._is_marked("B60"): extent = "Total Loss"
        elif self._is_marked("B61"): extent = "Extended Beyond Structure"

        # Section J: Problems
        problems = []
        prob_map = {
            "B195": "Inaccurate address", "B196": "Geographically challenged",
            "B197": "Road conditions", "B198": "Road under construction",
            "B199": "Traffic congestion", "B200": "Road accidents",
            "B201": "Vehicles failure to yield", "B202": "Natural Disasters",
            "B203": "Civil Disturbance", "B204": "Uncooperative or panicked residents",
            "B205": "Safety and security threats", "B206": "Property security or owner delays",
            "B207": "Engine failure", "B208": "Uncooperative fire auxiliary",
            "B209": "Poor water supply access", "B210": "Intense heat and smoke",
            "B211": "Structural hazards", "B212": "Equipment malfunction",
            "B213": "Poor inter-agency coordination", "B214": "Radio communication breakdown",
            "B215": "HazMat risks", "B216": "Physical exhaustion and injuries",
            "B217": "Emotional and psychological effects", "B218": "Community complaints",
            "B219": "Others"
        }
        for c, flavor in prob_map.items():
            if self._is_marked(c): problems.append(flavor)

        icp_present = self._is_marked("B102")
        icp_location = self.get("D102") if icp_present else None

        # Section I: Narrative joining (Rows 160 to 190)
        narrative_lines = []
        for r in range(160, 191):
            line = self.get(f"B{r}")
            if line: narrative_lines.append(str(line))
        
        # Section G: Other Personnel (Rows 124 to 132)
        others = []
        for r in range(124, 133):
            name = self.get(f"B{r}")
            rem = self.get(f"E{r}")
            if name and "N/A" not in str(name).upper():
                others.append({"name": name, "designation": rem or ""})

        return {
            "responder_type": responder_type,
            "fire_station_name": self.get("D20") if responder_type == "First Responder" else self.get("D21"),
            "notification_date": self.get("D22"),
            "notification_time": self.get("D23"),
            "region": self.get("D24"),
            "province": self.get("D25"),
            "city": self.get("D26"),
            "address": self.get("D27"),
            "landmark": self.get("D28"),
            "caller_info": self.get("D29"),
            "receiver": self.get("D30"),
            "engine": self.get("D31"),
            "time_dispatched": self.get("D34"),
            "time_arrived": self.get("D37"),
            "response_time": self.get("D40"),
            "distance_km": self.get("D41"),
            "alarm_level": self.get("D42"),
            "time_returned": self.get("D43"),
            "gas_liters": self.get("D44"),

            "classification": classification,
            "category": cat_val,
            "owner": self.get("D51"),
            "description": self.get("D52"),
            "origin": self.get("D53"),
            "stage": stage,
            "extent": extent,
            
            "extent_total_floor_area_sqm": self.get("D56") or self.get("D57") or self.get("D58") or self.get("D59") or self.get("D60"),
            "extent_total_land_area_hectares": self.get("D59") or self.get("D60"),
            
            "struct_aff": self.get("D62"),
            "house_aff": self.get("D63"),
            "fam_aff": self.get("D64"),
            "indiv_aff": self.get("D65"),
            "vehic_aff": self.get("D66"),

            "res_bfp_truck": self.get("D70"),
            "res_lgu_truck": self.get("D71"),
            "res_vol_truck": self.get("D72"),
            "res_bfp_amb": self.get("D73"),
            "res_non_amb": self.get("D74"),
            "res_bfp_resc": self.get("D75"),
            "res_non_resc": self.get("D76"),
            "res_others": self.get("D77"),
            "tool_scba": self.get("D79"),
            "tool_rope": self.get("D80"),
            "tool_ladder": self.get("D81"),
            "tool_hose": self.get("D82"),
            "tool_hydra": self.get("D83"),
            "tool_others": self.get("D84"),
            "hydrant_dist": self.get("D85"),

            "timeline": {
                "alarm_1st": {"time": self.get("D89"), "date": self.get("E89")},
                "alarm_2nd": {"time": self.get("D90"), "date": self.get("E90")},
                "alarm_3rd": {"time": self.get("D91"), "date": self.get("E91")},
                "alarm_4th": {"time": self.get("D92"), "date": self.get("E92")},
                "alarm_5th": {"time": self.get("D93"), "date": self.get("E93")},
                "tf_alpha": {"time": self.get("D94"), "date": self.get("E94")},
                "tf_bravo": {"time": self.get("D95"), "date": self.get("E95")},
                "tf_charlie": {"time": self.get("D96"), "date": self.get("E96")},
                "tf_delta": {"time": self.get("D97"), "date": self.get("E97")},
                "general": {"time": self.get("D98"), "date": self.get("E98")},
                "fuc": {"time": self.get("D99"), "date": self.get("E99")},
                "fo": {"time": self.get("D100"), "date": self.get("E100")}
            },
            "icp_present": icp_present,
            "icp_location": icp_location,
            
            "inj_civ_m": self.get("D106"), "inj_civ_f": self.get("E106"),
            "inj_bfp_m": self.get("D107"), "inj_bfp_f": self.get("E107"),
            "inj_aux_m": self.get("D108"), "inj_aux_f": self.get("E108"),
            "fat_civ_m": self.get("D109"), "fat_civ_f": self.get("E109"),
            "fat_bfp_m": self.get("D110"), "fat_bfp_f": self.get("E110"),
            "fat_aux_m": self.get("D111"), "fat_aux_f": self.get("E111"),

            "pod_commander": self.get("D114"),
            "pod_shift": self.get("D115"),
            "pod_nozzleman": self.get("D116"),
            "pod_lineman": self.get("D117"),
            "pod_crew": self.get("D118"),
            "pod_dpo": self.get("D119"),
            "pod_safety": self.get("D120"),
            
            "others_list": others,
            "narrative": "\n".join(narrative_lines),
            "problems": problems,
            "recommendations": self.get("B222"),
            "disposition": self.get("B229"),
            "prepared_by": self.get("C238"),
            "noted_by": self.get("F238"),

            # Backward-compatible aliases used by older tests/scripts.
            "extent_of_damage": extent,
            "structures_affected": self.get("D62"),
            "res_bfp_trucks": self.get("D70"),
            "alarm_1st": self.get("D89"),
        }


def parse_afor_report_data(data: dict, region_id: int) -> AforParsedRow:
    """Map the extracted AFOR dictionary into the strict database schema."""
    errors: list[str] = []

    def _dt(d: Any, t: Any = None) -> str | None:
        if not d:
            return None

        if t:
            date_part = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d).split(" ")[0]
            return _safe_dt(f"{date_part} {str(t).strip()}")

        return _safe_dt(d)

    notif_dt = _dt(data.get("notification_date"), data.get("notification_time"))
    
    # Split caller_info: "Name / 0917-..."
    ci = str(data.get("caller_info") or "")
    c_name = ci.split("/")[0].strip() if "/" in ci else ci
    c_num = ci.split("/")[1].strip() if "/" in ci else ""

    casualty_details = {
        "injured": {
            "civilian": {"m": _safe_int(data.get("inj_civ_m")), "f": _safe_int(data.get("inj_civ_f"))},
            "firefighter": {"m": _safe_int(data.get("inj_bfp_m")), "f": _safe_int(data.get("inj_bfp_f"))},
            "auxiliary": {"m": _safe_int(data.get("inj_aux_m")), "f": _safe_int(data.get("inj_aux_f"))},
        },
        "fatalities": {
            "civilian": {"m": _safe_int(data.get("fat_civ_m")), "f": _safe_int(data.get("fat_civ_f"))},
            "firefighter": {"m": _safe_int(data.get("fat_bfp_m")), "f": _safe_int(data.get("fat_bfp_f"))},
            "auxiliary": {"m": _safe_int(data.get("fat_aux_m")), "f": _safe_int(data.get("fat_aux_f"))},
        },
    }

    timeline = data.get("timeline") or {
        "alarm_1st": {"time": data.get("alarm_1st"), "date": data.get("notification_date")},
        "alarm_2nd": {"time": None, "date": data.get("notification_date")},
        "alarm_3rd": {"time": None, "date": data.get("notification_date")},
        "alarm_4th": {"time": None, "date": data.get("notification_date")},
        "alarm_5th": {"time": None, "date": data.get("notification_date")},
        "tf_alpha": {"time": None, "date": data.get("notification_date")},
        "tf_bravo": {"time": None, "date": data.get("notification_date")},
        "tf_charlie": {"time": None, "date": data.get("notification_date")},
        "tf_delta": {"time": None, "date": data.get("notification_date")},
        "general": {"time": None, "date": data.get("notification_date")},
        "fuc": {"time": None, "date": data.get("notification_date")},
        "fo": {"time": None, "date": data.get("notification_date")},
    }

    incident_nonsensitive_details = {
        "notification_dt": notif_dt,
        "responder_type": data.get("responder_type"),
        "fire_station_name": data.get("fire_station_name") or "",
        "alarm_level": ALARM_LEVEL_MAP.get(str(data.get("alarm_level") or "").strip().upper(), data.get("alarm_level")),
        "general_category": data.get("classification") or data.get("classification_of_involved"),
        "sub_category": data.get("category") or data.get("type_of_involved_general_category"),
        "fire_origin": data.get("origin") or data.get("area_of_origin"),
        "extent_of_damage": data.get("extent") or data.get("extent_of_damage"),
        "stage_of_fire": data.get("stage") or data.get("stage_of_fire_upon_arrival"),
        "structures_affected": _safe_int(data.get("struct_aff") if data.get("struct_aff") is not None else data.get("structures_affected")),
        "households_affected": _safe_int(data.get("house_aff")),
        "families_affected": _safe_int(data.get("fam_aff")),
        "individuals_affected": _safe_int(data.get("indiv_aff")),
        "vehicles_affected": _safe_int(data.get("vehic_aff")),
        "distance_from_station_km": _safe_float(data.get("distance_km") if data.get("distance_km") is not None else data.get("distance_from_station_km")),
        "total_response_time_minutes": _safe_int(data.get("response_time")),
        "total_gas_consumed_liters": _safe_float(data.get("gas_liters")),
        "extent_total_floor_area_sqm": _safe_float(data.get("extent_total_floor_area_sqm")),
        "extent_total_land_area_hectares": _safe_float(data.get("extent_total_land_area_hectares")),
        "resources_deployed": {
            "trucks": {
                "bfp": _safe_int(data.get("res_bfp_truck") if data.get("res_bfp_truck") is not None else data.get("res_bfp_trucks")),
                "lgu": _safe_int(data.get("res_lgu_truck")),
                "volunteer": _safe_int(data.get("res_vol_truck")),
            },
            "medical": {
                "bfp": _safe_int(data.get("res_bfp_amb")),
                "non_bfp": _safe_int(data.get("res_non_amb")),
            },
            "special_assets": {
                "rescue_bfp": _safe_int(data.get("res_bfp_resc")),
                "rescue_non_bfp": _safe_int(data.get("res_non_resc")),
                "others": str(data.get("res_others") or ""),
            },
            "tools": {
                "scba": _safe_int(data.get("tool_scba")),
                "rope": str(data.get("tool_rope") or ""),
                "ladder": _safe_int(data.get("tool_ladder")),
                "hoseline": str(data.get("tool_hose") or ""),
                "hydraulic": _safe_int(data.get("tool_hydra")),
                "others": str(data.get("tool_others") or ""),
            },
            "hydrant_distance": str(data.get("hydrant_dist") or ""),
        },
        "alarm_timeline": {
            "alarm_1st": _dt(timeline["alarm_1st"]["date"], timeline["alarm_1st"]["time"]),
            "alarm_2nd": _dt(timeline["alarm_2nd"]["date"], timeline["alarm_2nd"]["time"]),
            "alarm_3rd": _dt(timeline["alarm_3rd"]["date"], timeline["alarm_3rd"]["time"]),
            "alarm_4th": _dt(timeline["alarm_4th"]["date"], timeline["alarm_4th"]["time"]),
            "alarm_5th": _dt(timeline["alarm_5th"]["date"], timeline["alarm_5th"]["time"]),
            "alarm_tf_alpha": _dt(timeline["tf_alpha"]["date"], timeline["tf_alpha"]["time"]),
            "alarm_tf_bravo": _dt(timeline["tf_bravo"]["date"], timeline["tf_bravo"]["time"]),
            "alarm_tf_charlie": _dt(timeline["tf_charlie"]["date"], timeline["tf_charlie"]["time"]),
            "alarm_tf_delta": _dt(timeline["tf_delta"]["date"], timeline["tf_delta"]["time"]),
            "alarm_general": _dt(timeline["general"]["date"], timeline["general"]["time"]),
            "alarm_fuc": _dt(timeline["fuc"]["date"], timeline["fuc"]["time"]),
            "alarm_fo": _dt(timeline["fo"]["date"], timeline["fo"]["time"]),
        },
        "problems_encountered": data.get("problems", []),
        "recommendations": data.get("recommendations") or "",
    }

    mapped = {
        "region_id": region_id,
        "incident_nonsensitive_details": incident_nonsensitive_details,
        "incident_sensitive_details": {
            "caller_name": c_name,
            "caller_number": c_num,
            "receiver_name": data.get("receiver") or "",
            "owner_name": data.get("owner") or "",
            "establishment_name": data.get("owner") or "",
            "street_address": data.get("address") or "",
            "landmark": data.get("landmark") or "",
            "personnel_on_duty": {
                "engine_commander": data.get("pod_commander") or "",
                "shift_in_charge": data.get("pod_shift") or "",
                "nozzleman": data.get("pod_nozzleman") or "",
                "lineman": data.get("pod_lineman") or "",
                "engine_crew": data.get("pod_crew") or "",
                "driver": data.get("pod_dpo") or "",
                "pump_operator": data.get("pod_dpo") or "",
                "safety_officer": {"name": data.get("pod_safety") or "", "contact": ""}
            },
            "other_personnel": data.get("others_list", []),
            "casualty_details": casualty_details,
            "narrative_report": data.get("narrative") or "",
            "disposition": data.get("disposition") or "",
            "disposition_prepared_by": data.get("prepared_by") or "",
            "disposition_noted_by": data.get("noted_by") or "",
            "prepared_by_officer": data.get("prepared_by") or "",
            "noted_by_officer": data.get("noted_by") or "",
            "is_icp_present": bool(data.get("icp_present")),
            "icp_location": data.get("icp_location") or "",
        },
        "responding_unit": {
            "station_name": data.get("fire_station_name") or "",
            "engine_number": data.get("engine") or "",
            "responder_type": data.get("responder_type") or "",
            "dispatch_dt": _combine_date_and_time(notif_dt, data.get("time_dispatched")),
            "arrival_dt": _combine_date_and_time(notif_dt, data.get("time_arrived")),
            "return_dt": _combine_date_and_time(notif_dt, data.get("time_returned")),
        },
        "_city_text": data.get("city") or "",
        "_province_text": data.get("province") or "",
    }
    
    if not notif_dt:
        errors.append("Missing required fields: notification_dt (Check D22/D23 in XLSX)")
    if not mapped["_city_text"]:
        errors.append("Missing required fields: _city_text (City/Municipality)")

    mapped["_form_kind"] = "STRUCTURAL_AFOR"

    status = "VALID" if not errors else "INVALID"
    return AforParsedRow(row_index=0, status=status, errors=errors, data=mapped)


def parse_csv_content(content: str, region_id: int) -> tuple[list[AforParsedRow], AforFormKind]:
    """Parse either the official AFOR form-style CSV or a flat tabular CSV (structural only)."""
    rows = list(csv.reader(io.StringIO(content)))
    if _looks_like_official_afor_csv(rows):
        parser = BfpXlsxParser(CsvWorksheetAdapter(rows))
        return [parse_afor_report_data(parser.parse(), region_id)], "STRUCTURAL_AFOR"

    reader = csv.DictReader(io.StringIO(content))
    results = []
    for row in reader:
        if not any(row.values()):
            continue
        results.append(parse_afor_report_data(row, region_id))
    return results, "STRUCTURAL_AFOR"


def parse_xlsx_content(content: bytes, region_id: int) -> tuple[list[AforParsedRow], AforFormKind]:
    """Parse XLSX: detect structural vs wildland, then dispatch."""
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(content), data_only=True)
    try:
        kind = detect_afor_template_kind(wb)
        if kind is None:
            raise ValueError(
                "could not determine AFOR type. Expected either the official structural AFOR "
                "(column A: 'AFTER FIRE OPERATIONS REPORT' and 'A. RESPONSE DETAILS') or the wildland "
                "template (sheet 'WILDLAND FIRE AFOR' with section A dates in column B). "
                "See public/templates/ for sample workbooks."
            )

        if kind == "STRUCTURAL_AFOR":
            ws = _pick_structural_worksheet(wb)
            parser = BfpXlsxParser(ws)
            report_data = parser.parse()
            parsed_row = parse_afor_report_data(report_data, region_id)
            return [parsed_row], kind

        ws = _pick_wildland_worksheet(wb)
        parser = WildlandXlsxParser(ws)
        report_data = parser.parse()
        parsed_row = parse_wildland_afor_report_data(report_data, region_id)
        return [parsed_row], kind
    finally:
        wb.close()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/afor/import", response_model=AforParseResponse)
async def import_afor_file(
    file: UploadFile = File(...),
    user: dict = Depends(get_regional_encoder),
    db: Session = Depends(get_db),
):
    """
    Upload and parse an AFOR file (.xlsx or .csv).
    Returns parsed rows with validation status for preview before commit.
    """
    region_id = user["assigned_region_id"]

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("xlsx", "xls", "csv"):
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, and .csv files are supported")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="File is empty")

    try:
        if ext == "csv":
            decoded = content.decode("utf-8-sig")  # Handle BOM
            rows, form_kind = parse_csv_content(decoded, region_id)
        else:
            rows, form_kind = parse_xlsx_content(content, region_id)
    except ValueError as e:
        logger.warning("AFOR type detection failed: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to parse AFOR file: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")

    if len(rows) == 0:
        raise HTTPException(status_code=400, detail="No data rows found in file")

    valid_count = sum(1 for r in rows if r.status == "VALID")

    return AforParseResponse(
        total_rows=len(rows),
        valid_rows=valid_count,
        invalid_rows=len(rows) - valid_count,
        rows=rows,
        form_kind=form_kind,
    )


_WILDLAND_ALARM_STATUS_ALLOWED = {
    "1st Alarm",
    "2nd Alarm",
    "3rd Alarm",
    "4th Alarm",
    "Task Force Alpha",
    "Task Force Bravo",
    "General Alarm",
    "Ongoing",
    "Fire Out",
    "Fire Under Control",
    "Fire Out Upon Arrival",
    "Fire Under Investigation",
    "Late Reported",
    "Unresponded",
    "No Firefighting Conducted",
}


def _dt_for_sql(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    return val


def _commit_wildland_afor_row(
    db: Session,
    row_data: dict[str, Any],
    batch_id: int,
    user_id: Any,
    region_id: int,
    incident_ids: list[int],
    lon: float,
    lat: float,
    *,
    source: WildlandRowSource = "AFOR_IMPORT",
) -> None:
    """Insert fire_incident + incident_wildland_afor + optional alarm/assistance children."""
    wl = dict(row_data.get("wildland") or {})
    alarm_statuses: list[dict[str, Any]] = list(wl.pop("wildland_alarm_statuses", []) or [])
    assistance_rows: list[dict[str, Any]] = list(wl.pop("wildland_assistance_rows", []) or [])

    inc_row = db.execute(
        text("""
            INSERT INTO wims.fire_incidents
                (import_batch_id, encoder_id, region_id, location, verification_status)
            VALUES
                (:batch_id, CAST(:uid AS uuid), :region_id,
                 ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                 'DRAFT')
            RETURNING incident_id
        """),
        {"batch_id": batch_id, "uid": user_id, "region_id": region_id, "lon": lon, "lat": lat},
    ).fetchone()

    if not inc_row:
        return

    incident_id = inc_row[0]
    incident_ids.append(incident_id)

    params = {
        "incident_id": incident_id,
        "batch_id": batch_id,
        "source": source,
        "call_received_at": _dt_for_sql(wl.get("call_received_at")),
        "fire_started_at": _dt_for_sql(wl.get("fire_started_at")),
        "fire_arrival_at": _dt_for_sql(wl.get("fire_arrival_at")),
        "fire_controlled_at": _dt_for_sql(wl.get("fire_controlled_at")),
        "caller_transmitted_by": wl.get("caller_transmitted_by") or "",
        "caller_office_address": wl.get("caller_office_address") or "",
        "call_received_by_personnel": wl.get("call_received_by_personnel") or "",
        "engine_dispatched": wl.get("engine_dispatched") or "",
        "incident_location_description": wl.get("incident_location_description") or "",
        "distance_to_fire_station_km": wl.get("distance_to_fire_station_km"),
        "primary_action_taken": wl.get("primary_action_taken") or "",
        "assistance_combined_summary": wl.get("assistance_combined_summary") or "",
        "buildings_involved": wl.get("buildings_involved") or 0,
        "buildings_threatened": wl.get("buildings_threatened") or 0,
        "ownership_and_property_notes": wl.get("ownership_and_property_notes") or "",
        "total_area_burned_display": wl.get("total_area_burned_display") or "",
        "total_area_burned_hectares": wl.get("total_area_burned_hectares"),
        "wildland_fire_type": wl.get("wildland_fire_type") or None,
        "area_type_summary": json.dumps(wl.get("area_type_summary") or {}),
        "causes_and_ignition_factors": json.dumps(wl.get("causes_and_ignition_factors") or {}),
        "suppression_factors": json.dumps(wl.get("suppression_factors") or {}),
        "weather": json.dumps(wl.get("weather") or {}),
        "fire_behavior": json.dumps(wl.get("fire_behavior") or {}),
        "peso_losses": json.dumps(wl.get("peso_losses") or {}),
        "casualties": json.dumps(wl.get("casualties") or {}),
        "narration": wl.get("narration") or "",
        "problems_encountered": json.dumps(wl.get("problems_encountered") or []),
        "recommendations": json.dumps(wl.get("recommendations") or []),
        "prepared_by": wl.get("prepared_by") or "",
        "prepared_by_title": wl.get("prepared_by_title") or "",
        "noted_by": wl.get("noted_by") or "",
        "noted_by_title": wl.get("noted_by_title") or "",
    }

    iwa_row = db.execute(
        text("""
            INSERT INTO wims.incident_wildland_afor (
                incident_id, import_batch_id, source,
                call_received_at, fire_started_at, fire_arrival_at, fire_controlled_at,
                caller_transmitted_by, caller_office_address, call_received_by_personnel,
                engine_dispatched, incident_location_description, distance_to_fire_station_km,
                primary_action_taken, assistance_combined_summary,
                buildings_involved, buildings_threatened, ownership_and_property_notes,
                total_area_burned_display, total_area_burned_hectares, wildland_fire_type,
                area_type_summary, causes_and_ignition_factors, suppression_factors,
                weather, fire_behavior, peso_losses, casualties,
                narration, problems_encountered, recommendations,
                prepared_by, prepared_by_title, noted_by, noted_by_title
            ) VALUES (
                :incident_id, :batch_id, :source,
                CAST(:call_received_at AS timestamptz),
                CAST(:fire_started_at AS timestamptz),
                CAST(:fire_arrival_at AS timestamptz),
                CAST(:fire_controlled_at AS timestamptz),
                :caller_transmitted_by, :caller_office_address, :call_received_by_personnel,
                :engine_dispatched, :incident_location_description, :distance_to_fire_station_km,
                :primary_action_taken, :assistance_combined_summary,
                :buildings_involved, :buildings_threatened, :ownership_and_property_notes,
                :total_area_burned_display, :total_area_burned_hectares, :wildland_fire_type,
                CAST(:area_type_summary AS jsonb), CAST(:causes_and_ignition_factors AS jsonb),
                CAST(:suppression_factors AS jsonb),
                CAST(:weather AS jsonb), CAST(:fire_behavior AS jsonb),
                CAST(:peso_losses AS jsonb), CAST(:casualties AS jsonb),
                :narration, CAST(:problems_encountered AS jsonb), CAST(:recommendations AS jsonb),
                :prepared_by, :prepared_by_title, :noted_by, :noted_by_title
            )
            RETURNING incident_wildland_afor_id
        """),
        params,
    ).fetchone()

    if not iwa_row:
        return

    iwa_id = iwa_row[0]

    for order, a in enumerate(alarm_statuses):
        status = (a.get("alarm_status") or "").strip()
        if status not in _WILDLAND_ALARM_STATUS_ALLOWED:
            continue
        db.execute(
            text("""
                INSERT INTO wims.wildland_afor_alarm_statuses (
                    incident_wildland_afor_id, sort_order, alarm_status, time_declared, ground_commander
                ) VALUES (
                    :iwa_id, :sort_order, :alarm_status, :time_declared, :ground_commander
                )
            """),
            {
                "iwa_id": iwa_id,
                "sort_order": order,
                "alarm_status": status,
                "time_declared": a.get("time_declared") or "",
                "ground_commander": a.get("ground_commander") or "",
            },
        )

    for order, row in enumerate(assistance_rows):
        org = (row.get("organization_or_unit") or row.get("organization") or "").strip()
        if not org:
            continue
        db.execute(
            text("""
                INSERT INTO wims.wildland_afor_assistance_rows (
                    incident_wildland_afor_id, sort_order, organization_or_unit, detail
                ) VALUES (
                    :iwa_id, :sort_order, :organization_or_unit, :detail
                )
            """),
            {
                "iwa_id": iwa_id,
                "sort_order": order,
                "organization_or_unit": org,
                "detail": row.get("detail") or "",
            },
        )


@router.post("/afor/commit", response_model=AforCommitResponse)
async def commit_afor_import(
    request: Request,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db)],
):
    """
    Commit validated AFOR rows to the database.
    Creates a data_import_batch and inserts fire_incidents with details.
    """
    try:
        raw_body: dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from None

    body = AforCommitRequest.model_validate(raw_body)
    lon, lat = _wgs84_pair_from_raw(raw_body.get("latitude"), raw_body.get("longitude"))

    region_id = user["assigned_region_id"]
    user_id = user["user_id"]

    if not body.rows:
        raise HTTPException(status_code=400, detail="No rows to commit")

    for row_data in body.rows:
        rk = row_data.get("_form_kind")
        if rk != body.form_kind:
            raise HTTPException(
                status_code=400,
                detail="form_kind mismatch: preview rows do not match commit form_kind",
            )

    validated_wildland_rows: list[dict[str, Any]] | None = None
    if body.form_kind == "WILDLAND_AFOR":
        wildland_errors: list[str] = []
        validated_wildland_rows = []
        for idx, row_data in enumerate(body.rows):
            wl_dict = row_data.get("wildland") or {}
            parsed = parse_wildland_afor_report_data(wl_dict, region_id)
            if parsed.status != "VALID":
                for err in parsed.errors:
                    wildland_errors.append(f"Row {idx + 1}: {err}")
            else:
                validated_wildland_rows.append(parsed.data)
        if wildland_errors:
            raise HTTPException(status_code=400, detail=" ".join(wildland_errors))

    # Create import batch
    batch_row = db.execute(
        text("""
            INSERT INTO wims.data_import_batches (region_id, uploaded_by, record_count)
            VALUES (:region_id, CAST(:uid AS uuid), :count)
            RETURNING batch_id
        """),
        {"region_id": region_id, "uid": user_id, "count": len(body.rows)},
    ).fetchone()

    if not batch_row:
        raise HTTPException(status_code=500, detail="Failed to create import batch")

    batch_id = batch_row[0]
    incident_ids: list[int] = []

    wildland_source: WildlandRowSource = (
        "MANUAL" if body.wildland_row_source == "MANUAL" else "AFOR_IMPORT"
    )

    def _group_total(groups: dict[str, Any], key: str) -> int:
        bucket = groups.get(key, {}) if isinstance(groups, dict) else {}
        return _safe_int(bucket.get("m")) + _safe_int(bucket.get("f"))

    for idx, row_data in enumerate(body.rows):
        if body.form_kind == "WILDLAND_AFOR":
            assert validated_wildland_rows is not None
            _commit_wildland_afor_row(
                db,
                validated_wildland_rows[idx],
                batch_id,
                user_id,
                region_id,
                incident_ids,
                lon,
                lat,
                source=wildland_source,
            )
            continue

        ns = row_data.get("incident_nonsensitive_details", {})
        sens = row_data.get("incident_sensitive_details", {})
        casualty_details = sens.get("casualty_details", {}) if isinstance(sens.get("casualty_details", {}), dict) else {}
        injured_groups = casualty_details.get("injured", {}) if isinstance(casualty_details.get("injured", {}), dict) else {}
        fatal_groups = casualty_details.get("fatalities", {}) or casualty_details.get("fatal", {}) or {}

        inc_row = db.execute(
            text("""
                INSERT INTO wims.fire_incidents
                    (import_batch_id, encoder_id, region_id, location, verification_status)
                VALUES
                    (:batch_id, CAST(:uid AS uuid), :region_id,
                     ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                     'DRAFT')
                RETURNING incident_id
            """),
            {"batch_id": batch_id, "uid": user_id, "region_id": region_id, "lon": lon, "lat": lat},
        ).fetchone()

        if not inc_row:
            continue

        incident_id = inc_row[0]
        incident_ids.append(incident_id)

        city_text = row_data.get("_city_text", "")
        geo_ids = db.execute(
            text("""
                SELECT c.city_id
                FROM wims.ref_cities c
                WHERE LOWER(c.city_name) = LOWER(:city)
                LIMIT 1
            """),
            {"city": city_text},
        ).fetchone()
        city_id = geo_ids[0] if geo_ids else None

        db.execute(
            text("""
                INSERT INTO wims.incident_nonsensitive_details (
                    incident_id, city_id, distance_from_station_km, notification_dt,
                    alarm_level, general_category, sub_category,
                    civilian_injured, civilian_deaths, firefighter_injured, firefighter_deaths,
                    families_affected, responder_type, fire_origin, extent_of_damage,
                    structures_affected, households_affected, individuals_affected,
                    resources_deployed, alarm_timeline, problems_encountered, recommendations,
                    fire_station_name, total_response_time_minutes, total_gas_consumed_liters,
                    stage_of_fire, extent_total_floor_area_sqm, extent_total_land_area_hectares,
                    vehicles_affected
                ) VALUES (
                    :incident_id, :city_id, :distance_from_station_km, CAST(:notification_dt AS timestamptz),
                    :alarm_level, :general_category, :sub_category,
                    :civ_inj, :civ_fat, :ff_inj, :ff_fat,
                    :families_affected, :responder_type, :fire_origin, :extent_of_damage,
                    :structures_affected, :households_affected, :individuals_affected,
                    CAST(:resources_deployed AS jsonb), CAST(:alarm_timeline AS jsonb),
                    CAST(:problems_encountered AS jsonb), :recommendations,
                    :fire_station_name, :total_response_time_minutes, :total_gas_consumed_liters,
                    :stage_of_fire, :floor_area, :land_area, :vehicles_affected
                )
            """),
            {
                "incident_id": incident_id,
                "city_id": city_id,
                "distance_from_station_km": ns.get("distance_from_station_km"),
                "notification_dt": ns.get("notification_dt"),
                "alarm_level": ns.get("alarm_level", ""),
                "general_category": ns.get("general_category", ""),
                "sub_category": ns.get("sub_category", ""),
                "civ_inj": _group_total(injured_groups, "civilian"),
                "civ_fat": _group_total(fatal_groups, "civilian"),
                "ff_inj": _group_total(injured_groups, "firefighter"),
                "ff_fat": _group_total(fatal_groups, "firefighter"),
                "families_affected": ns.get("families_affected", 0),
                "responder_type": ns.get("responder_type", ""),
                "fire_origin": ns.get("fire_origin", ""),
                "extent_of_damage": ns.get("extent_of_damage", ""),
                "structures_affected": ns.get("structures_affected", 0),
                "households_affected": ns.get("households_affected", 0),
                "individuals_affected": ns.get("individuals_affected", 0),
                "resources_deployed": json.dumps(ns.get("resources_deployed", {})),
                "alarm_timeline": json.dumps(ns.get("alarm_timeline", {})),
                "problems_encountered": json.dumps(ns.get("problems_encountered", [])),
                "recommendations": ns.get("recommendations", ""),
                "fire_station_name": ns.get("fire_station_name", ""),
                "total_response_time_minutes": ns.get("total_response_time_minutes", 0),
                "total_gas_consumed_liters": ns.get("total_gas_consumed_liters", 0),
                "stage_of_fire": ns.get("stage_of_fire", ""),
                "floor_area": ns.get("extent_total_floor_area_sqm", 0),
                "land_area": ns.get("extent_total_land_area_hectares", 0),
                "vehicles_affected": ns.get("vehicles_affected", 0),
            },
        )

        # ── Encrypt PII fields before INSERT ─────────────────────────────────────
        # PII fields (caller_name, caller_number, owner_name, occupant_name) are
        # stored ONLY in the encrypted blob. Plaintext columns are set to NULL.
        # receiver_name is NOT encrypted (public / internal use only).
        #
        # caller_info arrives as "Name / Number" at the top-level row_data field;
        # owner_name / occupant_name arrive in sens (incident_sensitive_details body).
        ci = str(row_data.get("caller_info") or "")
        caller_name_row = ci.split("/")[0].strip() if "/" in ci else ci
        caller_number_row = ci.split("/")[1].strip() if "/" in ci else ""

        pii_for_blob = {
            k: v
            for k, v in (
                ("caller_name",    caller_name_row),
                ("caller_number",  caller_number_row),
                ("owner_name",     sens.get("owner_name")),
                ("occupant_name",  sens.get("occupant_name")),
            )
            if v  # omit None / falsy; empty string IS included
        }
        # Always produce a dict (empty or populated) so decrypt never raises on None
        if not pii_for_blob:
            pii_for_blob = {}

        sp = _get_security_provider()
        aad = f"incident_id:{incident_id}".encode("utf-8")
        nonce_b64, ct_b64 = sp.encrypt_json(pii_for_blob, aad)

        db.execute(
            text("""
                INSERT INTO wims.incident_sensitive_details (
                    incident_id, street_address, landmark,
                    caller_name, caller_number, receiver_name,
                    owner_name, establishment_name,
                    narrative_report, disposition,
                    disposition_prepared_by, disposition_noted_by,
                    prepared_by_officer, noted_by_officer,
                    personnel_on_duty, other_personnel, casualty_details,
                    is_icp_present, icp_location,
                    pii_blob_enc, encryption_iv
                ) VALUES (
                    :incident_id, :street_address, :landmark,
                    NULL, NULL, :receiver_name,
                    NULL, :establishment_name,
                    :narrative_report, :disposition,
                    :disposition_prepared_by, :disposition_noted_by,
                    :prepared_by_officer, :noted_by_officer,
                    CAST(:personnel_on_duty AS jsonb),
                    CAST(:other_personnel AS jsonb),
                    CAST(:casualty_details AS jsonb),
                    :is_icp_present, :icp_location,
                    :pii_blob_enc, :pii_nonce
                )
            """),
            {
                "incident_id": incident_id,
                "street_address": sens.get("street_address", ""),
                "landmark": sens.get("landmark", ""),
                # Plaintext PII columns → NULL; only pii_blob_enc is authoritative
                "receiver_name":      sens.get("receiver_name", ""),
                "establishment_name": sens.get("establishment_name", ""),
                "narrative_report":   sens.get("narrative_report", ""),
                "disposition":        sens.get("disposition", ""),
                "disposition_prepared_by": sens.get("disposition_prepared_by", ""),
                "disposition_noted_by":    sens.get("disposition_noted_by", ""),
                "prepared_by_officer":     sens.get("prepared_by_officer", ""),
                "noted_by_officer":        sens.get("noted_by_officer", ""),
                "personnel_on_duty":  json.dumps(sens.get("personnel_on_duty", {})),
                "other_personnel":    json.dumps(sens.get("other_personnel", [])),
                "casualty_details":   json.dumps(casualty_details),
                "is_icp_present": sens.get("is_icp_present", False),
                "icp_location":      sens.get("icp_location", ""),
                # Encrypted PII blob
                "pii_blob_enc": ct_b64,
                "pii_nonce":    nonce_b64,
            },
        )

        responding_unit = row_data.get("responding_unit", {})
        if any(responding_unit.get(key) for key in ("station_name", "engine_number", "dispatch_dt", "arrival_dt", "return_dt")):
            db.execute(
                text("""
                    INSERT INTO wims.responding_units (
                        incident_id, station_name, engine_number, responder_type,
                        dispatch_dt, arrival_dt, return_dt
                    ) VALUES (
                        :incident_id, :station_name, :engine_number, :responder_type,
                        CAST(:dispatch_dt AS timestamptz),
                        CAST(:arrival_dt AS timestamptz),
                        CAST(:return_dt AS timestamptz)
                    )
                """),
                {
                    "incident_id": incident_id,
                    "station_name": responding_unit.get("station_name", ""),
                    "engine_number": responding_unit.get("engine_number", ""),
                    "responder_type": responding_unit.get("responder_type", ""),
                    "dispatch_dt": responding_unit.get("dispatch_dt"),
                    "arrival_dt": responding_unit.get("arrival_dt"),
                    "return_dt": responding_unit.get("return_dt"),
                },
            )

    db.commit()

    # Sync analytics read model (only VERIFIED non-archived will appear in facts)
    sync_incidents_batch(db, incident_ids)
    db.commit()

    return AforCommitResponse(
        status="ok",
        batch_id=batch_id,
        incident_ids=incident_ids,
        total_committed=len(incident_ids),
    )


@router.get("/incidents")
def get_regional_incidents(
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    category: Optional[str] = None,
    status: Optional[str] = None,
):
    """
    Fetch fire incidents scoped to the user's assigned region.
    Joins nonsensitive details for summary view.
    """
    region_id = user["assigned_region_id"]

    where_clauses = ["fi.region_id = :region_id", "fi.is_archived = FALSE"]
    params: dict[str, Any] = {"region_id": region_id, "limit": limit, "offset": offset}

    if category:
        where_clauses.append("nd.general_category = :category")
        params["category"] = category
    if status:
        where_clauses.append("fi.verification_status = :status")
        params["status"] = status

    where_sql = " AND ".join(where_clauses)

    rows = db.execute(
        text(f"""
            SELECT fi.incident_id, fi.verification_status, fi.created_at,
                   nd.notification_dt, nd.general_category, nd.alarm_level,
                   nd.fire_station_name, nd.structures_affected,
                   nd.households_affected, nd.individuals_affected,
                   nd.responder_type, nd.fire_origin, nd.extent_of_damage,
                   sd.owner_name, sd.establishment_name, sd.caller_name
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            LEFT JOIN wims.incident_sensitive_details sd ON sd.incident_id = fi.incident_id
            WHERE {where_sql}
            ORDER BY fi.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()

    total = db.execute(
        text(f"""
            SELECT COUNT(*) FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE {where_sql}
        """),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    ).scalar() or 0

    return {
        "items": [
            {
                "incident_id": r[0],
                "verification_status": r[1],
                "created_at": r[2].isoformat() if r[2] else None,
                "notification_dt": r[3].isoformat() if r[3] else None,
                "general_category": r[4],
                "alarm_level": r[5],
                "fire_station_name": r[6],
                "structures_affected": r[7],
                "households_affected": r[8],
                "individuals_affected": r[9],
                "responder_type": r[10],
                "fire_origin": r[11],
                "extent_of_damage": r[12],
                "owner_name": r[13],
                "establishment_name": r[14],
                "caller_name": r[15],
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/incidents/{incident_id}")
def get_regional_incident_detail(
    incident_id: int,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db)],
):
    """Fetch a single incident detail, scoped to user's region."""
    region_id = user["assigned_region_id"]

    row = db.execute(
        text("""
            SELECT fi.incident_id, fi.verification_status, fi.created_at,
                   fi.region_id, fi.encoder_id
            FROM wims.fire_incidents fi
            WHERE fi.incident_id = :iid AND fi.region_id = :rid AND fi.is_archived = FALSE
        """),
        {"iid": incident_id, "rid": region_id},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Incident not found in your region")

    # Fetch nonsensitive
    ns = db.execute(
        text("SELECT * FROM wims.incident_nonsensitive_details WHERE incident_id = :iid"),
        {"iid": incident_id},
    ).fetchone()

    # Fetch sensitive
    sd_row = db.execute(
        text("SELECT * FROM wims.incident_sensitive_details WHERE incident_id = :iid"),
        {"iid": incident_id},
    ).fetchone()

    def row_to_dict(r, keys=None):
        if r is None:
            return {}
        if keys:
            return {k: r[i] for i, k in enumerate(keys)}
        return dict(r._mapping) if hasattr(r, '_mapping') else {}

    sd_dict = row_to_dict(sd_row)

    # ── Decrypt PII blob if present (new writes use encrypted blob; old rows fall back) ──
    if sd_dict.get("pii_blob_enc") and sd_dict.get("encryption_iv"):
        try:
            aad = f"incident_id:{incident_id}".encode("utf-8")
            pii_plaintext = _get_security_provider().decrypt_json(
                sd_dict["encryption_iv"],
                sd_dict["pii_blob_enc"],
                aad,
            )
            # Inject decrypted PII fields so frontend contract is unchanged
            sd_dict["caller_name"]    = pii_plaintext.get("caller_name")
            sd_dict["caller_number"]  = pii_plaintext.get("caller_number")
            sd_dict["owner_name"]     = pii_plaintext.get("owner_name")
            sd_dict["occupant_name"]  = pii_plaintext.get("occupant_name")
        except SecurityProviderError:
            # Auth/key failure on a blob that claims to be valid — possible tampering
            # or key rotation without re-encrypt. Log with incident_id; never log
            # nonce, ciphertext, or plaintext. Return legacy plaintext as fallback.
            logger.error(
                "CRITICAL: PII blob decryption failed (possible tamper or key mismatch). "
                "incident_id=%s",
                incident_id,
            )
            pass

    # Do not expose internal blob columns in API response
    sd_dict.pop("pii_blob_enc",  None)
    sd_dict.pop("encryption_iv", None)

    return {
        "incident_id": row[0],
        "verification_status": row[1],
        "created_at": row[2].isoformat() if row[2] else None,
        "region_id": row[3],
        "nonsensitive": row_to_dict(ns),
        "sensitive": sd_dict,
    }


@router.get("/stats", response_model=RegionalStatsResponse)
def get_regional_stats(
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db)],
):
    """Quick summary stats scoped to the user's region."""
    region_id = user["assigned_region_id"]

    total = db.execute(
        text("SELECT COUNT(*) FROM wims.fire_incidents WHERE region_id = :rid AND is_archived = FALSE"),
        {"rid": region_id},
    ).scalar() or 0

    by_cat_rows = db.execute(
        text("""
            SELECT nd.general_category, COUNT(*) as cnt
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.region_id = :rid AND fi.is_archived = FALSE
            GROUP BY nd.general_category
            ORDER BY cnt DESC
        """),
        {"rid": region_id},
    ).fetchall()

    by_alarm_rows = db.execute(
        text("""
            SELECT nd.alarm_level, COUNT(*) as cnt
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.region_id = :rid AND fi.is_archived = FALSE
            GROUP BY nd.alarm_level
            ORDER BY cnt DESC
        """),
        {"rid": region_id},
    ).fetchall()

    by_status_rows = db.execute(
        text("""
            SELECT verification_status, COUNT(*) as cnt
            FROM wims.fire_incidents
            WHERE region_id = :rid AND is_archived = FALSE
            GROUP BY verification_status
            ORDER BY cnt DESC
        """),
        {"rid": region_id},
    ).fetchall()

    return RegionalStatsResponse(
        total_incidents=total,
        by_category=[{"category": r[0], "count": r[1]} for r in by_cat_rows],
        by_alarm_level=[{"alarm_level": r[0], "count": r[1]} for r in by_alarm_rows],
        by_status=[{"status": r[0], "count": r[1]} for r in by_status_rows],
    )
