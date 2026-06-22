"""Dashboard Widget API — lightweight per-widget endpoints.

Each widget ID maps to a simple COUNT/GROUP BY query with no joins
or heavy aggregation. Only visible widgets run queries.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user, get_db_with_rls

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

# ── Widget definitions ────────────────────────────────────────────────────────
# Each widget definition includes:
#   - id: widget identifier matching the front-end
#   - roles: set of roles that can request this widget
#   - query: SQL template (may reference :rid or date params)
#   - value_key: response key for single-count widgets

WIDGET_DEFS: dict[str, dict] = {}
_W = WIDGET_DEFS  # shorthand


# ── National Validator widgets ────────────────────────────────────────────────
_W["awaiting_validation"] = {
    "roles": {"NATIONAL_VALIDATOR"},
    "query": """
        SELECT COUNT(*)
        FROM wims.fire_incidents
        WHERE verification_status IN ('PENDING', 'PENDING_VALIDATION')
          AND is_archived = FALSE
          AND encoder_id IS NOT NULL
    """,
    "value_key": "count",
}
_W["citizen_reports"] = {
    "roles": {"NATIONAL_VALIDATOR"},
    "query": """
        SELECT COUNT(*)
        FROM wims.citizen_reports
        WHERE status = 'PENDING'
    """,
    "value_key": "count",
}
_W["verified_today"] = {
    "roles": {"NATIONAL_VALIDATOR"},
    "query": """
        SELECT COUNT(*)
        FROM wims.fire_incidents
        WHERE verification_status = 'VERIFIED'
          AND is_archived = FALSE
          AND DATE(updated_at AT TIME ZONE 'Asia/Manila') = CURRENT_DATE
    """,
    "value_key": "count",
}
_W["active_operations"] = {
    "roles": {"NATIONAL_VALIDATOR"},
    "query": """
        SELECT COUNT(*)
        FROM wims.operations
        WHERE fire_status IN ('ACTIVE', 'CONTAINED')
    """,
    "value_key": "count",
}
_W["by_category"] = {
    "roles": {"NATIONAL_VALIDATOR", "REGIONAL_ENCODER", "NATIONAL_ANALYST", "SYSTEM_ADMIN"},
    "query": """
        SELECT nd.general_category AS label, COUNT(*) AS count
        FROM wims.fire_incidents fi
        JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
        WHERE fi.verification_status = 'VERIFIED'
          AND fi.is_archived = FALSE
          {region_filter}
        GROUP BY nd.general_category
        ORDER BY count DESC
    """,
    "value_key": "categories",
}
_W["rejected"] = {
    "roles": {"NATIONAL_VALIDATOR"},
    "query": """
        SELECT COUNT(*)
        FROM wims.fire_incidents
        WHERE verification_status = 'REJECTED'
          AND is_archived = FALSE
    """,
    "value_key": "count",
}

# ── Regional Encoder widgets ──────────────────────────────────────────────────
_W["total_incidents"] = {
    "roles": {"REGIONAL_ENCODER", "NATIONAL_ANALYST", "SYSTEM_ADMIN"},
    "query": """
        SELECT COUNT(*)
        FROM wims.fire_incidents fi
        WHERE fi.verification_status = 'VERIFIED'
          AND fi.is_archived = FALSE
          {region_filter}
    """,
    "value_key": "count",
}
_W["drafts"] = {
    "roles": {"REGIONAL_ENCODER"},
    "query": """
        SELECT COUNT(*)
        FROM wims.fire_incidents
        WHERE encoder_id = :uid
          AND verification_status = 'DRAFT'
          AND is_archived = FALSE
    """,
    "value_key": "count",
}
_W["submitted_today"] = {
    "roles": {"REGIONAL_ENCODER"},
    "query": """
        SELECT COUNT(*)
        FROM wims.fire_incidents
        WHERE encoder_id = :uid
          AND DATE(created_at AT TIME ZONE 'Asia/Manila') = CURRENT_DATE
          AND is_archived = FALSE
    """,
    "value_key": "count",
}
_W["pending_validation"] = {
    "roles": {"REGIONAL_ENCODER"},
    "query": """
        SELECT COUNT(*)
        FROM wims.fire_incidents
        WHERE encoder_id = :uid
          AND verification_status IN ('PENDING', 'PENDING_VALIDATION')
          AND is_archived = FALSE
    """,
    "value_key": "count",
}
_W["by_alarm_level"] = {
    "roles": {"REGIONAL_ENCODER"},
    "query": """
        SELECT COALESCE(nd.alarm_level, 'UNKNOWN') AS label, COUNT(*) AS count
        FROM wims.fire_incidents fi
        JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
        WHERE fi.encoder_id = :uid
          AND fi.verification_status = 'VERIFIED'
          AND fi.is_archived = FALSE
        GROUP BY nd.alarm_level
        ORDER BY count DESC
    """,
    "value_key": "categories",
}

# ── National Analyst widgets ───────────────────────────────────────────────────
_W["verified_month"] = {
    "roles": {"NATIONAL_ANALYST", "SYSTEM_ADMIN"},
    "query": """
        SELECT COUNT(*)
        FROM wims.fire_incidents
        WHERE verification_status = 'VERIFIED'
          AND is_archived = FALSE
          AND updated_at >= date_trunc('month', CURRENT_DATE)
    """,
    "value_key": "count",
}
_W["by_region"] = {
    "roles": {"NATIONAL_ANALYST", "SYSTEM_ADMIN"},
    "query": """
        SELECT r.region_name AS label, COUNT(*) AS count
        FROM wims.fire_incidents fi
        JOIN wims.ref_regions r ON r.region_id = fi.region_id
        WHERE fi.verification_status = 'VERIFIED'
          AND fi.is_archived = FALSE
        GROUP BY r.region_name
        ORDER BY count DESC
        LIMIT 5
    """,
    "value_key": "categories",
}
_W["avg_response_time"] = {
    "roles": {"NATIONAL_ANALYST", "SYSTEM_ADMIN"},
    "query": """
        SELECT COALESCE(AVG(total_response_time_minutes), 0) AS avg_minutes
        FROM wims.fire_incidents
        WHERE verification_status = 'VERIFIED'
          AND is_archived = FALSE
          AND total_response_time_minutes IS NOT NULL
    """,
    "value_key": "count",
}


def _role_widgets(role: str) -> set[str]:
    """Return the set of widget IDs available for a given role."""
    return {wid for wid, wdef in WIDGET_DEFS.items() if role in wdef["roles"]}


def _format_widget_value(wdef: dict, rows) -> dict:
    """Format raw SQL rows into the widget's response shape."""
    vk = wdef["value_key"]
    if vk == "categories":
        return {"categories": [{"label": r[0], "count": r[1]} for r in rows]}
    # Single-count widget
    return {"count": rows[0][0] if rows else 0}


