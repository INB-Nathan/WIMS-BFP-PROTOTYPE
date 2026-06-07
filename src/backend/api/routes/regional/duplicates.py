"""Regional Office API — duplicate check route."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_regional_encoder
from auth import get_db_with_rls

router = APIRouter()


@router.get("/incidents/check-duplicate")
def check_incident_duplicate(
    region_id: int,
    fire_date: str,
    incident_type_code: Optional[str] = None,
    general_category: Optional[str] = None,
    user: Annotated[dict, Depends(get_regional_encoder)] = None,
    db: Annotated[Session, Depends(get_db_with_rls)] = None,
):
    """Return existing non-archived incidents that could be duplicates.

    Detection criteria (OR logic — any match triggers a warning):
      1. Same region + type_code + same calendar month + year (reference number space collision)
      2. Same region + type_code + exact fire date
      3. Same region + general_category + exact fire date (when no type_code available)
    """
    try:
        fire_dt = datetime.fromisoformat(str(fire_date))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="fire_date must be a valid YYYY-MM-DD date")

    fire_month = fire_dt.month
    fire_year = fire_dt.year

    # Build WHERE conditions with explicit Python-side checks to avoid NULL pitfalls
    where_conditions = [
        "fi.region_id = :rid",
        "fi.is_archived = FALSE",
        "fi.verification_status = 'VERIFIED'",
    ]

    # Build OR sub-conditions
    or_parts: list[str] = []
    params: dict[str, Any] = {
        "rid": region_id,
        "fire_date": fire_date,
        "fire_month": fire_month,
        "fire_year": fire_year,
    }

    if incident_type_code:
        params["type_code"] = incident_type_code
        # Same reference number space (same type + same month + year)
        or_parts.append(
            "(fi.incident_type_code = :type_code"
            " AND EXTRACT(MONTH FROM nd.notification_dt AT TIME ZONE 'Asia/Manila') = :fire_month"
            " AND EXTRACT(YEAR FROM nd.notification_dt AT TIME ZONE 'Asia/Manila') = :fire_year)"
        )
        # Exact date + type (catches same day, different month edge case from above)
        or_parts.append(
            "(fi.incident_type_code = :type_code"
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') = CAST(:fire_date AS DATE))"
        )

    if general_category:
        params["general_category"] = general_category
        # Same category + exact date (fallback when no type code)
        or_parts.append(
            "(nd.general_category = :general_category"
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') = CAST(:fire_date AS DATE))"
        )

    if not or_parts:
        # Nothing to match on — can't run a useful check
        return {"duplicates": []}

    where_conditions.append(f"({' OR '.join(or_parts)})")
    where_sql = " AND ".join(where_conditions)

    rows = db.execute(
        text(f"""
            SELECT
                fi.incident_id,
                fi.reference_number,
                fi.verification_status,
                fi.incident_type_code,
                nd.notification_dt,
                nd.alarm_level,
                nd.general_category,
                nd.sub_category,
                nd.fire_station_name,
                c.city_name,
                p.province_name,
                rr.region_name,
                sd.street_address
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd
                ON nd.incident_id = fi.incident_id
            LEFT JOIN wims.ref_cities c ON c.city_id = nd.city_id
            LEFT JOIN wims.ref_provinces p ON p.province_id = c.province_id
            LEFT JOIN wims.ref_regions rr ON rr.region_id = fi.region_id
            LEFT JOIN wims.incident_sensitive_details sd ON sd.incident_id = fi.incident_id
            WHERE {where_sql}
            ORDER BY
                fi.verification_status DESC,  -- VERIFIED first, then PENDING
                fi.created_at DESC
            LIMIT 10
        """),
        params,
    ).fetchall()

    return {
        "duplicates": [
            {
                "incident_id": r[0],
                "reference_number": r[1],
                "verification_status": r[2],
                "incident_type_code": r[3],
                "notification_dt": str(r[4]) if r[4] else None,
                "alarm_level": r[5],
                "general_category": r[6],
                "type_of_involved": r[7],
                "fire_station_name": r[8],
                "city_municipality": r[9],
                "province_district": r[10],
                "region_name": r[11],
                "street_address": r[12],
            }
            for r in rows
        ]
    }
