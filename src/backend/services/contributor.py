"""Contributor reliability scoring and profile services."""

from __future__ import annotations

import math
from sqlalchemy import text
from sqlalchemy.orm import Session

FORMULA_VERSION = "reliability-v1"
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
        text("""
        WITH roots AS (
            SELECT report_id, status, created_at
            FROM wims.citizen_reports
            WHERE contributor_user_id = :uid AND linked_to_report_id IS NULL
        ), evidence AS (
            SELECT r.report_id,
                   CASE WHEN COUNT(p.photo_id) > 0 THEN .25 ELSE 0 END
                   + CASE WHEN BOOL_OR(p.gps_consensus = 'both_match') THEN .35 ELSE 0 END
                   + CASE WHEN BOOL_OR(p.photo_reported_distance_m IS NOT NULL
                                       AND p.photo_reported_distance_m <= 500) THEN .20 ELSE 0 END
                   AS quality
            FROM roots r LEFT JOIN wims.report_photos p ON p.report_id = r.report_id
            GROUP BY r.report_id
        ), agg AS (
            SELECT COUNT(*) AS root_reports,
                   COUNT(*) FILTER (WHERE status IN
                     ('ACTIONED','REJECTED_BOGUS','REJECTED_DUPLICATE',
                      'REJECTED_INSUFFICIENT','REJECTED_TIMEOUT')) AS decided,
                   COUNT(*) FILTER (WHERE status = 'ACTIONED') AS actioned,
                   COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
                   MIN(created_at) AS first_report_at,
                   COUNT(DISTINCT date_trunc('month', created_at)) FILTER
                     (WHERE created_at >= date_trunc('month', now()) - interval '5 months') AS active_months,
                   MAX(created_at) AS last_report_at,
                   COALESCE(SUM(LEAST(1, COALESCE(e.quality, 0))), 0) AS evidence_total
            FROM roots r LEFT JOIN evidence e ON e.report_id = r.report_id
        ) SELECT * FROM agg
        """),
        {"uid": user_id},
    ).fetchone()


def _score(row) -> int:
    if not row or not row.root_reports:
        return 0
    roots, decided, actioned = int(row.root_reports), int(row.decided), int(row.actioned)
    volume = min(1.0, math.log1p(roots) / math.log(21))
    accuracy = (actioned / decided * min(1.0, decided / 10)) if decided else 0.0
    evidence = float(row.evidence_total or 0) / roots
    consistency = min(1.0, int(row.active_months or 0) / 6)
    inactive = 0
    if row.last_report_at:
        last = row.last_report_at
        if last.tzinfo is None:
            from datetime import timezone

            last = last.replace(tzinfo=timezone.utc)
        from datetime import datetime

        now = datetime.now(timezone.utc)
        inactive = max(0, (now.year - last.year) * 12 + now.month - last.month - 1)
    decay = min(20, inactive * 2)
    return max(
        0, min(100, round(20 * volume + 45 * accuracy + 20 * evidence + 15 * consistency - decay))
    )


def compute_trust_score(user_id: str, db: Session) -> int:
    return _score(_reliability_row(user_id, db))


def get_contributor_profile(user_id: str, db: Session) -> dict:
    row = _reliability_row(user_id, db)
    score = _score(row)
    if not row:
        return {
            "trust_score": 0,
            "badge": "NOVICE",
            "total_reports": 0,
            "actioned_reports": 0,
            "pending_reports": 0,
            "first_report_at": None,
            "last_report_at": None,
            "formula_version": FORMULA_VERSION,
        }
    return {
        "trust_score": score,
        "badge": badge_for_score(score),
        "total_reports": int(row.root_reports or 0),
        "actioned_reports": int(row.actioned or 0),
        "pending_reports": int(row.pending or 0),
        "first_report_at": row.first_report_at,
        "last_report_at": row.last_report_at,
        "formula_version": FORMULA_VERSION,
    }


def get_contributor_reports(
    user_id: str, page: int = 1, limit: int = 20, db: Session = None
) -> dict:
    if page < 1:
        page = 1
    if limit < 1 or limit > 100:
        limit = 20
    offset = (page - 1) * limit
    total = int(
        db.execute(
            text(
                "SELECT COUNT(*) FROM wims.citizen_reports WHERE contributor_user_id=:uid AND linked_to_report_id IS NULL"
            ),
            {"uid": user_id},
        ).scalar()
        or 0
    )
    rows = db.execute(
        text(
            """SELECT report_id,created_at,category,sub_category,status,ST_Y(location::geometry) lat,ST_X(location::geometry) lon FROM wims.citizen_reports WHERE contributor_user_id=:uid AND linked_to_report_id IS NULL ORDER BY created_at DESC LIMIT :limit OFFSET :offset"""
        ),
        {"uid": user_id, "limit": limit, "offset": offset},
    ).fetchall()
    return {
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
    profile = get_contributor_profile(user_id, db)
    rows = db.execute(
        text(
            """SELECT date_trunc('month', created_at) month, count(*) count FROM wims.citizen_reports WHERE contributor_user_id=:uid AND linked_to_report_id IS NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 12"""
        ),
        {"uid": user_id},
    ).fetchall()
    return {
        **profile,
        "monthly_report_counts": [
            {"month": r.month.isoformat(), "count": int(r.count)} for r in rows
        ],
    }