@router.get("/widgets")
def get_widget_data(
    user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    ids: str = Query(default="", description="Comma-separated widget IDs"),
):
    """Return widget data for the requested IDs.

    Only widgets available to the user's role are returned.
    Each widget runs a single lightweight COUNT or GROUP BY query.
    """
    role = (user or {}).get("role", "")
    if not role:
        raise HTTPException(status_code=403, detail="Role required for widget data")

    available = _role_widgets(role)
    requested = [w.strip() for w in ids.split(",") if w.strip()]

    if not requested:
        # Return empty results — client uses defaults
        return {}

    # Look up assigned_region_id for encoder widgets that filter by region.
    # get_current_wims_user doesn't include it, so we query it inline.
    region_id: int | None = None
    if role in ("REGIONAL_ENCODER", "ENCODER"):
        try:
            row = db.execute(
                text("SELECT assigned_region_id FROM wims.users WHERE user_id = :uid"),
                {"uid": user["user_id"]},
            ).fetchone()
            if row:
                region_id = row[0]
        except Exception:
            pass  # region_id stays None; per-region queries with :rid will be skipped

    result: dict = {}
    for wid in requested:
        if wid not in available:
            continue  # silently skip unavailable widgets
        wdef = WIDGET_DEFS.get(wid)
        if not wdef:
            continue

        query = wdef["query"]
        params: dict = {}
        if region_id:
            params["rid"] = region_id
        # Encoder widgets scope to the current user's own work via :uid.
        # Always set when the caller is an encoder, even if assigned_region_id
        # is missing (region_id stays None in that case).
        if role in ("REGIONAL_ENCODER", "ENCODER"):
            params["uid"] = user["user_id"]

        # Handle region_filter placeholder for total_incidents and by_category.
        # - REGIONAL_ENCODER: scope to encoder's own work via :uid
        # - NATIONAL_VALIDATOR / NATIONAL_ANALYST / SYSTEM_ADMIN: no filter (global)
        if role == "REGIONAL_ENCODER" and wid in ("total_incidents", "by_category"):
            query = query.replace("{region_filter}", "AND fi.encoder_id = :uid")
        else:
            query = query.replace("{region_filter}", "")

        try:
            rows = db.execute(text(query), params).fetchall()
            result[wid] = _format_widget_value(wdef, rows)
        except Exception as exc:
            result[wid] = {"error": str(exc)}

    return result
