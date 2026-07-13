"""Contributor reliability scoring and profile services."""

from __future__ import annotations

import math
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

TRUST_SCORE_FORMULA_VERSION = "reliability-v1"

LIVE_CITIZEN_REPORT_STATUSES = (
    "PENDING",
    "UNDER_REVIEW",
    "LINKED",
    "ACTIONED",
    "REJECTED_BOGUS",
    "REJECTED_DUPLICATE",
    "REJECTED_INSUFFICIENT",
    "REJECTED_TIMEOUT",
)

CITIZEN_REPORT_STATUS_OUTCOMES: dict[str, str] = {
    "PENDING": "pending",
    "UNDER_REVIEW": "pending",
    "LINKED": "pending",
    "ACTIONED": "actioned",
    "REJECTED_BOGUS": "rejected",
    "REJECTED_DUPLICATE": "rejected",
    "REJECTED_INSUFFICIENT": "rejected",
    "REJECTED_TIMEOUT": "rejected",
}
PENDING_CITIZEN_REPORT_STATUSES = tuple(
    status for status, outcome in CITIZEN_REPORT_STATUS_OUTCOMES.items() if outcome == "pending"
)
DECIDED_CITIZEN_REPORT_STATUSES = tuple(
    status
    for status, outcome in CITIZEN_REPORT_STATUS_OUTCOMES.items()
    if outcome in {"actioned", "rejected"}
)
ACTIONED_CITIZEN_REPORT_STATUSES = tuple(
    status for status, outcome in CITIZEN_REPORT_STATUS_OUTCOMES.items() if outcome == "actioned"
)


def _sql_status_list(statuses: tuple[str, ...]) -> str:
    return ", ".join(f"'{status}'" for status in statuses)


_PENDING_REPORT_STATUS_SQL = _sql_status_list(PENDING_CITIZEN_REPORT_STATUSES)
_DECIDED_REPORT_STATUS_SQL = _sql_status_list(DECIDED_CITIZEN_REPORT_STATUSES)
_ACTIONED_REPORT_STATUS_SQL = _sql_status_list(ACTIONED_CITIZEN_REPORT_STATUSES)

BADGE_THRESHOLDS: list[tuple[int, str]] = [
    (0, "NOVICE"),
    (20, "REGULAR"),
    (50, "TRUSTED"),
    (80, "GUARDIAN"),
]


def badge_for_score(score: int) -> str:
    for threshold, badge in reversed(BADGE_THRESHOLDS):
        if score >= threshold:
            return badge
    return "NOVICE"


def _reliability_row(user_id: str, db: Session):
    """One set-based aggregation over root reports and their evidence."""
    return db.execute(
        text(
            f"""
        WITH roots AS (
            SELECT
                report_id,
                status,
                created_at,
                COALESCE(reported_at, created_at) AS report_timestamp
            FROM wims.citizen_reports
            WHERE contributor_user_id = :uid AND linked_to_report_id IS NULL
        ), evidence AS (
            SELECT r.report_id,
                   CASE WHEN COUNT(p.photo_id) > 0 THEN .25 ELSE 0 END
                   + CASE WHEN BOOL_OR(p.gps_consensus = 'both_match') THEN .35 ELSE 0 END
                   + CASE WHEN BOOL_OR(p.photo_reported_distance_m IS NOT NULL
                                       AND p.photo_reported_distance_m <= 500) THEN .20 ELSE 0 END
                   + CASE WHEN BOOL_OR(
                       p.exif_datetime_original IS NOT NULL
                       AND ABS(EXTRACT(EPOCH FROM (p.exif_datetime_original - r.report_timestamp)))
                           <= 86400
                   ) THEN .20 ELSE 0 END
                   AS quality
            FROM roots r LEFT JOIN wims.report_photos p ON p.report_id = r.report_id
            GROUP BY r.report_id
        ), agg AS (
            SELECT COUNT(*) AS root_reports,
                   COUNT(*) FILTER (WHERE status IN ({_DECIDED_REPORT_STATUS_SQL})) AS decided,
                   COUNT(*) FILTER (WHERE status IN ({_ACTIONED_REPORT_STATUS_SQL})) AS actioned,
                   COUNT(*) FILTER (WHERE status IN ({_PENDING_REPORT_STATUS_SQL})) AS pending,
                   MIN(created_at) AS first_report_at,
                   COUNT(DISTINCT date_trunc('month', created_at AT TIME ZONE 'UTC')) FILTER
                     (
                         WHERE created_at AT TIME ZONE 'UTC'
                         >= date_trunc('month', now() AT TIME ZONE 'UTC') - interval '5 months'
                     ) AS active_months,
                   MAX(created_at) AS last_report_at,
                   COALESCE(SUM(LEAST(1, COALESCE(e.quality, 0))), 0) AS evidence_total
            FROM roots r LEFT JOIN evidence e ON e.report_id = r.report_id
        ) SELECT * FROM agg
        """
        ),
        {"uid": user_id},
    ).fetchone()


