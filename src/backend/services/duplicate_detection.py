"""Conservative gated duplicate detection for fire incidents.

Architecture
------------
1. SQL fetches candidate rows from the same region/date window, along with the
   computed distance (ST_Distance) and all address/text fields needed for scoring.
2. Python applies an anchor gate — at least one of: coordinate proximity ≤250 m,
   matching barangay+street/landmark, or matching establishment name — before any
   scoring takes place.  Candidates that do not pass the anchor are discarded.
3. Remaining candidates are scored across location, category, time, and address
   dimensions.  The best-scoring candidate above the POSSIBLE threshold is returned
   together with a confidence band ("LIKELY" or "POSSIBLE").

Usage
-----
    from services.duplicate_detection import check_for_duplicate

    result = check_for_duplicate(
        db,
        incident_id=123,
        region_id=4,
        incident_date="2026-05-09",
        notification_dt=datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc),
        lat=14.5995,
        lon=120.9842,
        general_category="STRUCTURAL",
        incident_type_code="APT",
        city_municipality="Quezon City",
        province_district="NCR",
        barangay="Barangay Commonwealth",
        street_address="10 Batangas St",
        landmark="Near QC Hall",
        establishment_name="Commonwealth Apartments",
        fire_station_name="BFP QC Station 1",
        exclude_statuses=("DRAFT", "REJECTED", "REPLACED"),
    )
    if result:
        matched_id, confidence = result   # "LIKELY" | "POSSIBLE"
"""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Thresholds and distance/time constants
# ---------------------------------------------------------------------------

# Anchor gate: minimum coordinate proximity to consider a candidate at all.
# Candidates beyond this distance must provide address or establishment evidence.
ANCHOR_DISTANCE_M: float = 250.0

# Location score tiers
DISTANCE_STRONG_M: float = 100.0  # ≤100 m → 3 pts
DISTANCE_MODERATE_M: float = 250.0  # 101–250 m → 2 pts
DISTANCE_WEAK_M: float = 500.0  # 251–500 m → 1 pt  (requires address/estab anchor)

# Time score tiers (seconds)
TIME_STRONG_S: int = 1800  # ≤30 min → 2 pts
TIME_MODERATE_S: int = 7200  # 31–120 min → 1 pt

# Confidence band thresholds
SCORE_LIKELY: int = 7  # ≥7 pts → "LIKELY"
SCORE_POSSIBLE: int = 4  # ≥4 pts → "POSSIBLE"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _normalize(s: str | None) -> str | None:
    """Lowercase, strip, and collapse internal whitespace.  Returns None for empty/None."""
    if not s:
        return None
    normalized = " ".join(s.strip().lower().split())
    return normalized or None


def _texts_match(a: str | None, b: str | None) -> bool:
    """Case-insensitive exact match after normalisation.  Two Nones do NOT match."""
    na, nb = _normalize(a), _normalize(b)
    return bool(na and nb and na == nb)


def _check_anchor(
    cand_distance_m: float | None,
    *,
    # candidate address fields
    cand_barangay_id: int | None,
    cand_barangay: str | None,
    cand_street_address: str | None,
    cand_landmark: str | None,
    cand_establishment_name: str | None,
    # query incident address fields
    query_barangay_id: int | None,
    query_barangay: str | None,
    query_street_address: str | None,
    query_landmark: str | None,
    query_establishment_name: str | None,
) -> bool:
    """Return True if this candidate passes at least one anchor condition.

    Anchor options:
    1. Coordinate proximity: distance ≤ ANCHOR_DISTANCE_M (250 m).
    2. Address proximity: matching barangay AND matching street_address or landmark.
    3. Establishment match: matching non-empty establishment_name AND (distance ≤ 500 m
       OR matching barangay).
    """
    # Anchor 1: coordinate proximity
    if cand_distance_m is not None and cand_distance_m <= ANCHOR_DISTANCE_M:
        return True

    # Barangay match helper — prefers FK over free-text
    barangay_match = (
        cand_barangay_id is not None and cand_barangay_id == query_barangay_id
    ) or _texts_match(cand_barangay, query_barangay)

    # Anchor 2: address proximity (same barangay + street or landmark)
    street_or_landmark_match = _texts_match(
        cand_street_address, query_street_address
    ) or _texts_match(cand_landmark, query_landmark)

    if barangay_match and street_or_landmark_match:
        return True

    # Anchor 3: establishment match with compatible location
    estab_match = _texts_match(cand_establishment_name, query_establishment_name)
    if estab_match and _normalize(query_establishment_name):
        compatible_location = (
            cand_distance_m is not None and cand_distance_m <= DISTANCE_WEAK_M
        ) or barangay_match
        if compatible_location:
            return True

    return False


