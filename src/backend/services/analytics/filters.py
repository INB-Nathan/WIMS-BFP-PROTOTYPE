"""Shared analytics filter normalization and SQL compilation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException


@dataclass(frozen=True)
class AnalyticsQueryFilters:
    start_date: str | None = None
    end_date: str | None = None
    region_id: int | None = None
    region_ids: tuple[int, ...] = ()
    province: str | None = None
    municipality: str | None = None
    fire_station: str | None = None
    incident_type: str | None = None
    alarm_level: str | None = None
    casualty_severity: str | None = None
    damage_min: float | None = None
    damage_max: float | None = None
    barangay_name: str | None = None
    selected_incident_ids: tuple[int, ...] = ()

    def __post_init__(self) -> None:
        if self.casualty_severity not in (None, "high", "medium", "low"):
            raise ValueError("casualty_severity must be high, medium, or low")
        if (
            self.damage_min is not None
            and self.damage_max is not None
            and self.damage_max < self.damage_min
        ):
            raise ValueError("damage_max must be greater than or equal to damage_min")

    @property
    def effective_region_id(self) -> int | None:
        return None if self.region_ids else self.region_id

    def as_task_filters(self) -> dict[str, Any]:
        filters: dict[str, Any] = {
            "start_date": self.start_date,
            "end_date": self.end_date,
            "region_id": self.effective_region_id,
            "province": self.province,
            "municipality": self.municipality,
            "fire_station": self.fire_station,
            "incident_type": self.incident_type,
            "alarm_level": self.alarm_level,
            "casualty_severity": self.casualty_severity,
            "damage_min": self.damage_min,
            "damage_max": self.damage_max,
            "barangay_name": self.barangay_name,
        }
        if self.region_ids:
            filters["region_ids"] = list(self.region_ids)
        if self.selected_incident_ids:
            filters["incident_ids"] = list(self.selected_incident_ids)
        return {key: value for key, value in filters.items() if value not in (None, (), [])}


def parse_region_ids(region_ids: str | None) -> tuple[int, ...]:
    if not region_ids:
        return ()
    try:
        parsed = tuple(int(x.strip()) for x in region_ids.split(",") if x.strip())
    except ValueError as exc:
        raise ValueError("region_ids must be comma-separated integers") from exc
    return parsed


def build_analytics_filters(
    *,
    start_date: str | None = None,
    end_date: str | None = None,
    region_id: int | None = None,
    region_ids: str | list[int] | tuple[int, ...] | None = None,
    province: str | None = None,
    municipality: str | None = None,
    fire_station: str | None = None,
    incident_type: str | None = None,
    alarm_level: str | None = None,
    casualty_severity: str | None = None,
    damage_min: float | None = None,
    damage_max: float | None = None,
    barangay_name: str | None = None,
    selected_incident_ids: list[int] | tuple[int, ...] | None = None,
) -> AnalyticsQueryFilters:
    if isinstance(region_ids, str) or region_ids is None:
        parsed_region_ids = parse_region_ids(region_ids)
    else:
        parsed_region_ids = tuple(int(rid) for rid in region_ids)

    try:
        return AnalyticsQueryFilters(
            start_date=start_date,
            end_date=end_date,
            region_id=region_id,
            region_ids=parsed_region_ids,
            province=province,
            municipality=municipality,
            fire_station=fire_station,
            incident_type=incident_type,
            alarm_level=alarm_level,
            casualty_severity=casualty_severity,
            damage_min=damage_min,
            damage_max=damage_max,
            barangay_name=barangay_name,
            selected_incident_ids=tuple(sorted(set(selected_incident_ids or ()))),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def append_common_filters(
    clauses: list[str],
    params: dict[str, Any],
    filters: AnalyticsQueryFilters,
    *,
    table_alias: str = "a",
    damage_expression: str | None = None,
    column_expressions: dict[str, str] | None = None,
) -> None:
    prefix = f"{table_alias}."
    columns = column_expressions or {}
    notification_date = columns.get("notification_date", f"{prefix}notification_date")
    region = columns.get("region_id", f"{prefix}region_id")
    province = columns.get("province_name", f"{prefix}province_name")
    municipality = columns.get("municipality_name", f"{prefix}municipality_name")
    fire_station = columns.get("fire_station_name", f"{prefix}fire_station_name")
    alarm = columns.get("alarm_level", f"{prefix}alarm_level")
    category = columns.get("general_category", f"{prefix}general_category")
    incident_id = columns.get("incident_id", f"{prefix}incident_id")
    civilian_deaths = columns.get("civilian_deaths", f"{prefix}civilian_deaths")
    firefighter_deaths = columns.get("firefighter_deaths", f"{prefix}firefighter_deaths")
    civilian_injured = columns.get("civilian_injured", f"{prefix}civilian_injured")
    firefighter_injured = columns.get("firefighter_injured", f"{prefix}firefighter_injured")
    barangay = columns.get("barangay_name", f"{prefix}barangay_name")
    damage_column = damage_expression or f"{prefix}estimated_damage_php"

    if filters.start_date:
        clauses.append(f"{notification_date} >= CAST(:start_date AS date)")
        params["start_date"] = filters.start_date
    if filters.end_date:
        clauses.append(f"{notification_date} <= CAST(:end_date AS date)")
        params["end_date"] = filters.end_date
    if filters.region_ids:
        clauses.append(f"{region} = ANY(:region_ids)")
        params["region_ids"] = list(filters.region_ids)
    elif filters.region_id is not None:
        clauses.append(f"{region} = :region_id")
        params["region_id"] = filters.region_id
    if filters.province:
        clauses.append(f"{province} = :province")
        params["province"] = filters.province
    if filters.municipality:
        clauses.append(f"{municipality} = :municipality")
        params["municipality"] = filters.municipality
    if filters.fire_station:
        clauses.append(f"{fire_station} = :fire_station")
        params["fire_station"] = filters.fire_station
    if filters.alarm_level:
        clauses.append(f"{alarm} = :alarm_level")
        params["alarm_level"] = filters.alarm_level
    if filters.incident_type:
        clauses.append(f"{category} = :incident_type")
        params["incident_type"] = filters.incident_type
    if filters.casualty_severity == "high":
        clauses.append(f"({civilian_deaths} + {firefighter_deaths}) > 0")
    elif filters.casualty_severity == "medium":
        clauses.append(
            f"({civilian_injured} + {firefighter_injured}) > 0 "
            f"AND ({civilian_deaths} + {firefighter_deaths}) = 0"
        )
    elif filters.casualty_severity == "low":
        clauses.append(
            f"({civilian_injured} + {firefighter_injured} + "
            f"{civilian_deaths} + {firefighter_deaths}) = 0"
        )
    if filters.damage_min is not None:
        clauses.append(f"{damage_column} >= :damage_min")
        params["damage_min"] = filters.damage_min
    if filters.damage_max is not None:
        clauses.append(f"{damage_column} <= :damage_max")
        params["damage_max"] = filters.damage_max
    if filters.barangay_name:
        clauses.append(f"{barangay} = :barangay_name")
        params["barangay_name"] = filters.barangay_name
    if filters.selected_incident_ids:
        clauses.append(f"{incident_id} = ANY(:selected_incident_ids)")
        params["selected_incident_ids"] = list(filters.selected_incident_ids)
