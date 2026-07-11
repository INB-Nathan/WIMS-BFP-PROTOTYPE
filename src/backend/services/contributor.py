"""Civilian Contributor — trust score engine, profile, leaderboard.

Trust score computation (§6.1 of the Civilian Contributor Enhancement spec):

    score = max(0, min(100, volume_credit + accuracy_bonus + photo_bonus - decay))

    volume_credit  = min(40, report_count * 2)          # +2 per report, cap 40
    accuracy_bonus = actioned_count * 5                  # +5 per ACTIONED report, no cap
    photo_bonus    = sum of photo_bonus_for_report()     # per-report via SECURITY DEFINER function
    decay          = inactive_months * 2                 # −2 per month since last report, floor 0
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("wims.contributor")

# ── Badge thresholds (§6.2) ───────────────────────────────────────────────────

BADGE_THRESHOLDS: list[tuple[int, str]] = [
    (0, "NOVICE"),
    (20, "REGULAR"),
    (50, "TRUSTED"),
    (80, "GUARDIAN"),
]


def badge_for_score(score: int) -> str:
    """Map a trust score (0-100) to a badge level.

    Boundaries (inclusive lower):
        0-19   → NOVICE
       20-49   → REGULAR
       50-79   → TRUSTED
       80-100  → GUARDIAN
    """
    # Iterate in reverse (highest threshold first) so the first match wins.
    for threshold, badge in reversed(BADGE_THRESHOLDS):
        if score >= threshold:
            return badge
    return BADGE_THRESHOLDS[0][1]  # fallback NOVICE


def compute_trust_score(user_id: str, db: Session) -> int:
    """Compute a registered contributor's 0-100 trust score from live data.

    Queries ``wims.citizen_reports`` for the user's report history, calls the
    ``wims.photo_bonus_for_report`` SECURITY DEFINER function per report, and
    applies the spec formula.  This is intentionally **not** cached in the DB
    — the read-time computation keeps 3-5 aggregations and a 10-line Python
    function, which is acceptable for the prototype.
    """
    # ── Gather lifetime stats ──────────────────────────────────────────────
    stats = db.execute(
        text("""
            SELECT
                COUNT(*)                                             AS total_reports,
                COUNT(*) FILTER (WHERE status = 'ACTIONED')         AS actioned_reports,
                COUNT(*) FILTER (WHERE status = 'PENDING')          AS pending_reports,
                MAX(created_at)                                     AS last_report_at,
                MIN(created_at)                                     AS first_report_at
            FROM wims.citizen_reports
            WHERE contributor_user_id = :uid
              AND linked_to_report_id IS NULL  -- count only root reports, not appends
        """),
        {"uid": user_id},
    ).fetchone()

    if stats is None or stats.total_reports == 0:
        return 0

    total_reports = int(stats.total_reports)
    actioned_reports = int(stats.actioned_reports)

    # ── Volume credit ──────────────────────────────────────────────────────
    volume_credit = min(40, total_reports * 2)

    # ── Accuracy bonus ──────────────────────────────────────────────────────
    accuracy_bonus = actioned_reports * 5

    # ── Photo bonus — call per-report SECURITY DEFINER function ──────────
    # The function bypasses RLS so the application session (wims_app) can
    # count photos even though report_photos RLS blocks SELECT for app roles.
    photo_bonus = 0
    report_rows = db.execute(
        text("""
            SELECT report_id
            FROM wims.citizen_reports
            WHERE contributor_user_id = :uid
              AND linked_to_report_id IS NULL
        """),
        {"uid": user_id},
    ).fetchall()

    for row in report_rows:
        bonus = db.execute(
            text("SELECT wims.photo_bonus_for_report(:rid)"),
            {"rid": int(row.report_id)},
        ).scalar()
        if bonus is not None:
            photo_bonus += int(bonus)

    # ── Decay (inactivity) ──────────────────────────────────────────────────
    last_report_at = stats.last_report_at
    decay = 0
    if last_report_at is not None:
        # Ensure timezone-aware comparison
        last_report = last_report_at
        if last_report.tzinfo is None:
            last_report = last_report.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        delta_days = (now - last_report).days
        inactive_months = max(0, delta_days // 30)
        decay = inactive_months * 2

    # ── Final score with floor and ceiling ──────────────────────────────────
    score = volume_credit + accuracy_bonus + photo_bonus - decay
    return max(0, min(100, score))


def get_contributor_profile(user_id: str, db: Session) -> dict:
    """Return trust score, badge, and lifetime stats for a registered contributor.

    The returned dict matches ``ContributorProfileResponse`` shape.
    """
    stats = db.execute(
        text("""
            SELECT
                COUNT(*)                                             AS total_reports,
                COUNT(*) FILTER (WHERE status = 'ACTIONED')         AS actioned_reports,
                COUNT(*) FILTER (WHERE status = 'PENDING')          AS pending_reports,
                MAX(created_at)                                     AS last_report_at,
                MIN(created_at)                                     AS first_report_at
            FROM wims.citizen_reports
            WHERE contributor_user_id = :uid
              AND linked_to_report_id IS NULL
        """),
        {"uid": user_id},
    ).fetchone()

    if stats is None or stats.total_reports == 0:
        return {
            "trust_score": 0,
            "badge": "NOVICE",
            "total_reports": 0,
            "actioned_reports": 0,
            "pending_reports": 0,
            "first_report_at": None,
            "last_report_at": None,
        }

    trust_score = compute_trust_score(user_id, db)
    badge = badge_for_score(trust_score)

    return {
        "trust_score": trust_score,
        "badge": badge,
        "total_reports": int(stats.total_reports),
        "actioned_reports": int(stats.actioned_reports),
        "pending_reports": int(stats.pending_reports),
        "first_report_at": stats.first_report_at,
        "last_report_at": stats.last_report_at,
    }


def get_contributor_reports(
    user_id: str,
    page: int = 1,
    limit: int = 20,
    db: Session = None,
) -> dict:
    """Return paginated root reports for a contributor.

    The returned dict matches ``ContributorReportsResponse`` shape.
    """
    if page < 1:
        page = 1
    if limit < 1 or limit > 100:
        limit = 20

    offset = (page - 1) * limit

    # Total count
    total = db.execute(
        text("""
            SELECT COUNT(*)
            FROM wims.citizen_reports
            WHERE contributor_user_id = :uid
              AND linked_to_report_id IS NULL
        """),
        {"uid": user_id},
    ).scalar()
    total = int(total) if total is not None else 0

    pages = math.ceil(total / limit) if total > 0 else 1

    rows = db.execute(
        text("""
            SELECT report_id,
                   created_at,
                   category,
                   sub_category,
                   status,
                   ST_Y(location::geometry) AS lat,
                   ST_X(location::geometry) AS lon
            FROM wims.citizen_reports
            WHERE contributor_user_id = :uid
              AND linked_to_report_id IS NULL
            ORDER BY created_at DESC
            LIMIT :limit
            OFFSET :offset
        """),
        {"uid": user_id, "limit": limit, "offset": offset},
    ).fetchall()

    reports = [
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
    ]

    return {
        "reports": reports,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages,
    }


def get_leaderboard(limit: int = 20, db: Session = None) -> list[dict]:
    """Return the top-N registered contributors by trust score.

    Only contributors who have opted in to the leaderboard
    (``opt_in_leaderboard = TRUE``) are included.

    Returns a list matching ``LeaderboardEntry`` shape.
    """
    if limit < 1 or limit > 100:
        limit = 20

    rows = db.execute(
        text("""
            SELECT
                cc.user_id,
                u.username AS display_name,
                cc.trust_score,
                cc.badge,
                COUNT(cr.report_id) AS report_count
            FROM wims.civilian_contributors cc
            JOIN wims.users u ON u.user_id = cc.user_id
            LEFT JOIN wims.citizen_reports cr
                ON cr.contributor_user_id = cc.user_id
                AND cr.linked_to_report_id IS NULL
            WHERE cc.opt_in_leaderboard = TRUE
            GROUP BY cc.user_id, u.username, cc.trust_score, cc.badge
            ORDER BY cc.trust_score DESC, report_count DESC
            LIMIT :limit
        """),
        {"limit": limit},
    ).fetchall()

    result: list[dict] = []
    for rank, row in enumerate(rows, start=1):
        result.append(
            {
                "rank": rank,
                "user_id": str(row.user_id),
                "display_name": row.display_name,
                "trust_score": int(row.trust_score) if row.trust_score is not None else 0,
                "badge": row.badge or "NOVICE",
                "report_count": int(row.report_count) if row.report_count is not None else 0,
            }
        )

    return result


def get_contributor_stats(user_id: str, db: Session) -> dict:
    """Return contributor vanity metrics with monthly report count breakdown.

    Builds on ``get_contributor_profile`` and adds a 12-month report-count
    trend.  The returned dict matches ``ContributorStatsResponse`` shape.
    """
    profile = get_contributor_profile(user_id, db)

    rows = db.execute(
        text("""
            SELECT
                DATE_TRUNC('month', created_at) AS month,
                COUNT(*) AS count
            FROM wims.citizen_reports
            WHERE contributor_user_id = :uid
            GROUP BY month
            ORDER BY month DESC
            LIMIT 12
        """),
        {"uid": user_id},
    ).fetchall()

    monthly_counts = [
        {"month": row.month.isoformat(), "count": int(row.count)}
        if row.month is not None
        else {"month": None, "count": int(row.count)}
        for row in rows
    ]

    return {
        "trust_score": profile["trust_score"],
        "badge": profile["badge"],
        "total_reports": profile["total_reports"],
        "actioned_reports": profile["actioned_reports"],
        "pending_reports": profile["pending_reports"],
        "monthly_report_counts": monthly_counts,
    }