def _inactive_months(last_report_at: datetime | None) -> int:
    if last_report_at is None:
        return 0
    last = last_report_at
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    return max(0, (now.year - last.year) * 12 + now.month - last.month - 1)


def _normalized_breakdown(row) -> dict[str, float | int | str]:
    if not row or not row.root_reports:
        return {
            "volume_progress": 0.0,
            "outcome_accuracy": 0.0,
            "evidence_quality": 0.0,
            "consistency": 0.0,
            "decay": 0,
            "formula_version": TRUST_SCORE_FORMULA_VERSION,
            "decided_reports": 0,
            "active_months": 0,
        }

    roots = int(row.root_reports)
    decided = int(row.decided or 0)
    volume_progress = min(1.0, math.log1p(roots) / math.log(21))
    outcome_accuracy = (
        (int(row.actioned or 0) / decided * min(1.0, decided / 10)) if decided else 0.0
    )
    evidence_quality = min(1.0, float(row.evidence_total or 0) / roots)
    consistency = min(1.0, int(row.active_months or 0) / 6)
    decay = min(20, _inactive_months(row.last_report_at) * 2)
    return {
        "volume_progress": volume_progress,
        "outcome_accuracy": outcome_accuracy,
        "evidence_quality": evidence_quality,
        "consistency": consistency,
        "decay": decay,
        "formula_version": TRUST_SCORE_FORMULA_VERSION,
        "decided_reports": decided,
        "active_months": int(row.active_months or 0),
    }


def _score_from_breakdown(breakdown: dict[str, float | int | str]) -> int:
    return max(
        0,
        min(
            100,
            round(
                20 * float(breakdown["volume_progress"])
                + 45 * float(breakdown["outcome_accuracy"])
                + 20 * float(breakdown["evidence_quality"])
                + 15 * float(breakdown["consistency"])
                - int(breakdown["decay"])
            ),
        ),
    )


def _score(row) -> int:
    return _score_from_breakdown(_normalized_breakdown(row))


def compute_trust_score(user_id: str, db: Session) -> int:
    return _score(_reliability_row(user_id, db))


def _profile_summary(row) -> dict:
    breakdown = _normalized_breakdown(row)
    score = _score_from_breakdown(breakdown)
    return {
        "trust_score": score,
        "badge": badge_for_score(score),
        "total_reports": int(row.root_reports or 0) if row else 0,
        "actioned_reports": int(row.actioned or 0) if row else 0,
        "pending_reports": int(row.pending or 0) if row else 0,
        **breakdown,
    }


def get_contributor_profile(user_id: str, db: Session) -> dict:
    row = _reliability_row(user_id, db)
    return {
        **_profile_summary(row),
        "first_report_at": row.first_report_at if row else None,
        "last_report_at": row.last_report_at if row else None,
    }


def get_contributor_reports(
    user_id: str, page: int = 1, limit: int = 20, db: Session = None
) -> dict:
    if page < 1:
        page = 1
    if limit < 1 or limit > 100:
        limit = 20
    offset = (page - 1) * limit
    summary = _profile_summary(_reliability_row(user_id, db))
    total = int(summary["total_reports"])
    rows = db.execute(
        text(
            """SELECT report_id,created_at,category,sub_category,status,ST_Y(location::geometry) lat,ST_X(location::geometry) lon FROM wims.citizen_reports WHERE contributor_user_id=:uid AND linked_to_report_id IS NULL ORDER BY created_at DESC LIMIT :limit OFFSET :offset"""
        ),
        {"uid": user_id, "limit": limit, "offset": offset},
    ).fetchall()
    return {
        **summary,
        "reports": [
            {
                "report_id": r.report_id,
                "created_at": r.created_at,
                "category": r.category,
                "sub_category": r.sub_category,
                "status": r.status,
                "latitude": float(r.lat),
                "longitude": float(r.lon),
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": math.ceil(total / limit) if total else 1,
    }


def get_contributor_stats(user_id: str, db: Session) -> dict:
    summary = _profile_summary(_reliability_row(user_id, db))
    rows = db.execute(
        text(
            """SELECT date_trunc('month', created_at) AS month, count(*) count FROM wims.citizen_reports WHERE contributor_user_id=:uid AND linked_to_report_id IS NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 12"""
        ),
        {"uid": user_id},
    ).fetchall()
    return {
        **summary,
        "monthly_report_counts": [
            {"month": r.month.isoformat(), "count": int(r.count)} for r in rows
        ],
    }