def _is_incompatible_category(
    cand_cat: str | None,
    query_cat: str | None,
) -> bool:
    """Return True when both categories are known and they clearly differ.

    A null on either side means we cannot determine incompatibility, so we
    allow the candidate through (returns False).
    """
    if not cand_cat or not query_cat:
        return False
    return _normalize(cand_cat) != _normalize(query_cat)


def _score_candidate(
    cand_distance_m: float | None,
    cand_notification_dt: datetime | None,
    cand_general_category: str | None,
    cand_incident_type_code: str | None,
    cand_barangay_id: int | None,
    cand_barangay: str | None,
    cand_street_address: str | None,
    cand_landmark: str | None,
    cand_establishment_name: str | None,
    cand_fire_station_name: str | None,
    *,
    query_notification_dt: datetime | None,
    query_general_category: str | None,
    query_incident_type_code: str | None,
    query_barangay_id: int | None,
    query_barangay: str | None,
    query_street_address: str | None,
    query_landmark: str | None,
    query_establishment_name: str | None,
    query_fire_station_name: str | None,
) -> int | None:
    """Compute the support score for a single candidate.

    Returns the integer score if anchor + category compatibility pass, else None.

    Score components (max 12):
    - Location:       ≤100 m = 3 | ≤250 m = 2 | ≤500 m = 1
    - Category+type:  both match = 3 | category only = 1
    - Time:           ≤30 min = 2 | ≤2 hr = 1
    - Address:        barangay+street/landmark = 2 | barangay only = 1
    - Establishment:  match = 1
    - Fire station:   match = 1
    """
    # ── Anchor gate ─────────────────────────────────────────────────────────
    if not _check_anchor(
        cand_distance_m,
        cand_barangay_id=cand_barangay_id,
        cand_barangay=cand_barangay,
        cand_street_address=cand_street_address,
        cand_landmark=cand_landmark,
        cand_establishment_name=cand_establishment_name,
        query_barangay_id=query_barangay_id,
        query_barangay=query_barangay,
        query_street_address=query_street_address,
        query_landmark=query_landmark,
        query_establishment_name=query_establishment_name,
    ):
        return None

    # ── Category compatibility (hard block) ──────────────────────────────────
    if _is_incompatible_category(cand_general_category, query_general_category):
        return None

    score = 0

    # ── Location ─────────────────────────────────────────────────────────────
    if cand_distance_m is not None:
        if cand_distance_m <= DISTANCE_STRONG_M:
            score += 3
        elif cand_distance_m <= DISTANCE_MODERATE_M:
            score += 2
        elif cand_distance_m <= DISTANCE_WEAK_M:
            score += 1

    # ── Category / type ──────────────────────────────────────────────────────
    if query_general_category and cand_general_category:
        if (
            _normalize(cand_general_category) == _normalize(query_general_category)
            and query_incident_type_code
            and cand_incident_type_code
            and _normalize(cand_incident_type_code) == _normalize(query_incident_type_code)
        ):
            score += 3
        elif _normalize(cand_general_category) == _normalize(query_general_category):
            score += 1

    # ── Time ─────────────────────────────────────────────────────────────────
    if query_notification_dt and cand_notification_dt:
        delta_s = abs((cand_notification_dt - query_notification_dt).total_seconds())
        if delta_s <= TIME_STRONG_S:
            score += 2
        elif delta_s <= TIME_MODERATE_S:
            score += 1

    # ── Address support ──────────────────────────────────────────────────────
    barangay_match = (
        cand_barangay_id is not None and cand_barangay_id == query_barangay_id
    ) or _texts_match(cand_barangay, query_barangay)

    street_or_landmark_match = _texts_match(
        cand_street_address, query_street_address
    ) or _texts_match(cand_landmark, query_landmark)

    if barangay_match and street_or_landmark_match:
        score += 2
    elif barangay_match:
        score += 1

    # ── Establishment ────────────────────────────────────────────────────────
    if _texts_match(cand_establishment_name, query_establishment_name) and _normalize(
        query_establishment_name
    ):
        score += 1

    # ── Fire station ─────────────────────────────────────────────────────────
    if _texts_match(cand_fire_station_name, query_fire_station_name) and _normalize(
        query_fire_station_name
    ):
        score += 1

    return score


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def check_for_duplicate(
    db: Session,
    *,
    incident_id: int,
    region_id: int,
    incident_date: str | None = None,
    notification_dt: datetime | None = None,
    lat: float | None,
    lon: float | None,
    general_category: str | None = None,
    incident_type_code: str | None = None,
    city_municipality: str | None = None,
    province_district: str | None = None,
    barangay: str | None = None,
    barangay_id: int | None = None,
    street_address: str | None = None,
    landmark: str | None = None,
    establishment_name: str | None = None,
    fire_station_name: str | None = None,
    exclude_statuses: tuple[str, ...] = (),
    verified_window_seconds: int | None = None,
) -> tuple[int, str] | None:
    """Return ``(matched_incident_id, confidence)`` or ``None``.

    ``confidence`` is ``"LIKELY"`` (score ≥ SCORE_LIKELY) or ``"POSSIBLE"``
    (score ≥ SCORE_POSSIBLE).  A score below SCORE_POSSIBLE always returns None.

    Detection model
    ---------------
    A candidate must first pass the *anchor gate*: coordinate proximity ≤ 250 m,
    OR matching barangay + street/landmark, OR matching non-empty establishment
    name with compatible location.  Temporal and administrative signals alone
    (same day, same city, same category) cannot produce a duplicate flag.

    After the anchor gate, remaining candidates are scored across six dimensions.
    Incompatible ``general_category`` values (e.g. STRUCTURAL vs WILDLAND)
    hard-block a candidate even if it passed the anchor.

    Parameters
    ----------
    incident_id:
        The incident being checked — excluded from candidate pool.
    region_id:
        Region scope for candidate pool.
    incident_date:
        YYYY-MM-DD string.  Derived from ``notification_dt`` when absent.
    notification_dt:
        Full fire timestamp for the time-proximity criterion.
    lat, lon:
        Coordinates.  Pass None when unavailable; distance criterion is skipped.
    general_category, incident_type_code:
        Fire classification.
    city_municipality, province_district:
        Administrative location.  Not used in scoring; kept for future use.
    barangay, barangay_id:
        Sub-city location for address anchor and address score.
    street_address, landmark:
        Street-level address for address anchor and address score.
    establishment_name:
        Business/building name for establishment anchor and score.
    fire_station_name:
        Responding fire station for weak supporting score.
    exclude_statuses:
        Tuple of ``verification_status`` values to exclude from pool.
    verified_window_seconds:
        When set, only VERIFIED rows updated within this window are included.
        Used by bulk-approve to guard against same-session double-accepts.
    """
    # Derive incident_date from notification_dt when not supplied directly
    effective_date = incident_date
    if effective_date is None and notification_dt is not None:
        effective_date = notification_dt.strftime("%Y-%m-%d")

    skip_statuses: list[str] = list(exclude_statuses) if exclude_statuses else []

    params: dict = {
        "rid": region_id,
        "cur_id": incident_id,
        "lat": float(lat) if lat is not None else None,
        "lon": float(lon) if lon is not None else None,
        "fire_date": effective_date,
        "notif_dt": notification_dt.isoformat() if notification_dt is not None else None,
    }

    # ── Dynamic WHERE clauses ─────────────────────────────────────────────────
    extra_where: list[str] = []

    if skip_statuses:
        params["skip_statuses"] = skip_statuses
        extra_where.append("fi.verification_status != ALL(:skip_statuses)")

    if verified_window_seconds is not None:
        params["window_seconds"] = verified_window_seconds
        extra_where.append("fi.verification_status = 'VERIFIED'")
        extra_where.append("fi.updated_at > NOW() - (:window_seconds || ' seconds')::interval")

    # Candidate pool: ±3 days from fire_date
    if effective_date is not None:
        extra_where.append(
            """(
                nd.notification_dt IS NULL
                OR DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila')
                     BETWEEN DATE(CAST(:fire_date AS date)) - INTERVAL '3 days'
                         AND DATE(CAST(:fire_date AS date)) + INTERVAL '3 days'
            )"""
        )

    where_sql = ""
    if extra_where:
        where_sql = " AND " + " AND ".join(extra_where)

    rows = db.execute(
        text(
            f"""
            SELECT
                fi.incident_id,
                fi.updated_at,
                CASE
                    WHEN :lat IS NOT NULL AND :lon IS NOT NULL
                    THEN ST_Distance(
                        fi.location::geography,
                        ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                    )
                    ELSE NULL
                END AS distance_m,
                nd.notification_dt,
                nd.general_category,
                fi.incident_type_code,
                nd.barangay_id,
                nd.barangay,
                nd.city_municipality,
                nd.province_district,
                sd.street_address,
                sd.landmark,
                sd.establishment_name,
                nd.fire_station_name
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd
                   ON nd.incident_id = fi.incident_id
            LEFT JOIN wims.incident_sensitive_details sd
                   ON sd.incident_id = fi.incident_id
            WHERE fi.region_id  = :rid
              AND fi.incident_id != :cur_id
              AND fi.is_archived = FALSE
            {where_sql}
            ORDER BY fi.updated_at DESC
            """
        ),
        params,
    ).fetchall()

    best_id: int | None = None
    best_score: int = 0
    best_confidence: str = ""

    for row in rows:
        (
            cand_id,
            _updated_at,
            cand_distance_m,
            cand_notification_dt,
            cand_general_category,
            cand_incident_type_code,
            cand_barangay_id,
            cand_barangay,
            _cand_city,
            _cand_province,
            cand_street_address,
            cand_landmark,
            cand_establishment_name,
            cand_fire_station_name,
        ) = row

        score = _score_candidate(
            float(cand_distance_m) if cand_distance_m is not None else None,
            cand_notification_dt,
            cand_general_category,
            cand_incident_type_code,
            cand_barangay_id,
            cand_barangay,
            cand_street_address,
            cand_landmark,
            cand_establishment_name,
            cand_fire_station_name,
            query_notification_dt=notification_dt,
            query_general_category=general_category,
            query_incident_type_code=incident_type_code,
            query_barangay_id=barangay_id,
            query_barangay=barangay,
            query_street_address=street_address,
            query_landmark=landmark,
            query_establishment_name=establishment_name,
            query_fire_station_name=fire_station_name,
        )

        if score is None or score < SCORE_POSSIBLE:
            continue

        confidence = "LIKELY" if score >= SCORE_LIKELY else "POSSIBLE"

        if score > best_score:
            best_id = int(cand_id)
            best_score = score
            best_confidence = confidence

    if best_id is not None:
        logger.debug(
            "duplicate match: incident_id=%s matched=%s score=%d confidence=%s",
            incident_id,
            best_id,
            best_score,
            best_confidence,
        )
        return (best_id, best_confidence)

    return None
