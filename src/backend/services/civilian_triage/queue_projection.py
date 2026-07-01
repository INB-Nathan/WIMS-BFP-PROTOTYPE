"""Civilian triage queue projection.

`get_queue` intentionally materializes durable singleton clusters before reading
so validators always receive a claimable cluster id for active public signal rows.
The projection never exposes device ids, IP hashes, FCM tokens, or other privacy fields.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import set_rls_context
from services.civilian_triage.models import (
    FollowupSummary,
    StationContext,
    TriageClusterEntry,
    TriageQueueResponse,
    TriageReportEntry,
    TrustBreakdown,
)
from services.civilian_triage.policies import aging_flags, severity

logger = logging.getLogger("wims.civilian_triage.queue_projection")


def _table_exists(db: Session, schema: str, table: str) -> bool:
    """Check whether a table exists in the given schema.

    Used to gracefully handle optional migrations (e.g. citizen_report_followups)
    that may not have been applied to the current deployment yet.
    """
    row = db.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = :schema AND table_name = :table"
        ),
        {"schema": schema, "table": table},
    ).fetchone()
    return row is not None


def _build_trust_breakdown(
    has_category,
    has_sub_category,
    has_reported_at,
    has_device_id,
    has_witness_name,
    has_witness_phone,
    nearest_500m,
    nearest_2km,
    nearest_5km,
) -> TrustBreakdown:
    included, missing = [], []
    if has_category:
        included.append("category")
    else:
        missing.append("category")
    if has_sub_category:
        included.append("sub_category")
    else:
        missing.append("sub_category")
    if has_reported_at:
        included.append("reported_at")
    else:
        missing.append("reported_at")
    if has_device_id:
        included.append("device_id")
    else:
        missing.append("device_id")
    if has_witness_name:
        included.append("witness_name")
    if has_witness_phone:
        included.append("witness_phone")
    if nearest_500m:
        included.append("station_500m")
    elif nearest_2km:
        included.append("station_2km")
    elif nearest_5km:
        included.append("station_5km")
    else:
        missing.append("station_proximity")

    return TrustBreakdown(
        score=0,
        included_signals=included,
        missing_signals=missing,
        gps_mismatch=False,
        duplicate_device_count_30m=0,
    )


# ─── GET /api/triage/queue ────────────────────────────────────────────────────


def get_queue(
    user: dict,
    db: Session,
    # Quick filters
    needs_help: bool = Query(False),
    someone_else_needs_help: bool = Query(False),
    aging: bool = Query(False),
    timeout_risk: bool = Query(False),
    danger: bool = Query(False),
    confidence: str | None = Query(None),  # HIGH | MEDIUM | LOW
    unreviewed: bool = Query(False),
    claimed_by_me: bool = Query(False),
    actioned_today: bool = Query(False),
    rejected_today: bool = Query(False),
) -> TriageQueueResponse:
    """
    Cluster-oriented civilian report triage queue for validators.

    Grouping logic:
    - Reports that are explicit members of the same cluster are grouped together.
    - Reports without an explicit cluster appear as singleton entries.
    - Each cluster entry also carries a `related_count` of reports within 100m/1hr
      (ST_DWithin computed at read time) to support severity and outlier detection.

    Ordering: life-safety → danger → aging → timeout_risk → severity →
              cluster_size → avg_trust → oldest_report_time

    Privacy: device_id, ip_hash, notification tokens are never exposed.
             Duplicate-device signals are shown as counts, not raw IDs.
    """

    user_id = user.get("user_id")
    now = datetime.now(timezone.utc)
    params: dict = {}

    # ── Base filter ─────────────────────────────────────────────────────────
    # The default queue is active/non-terminal reports. Terminal quick filters
    # intentionally switch modes so validators can inspect today's outcomes.
    if actioned_today:
        base_filters = ["cr.status = 'ACTIONED' AND cr.created_at >= :today"]
        params["today"] = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif rejected_today:
        base_filters = ["cr.status LIKE 'REJECTED_%' AND cr.created_at >= :today"]
        params["today"] = now.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        base_filters = [
            "cr.status NOT IN ('ACTIONED','REJECTED_BOGUS','REJECTED_DUPLICATE','REJECTED_INSUFFICIENT','REJECTED_TIMEOUT')"
        ]

    if needs_help:
        base_filters.append("cr.safety_status = 'I_NEED_HELP'")
    if someone_else_needs_help:
        base_filters.append("cr.safety_status = 'SOMEONE_ELSE_NEEDS_HELP'")
    if unreviewed:
        base_filters.append("cr.status = 'PENDING'")

    # Ensure appended public updates are grouped with their parent report even
    # when the update is outside the spatial/time suggestion window.
    db.execute(
        text("""
            WITH linked_edges AS (
                SELECT child.linked_to_report_id AS parent_id, child.report_id AS child_id
                FROM wims.citizen_reports child
                JOIN wims.citizen_reports parent ON parent.report_id = child.linked_to_report_id
                WHERE child.linked_to_report_id IS NOT NULL
                  AND child.status NOT IN ('ACTIONED','REJECTED_BOGUS','REJECTED_DUPLICATE','REJECTED_INSUFFICIENT','REJECTED_TIMEOUT')
                  AND parent.status NOT IN ('ACTIONED','REJECTED_BOGUS','REJECTED_DUPLICATE','REJECTED_INSUFFICIENT','REJECTED_TIMEOUT')
            ),
            existing_targets AS (
                SELECT DISTINCT ON (le.parent_id, le.child_id)
                       le.parent_id,
                       le.child_id,
                       cc.cluster_id
                FROM linked_edges le
                JOIN wims.citizen_report_cluster_members cm
                  ON cm.report_id IN (le.parent_id, le.child_id)
                JOIN wims.citizen_report_clusters cc ON cc.cluster_id = cm.cluster_id
                WHERE cc.status != 'CLUSTER_CLOSED'
                ORDER BY le.parent_id, le.child_id, cc.updated_at DESC NULLS LAST, cc.cluster_id DESC
            ),
            created_targets AS (
                INSERT INTO wims.citizen_report_clusters (anchor_report_id, status)
                SELECT DISTINCT le.parent_id, 'CLUSTER_MONITORING'
                FROM linked_edges le
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM existing_targets et
                    WHERE et.parent_id = le.parent_id AND et.child_id = le.child_id
                )
                RETURNING cluster_id, anchor_report_id AS parent_id
            ),
            targets AS (
                SELECT parent_id, child_id, cluster_id FROM existing_targets
                UNION ALL
                SELECT ct.parent_id, le.child_id, ct.cluster_id
                FROM created_targets ct
                JOIN linked_edges le ON le.parent_id = ct.parent_id
            ),
            memberships AS (
                SELECT cluster_id, parent_id AS report_id FROM targets
                UNION
                SELECT cluster_id, child_id AS report_id FROM targets
            )
            INSERT INTO wims.citizen_report_cluster_members (cluster_id, report_id)
            SELECT cluster_id, report_id
            FROM memberships
            ON CONFLICT DO NOTHING
        """)
    )

    # Ensure active public signal rows have a durable cluster workflow record.
    # Read-time spatial grouping is still used for suggestions/severity, but
    # validators need a cluster id before they can claim and apply actions.
    db.execute(
        text("""
            WITH unclustered AS (
                SELECT cr.report_id
                FROM wims.citizen_reports cr
                WHERE cr.status IN ('PENDING', 'UNDER_REVIEW', 'LINKED')
                  AND NOT EXISTS (
                      SELECT 1
                      FROM wims.citizen_report_cluster_members cm
                      JOIN wims.citizen_report_clusters cc ON cc.cluster_id = cm.cluster_id
                      WHERE cm.report_id = cr.report_id
                        AND cc.status != 'CLUSTER_CLOSED'
                  )
            ),
            groupable AS (
                SELECT u.report_id
                FROM unclustered u
                JOIN wims.citizen_reports cr ON cr.report_id = u.report_id
                WHERE EXISTS (
                    SELECT 1
                    FROM wims.citizen_reports r2
                    WHERE r2.report_id != u.report_id
                      AND r2.status NOT LIKE 'REJECTED_%'
                      AND r2.status != 'ACTIONED'
                      AND ST_DWithin(cr.location::geography, r2.location::geography, 100)
                      AND r2.created_at >= cr.created_at - interval '1 hour'
                      AND r2.created_at <= cr.created_at + interval '1 hour'
                )
            ),
            created AS (
                INSERT INTO wims.citizen_report_clusters (anchor_report_id, status)
                SELECT report_id, 'CLUSTER_MONITORING'
                FROM groupable
                RETURNING cluster_id, anchor_report_id
            )
            INSERT INTO wims.citizen_report_cluster_members (cluster_id, report_id)
            SELECT cluster_id, anchor_report_id
            FROM created
            ON CONFLICT DO NOTHING
        """)
    )
    db.commit()

    # Commit clears the SET LOCAL RLS context established by get_db_with_rls().
    # Re-establish it before the queue SELECT; otherwise app-user production
    # sessions see zero citizen_reports after materialization.
    if user_id is not None:
        set_rls_context(db, user_id)

    # Aging and timeout_risk are applied post-compute (age computed from created_at)
    # Confidence and claimed_by_me depend on computed severity / CTE aliases, so
    # they are applied post-fetch.
    where_clause = " AND ".join(base_filters)

    # ── Check if follow-up table exists (migration may not be applied yet) ────
    has_followups = _table_exists(db, "wims", "citizen_report_followups")

    followup_cte = (
        """
            ,
            followup_aggs AS (
                -- Aggregate follow-up text and count per report
                SELECT
                    f.report_id,
                    COUNT(*) AS followup_count,
                    json_agg(
                        json_build_object(
                            'followup_id', f.followup_id,
                            'followup_text', f.followup_text,
                            'created_at', f.created_at
                        )
                        ORDER BY f.created_at ASC
                    ) FILTER (WHERE f.followup_id IS NOT NULL) AS followups_json
                FROM wims.citizen_report_followups f
                GROUP BY f.report_id
            )"""
        if has_followups
        else ""
    )

    followup_select = (
        """,

                -- Follow-up data
                COALESCE(fa.followup_count, 0) AS followup_count,
                fa.followups_json"""
        if has_followups
        else """,

                -- Follow-up data (table not yet migrated)
                0 AS followup_count,
                NULL::json AS followups_json"""
    )

    followup_join = (
        """
            LEFT JOIN followup_aggs fa ON fa.report_id = cr.report_id"""
        if has_followups
        else ""
    )

    # ── Fetch active reports with cluster membership, station context, signals ─
    # Columns selected for trust breakdown + station context, NO privacy fields.
    rows = db.execute(
        text(f"""
            WITH latest_clusters AS (
                -- Per report: latest cluster membership (if any)
                SELECT DISTINCT ON (cm.report_id)
                       cm.report_id,
                       cc.cluster_id,
                       cc.status        AS cluster_status,
                       cc.assigned_to,
                       cc.review_started_at,
                       cc.anchor_report_id
                FROM wims.citizen_report_cluster_members cm
                JOIN wims.citizen_report_clusters cc ON cc.cluster_id = cm.cluster_id
                WHERE cc.status != 'CLUSTER_CLOSED'
                ORDER BY cm.report_id, cc.updated_at DESC NULLS LAST
            ),
            related_counts AS (
                -- Count reports within 100m / 1hr for each report (excl. self)
                SELECT
                    r.report_id,
                    COUNT(r2.report_id) AS related_count
                FROM wims.citizen_reports r
                LEFT JOIN LATERAL (
                    SELECT r2.report_id
                    FROM wims.citizen_reports r2
                    WHERE r2.report_id != r.report_id
                      AND r2.status NOT LIKE 'REJECTED_%'
                      AND r2.status != 'ACTIONED'
                      AND ST_DWithin(r.location::geography, r2.location::geography, 100)
                      AND r2.created_at >= r.created_at - interval '1 hour'
                      AND r2.created_at <= r.created_at + interval '1 hour'
                ) r2 ON TRUE
                WHERE r.status NOT LIKE 'REJECTED_%' AND r.status != 'ACTIONED'
                GROUP BY r.report_id
            ),
            station_info AS (
                SELECT
                    cr.report_id,
                    fs.station_name,
                    ST_Distance(cr.location::geography, fs.location::geography) AS distance_m,
                    fs.phone
                FROM wims.citizen_reports cr
                LEFT JOIN wims.ref_fire_stations fs ON fs.station_id = cr.nearest_station_id
            ),
            dup_counts AS (
                -- Duplicate device signals within 30 min for each report
                SELECT
                    cr.report_id,
                    COUNT(cr2.report_id) AS dup_count_30m
                FROM wims.citizen_reports cr
                LEFT JOIN LATERAL (
                    SELECT cr2.report_id, cr2.device_id
                    FROM wims.citizen_reports cr2
                    WHERE cr.device_id IS NOT NULL
                      AND cr2.device_id IS NOT NULL
                      AND cr2.device_id = cr.device_id
                      AND cr2.created_at >= now() - interval '30 minutes'
                      AND cr2.report_id != cr.report_id
                ) cr2 ON TRUE
                GROUP BY cr.report_id
            ){followup_cte}
            SELECT
                cr.report_id,
                ST_Y(cr.location::geometry) AS lat,
                ST_X(cr.location::geometry) AS lon,
                cr.category,
                cr.sub_category,
                cr.reporting_context,
                cr.safety_status,
                cr.status,
                cr.status_explanation,
                cr.description,
                cr.linked_to_report_id,
                cr.trust_score,
                cr.gps_distance_m,
                cr.link_count,
                cr.created_at,
                cr.reported_at,
                cr.previous_report_id,

                -- Signal booleans for trust breakdown
                (cr.category IS NOT NULL)::bool AS has_category,
                (cr.sub_category IS NOT NULL)::bool AS has_sub_category,
                (cr.reported_at IS NOT NULL)::bool AS has_reported_at,
                (cr.device_id IS NOT NULL)::bool AS has_device_id,
                (cr.witness_name IS NOT NULL)::bool AS has_witness_name,
                (cr.witness_phone IS NOT NULL)::bool AS has_witness_phone,

                -- Station proximity tiers
                EXISTS(SELECT 1 FROM wims.ref_fire_stations WHERE nearest_station_id = station_id AND ST_DWithin(cr.location::geography, location::geography, 500)) AS nearest_500m,
                EXISTS(SELECT 1 FROM wims.ref_fire_stations WHERE nearest_station_id = station_id AND ST_DWithin(cr.location::geography, location::geography, 2000)) AS nearest_2km,
                EXISTS(SELECT 1 FROM wims.ref_fire_stations WHERE nearest_station_id = station_id AND ST_DWithin(cr.location::geography, location::geography, 5000)) AS nearest_5km,

                -- Cluster
                lc.cluster_id,
                lc.cluster_status,
                lc.assigned_to,
                lc.review_started_at,
                lc.anchor_report_id,

                -- Related count
                COALESCE(rc.related_count, 0) AS related_count,

                -- Station
                si.station_name,
                si.distance_m,
                si.phone,

                -- Duplicate count
                COALESCE(dc.dup_count_30m, 0) AS dup_count_30m{followup_select}

            FROM wims.citizen_reports cr
            LEFT JOIN latest_clusters lc ON lc.report_id = cr.report_id
            LEFT JOIN related_counts rc ON rc.report_id = cr.report_id
            LEFT JOIN station_info si ON si.report_id = cr.report_id
            LEFT JOIN dup_counts dc ON dc.report_id = cr.report_id{followup_join}
            WHERE {where_clause}
            ORDER BY
                cr.safety_status = 'I_NEED_HELP' DESC,
                cr.safety_status = 'SOMEONE_ELSE_NEEDS_HELP' DESC,
                (cr.created_at < now() - interval '60 minutes') DESC,
                (cr.created_at < now() - interval '90 minutes') DESC,
                rc.related_count DESC NULLS LAST,
                COUNT(lc.cluster_id) OVER () DESC,
                AVG(cr.trust_score) OVER () DESC,
                cr.created_at ASC
        """),
        params,
    ).fetchall()

    # ── Build report entries ──────────────────────────────────────────────────
    # Build report entries with cluster metadata captured in one pass
    # Row indices mapped from the SELECT clause
    entries: list[TriageReportEntry] = []
    report_cluster_info: dict[
        int, tuple
    ] = {}  # report_id → (cluster_id, cluster_status, assigned_to, review_started_at, anchor_report_id)

    for row in rows:
        # Column indices:
        #  0: report_id          14: created_at          26: cluster_id
        #  1: lat                15: reported_at          27: cluster_status
        #  2: lon                16: previous_report_id   28: assigned_to
        #  3: category            17: has_category         29: review_started_at
        #  4: sub_category        18: has_sub_category     30: anchor_report_id
        #  5: reporting_context  19: has_reported_at      31: related_count
        #  6: safety_status       20: has_device_id        32: station_name
        #  7: status             21: has_witness_name     33: distance_m
        #  8: status_explanation 22: has_witness_phone     34: phone
        #  9: description        23: nearest_500m          35: dup_count_30m
        # 10: linked_to_report_id 24: nearest_2km          36: followup_count
        # 11: trust_score        25: nearest_5km           37: followups_json
        # 12: gps_distance_m
        # 13: link_count
        cluster_id = row[26]
        cluster_status = row[27]
        assigned_to_uuid = row[28]
        review_started_at = row[29]
        anchor_report_id = row[30]

        # Parse follow-up JSON
        followups = []
        followups_json = row[37]
        if followups_json is not None:
            try:
                if isinstance(followups_json, str):
                    followups_raw = json.loads(followups_json)
                else:
                    followups_raw = followups_json
                followups = [
                    FollowupSummary(
                        followup_id=f["followup_id"],
                        followup_text=f["followup_text"],
                        created_at=f["created_at"].replace(tzinfo=timezone.utc)
                        if isinstance(f["created_at"], datetime) and f["created_at"].tzinfo is None
                        else f["created_at"],
                    )
                    for f in (followups_raw or [])
                ]
            except Exception:
                logger.warning(
                    "Failed to parse followups_json for report %s",
                    row[0],
                    exc_info=True,
                )

        # Trust breakdown from signal boolean columns (indices 17-22)
        has_category = row[17]
        has_sub_category = row[18]
        has_reported_at = row[19]
        has_device_id = row[20]
        has_witness_name = row[21]
        has_witness_phone = row[22]
        nearest_500m = row[23]
        nearest_2km = row[24]
        nearest_5km = row[25]

        tb = _build_trust_breakdown(
            has_category,
            has_sub_category,
            has_reported_at,
            has_device_id,
            has_witness_name,
            has_witness_phone,
            nearest_500m,
            nearest_2km,
            nearest_5km,
        )
        tb.duplicate_device_count_30m = int(row[35] or 0)
        gps_distance_m = row[12]
        tb.gps_mismatch = bool(gps_distance_m is not None and float(gps_distance_m) > 200)
        tb.score = int(row[11] or 0)

        created_at_val = row[14]
        is_aging, is_timeout_risk, is_danger = aging_flags(created_at_val)
        sev = severity(int(row[31] or 0), tb.score)

        if aging and not is_aging:
            continue
        if timeout_risk and not is_timeout_risk:
            continue
        if danger and not is_danger:
            continue
        if confidence and sev != confidence:
            continue
        if claimed_by_me and str(assigned_to_uuid) != str(user_id):
            continue

        station = StationContext(
            name=row[32],
            distance_m=float(row[33]) if row[33] is not None else None,
            phone_available=bool(row[34] and str(row[34]).strip()),
        )

        entry = TriageReportEntry(
            report_id=row[0],
            latitude=float(row[1]),
            longitude=float(row[2]),
            category=row[3],
            sub_category=row[4],
            reporting_context=row[5],
            safety_status=row[6],
            status=row[7],
            status_explanation=row[8],
            description=row[9],
            linked_to_report_id=row[10],
            trust_breakdown=tb,
            severity=sev,
            related_count=int(row[31] or 0),
            linked_count=int(row[13] or 0),
            created_at=created_at_val.replace(tzinfo=timezone.utc)
            if created_at_val.tzinfo is None
            else created_at_val,
            reported_at=row[15].replace(tzinfo=timezone.utc)
            if row[15] and row[15].tzinfo is None
            else row[15],
            is_aging=is_aging,
            is_timeout_risk=is_timeout_risk,
            is_danger=is_danger,
            previous_report_id=row[16],
            station=station,
            followups=followups,
        )
        entries.append(entry)

        report_cluster_info[row[0]] = (
            cluster_id,
            cluster_status,
            assigned_to_uuid,
            review_started_at,
            anchor_report_id,
        )

    # ── Group into clusters ───────────────────────────────────────────────────
    cluster_map: dict[int | str, TriageClusterEntry] = {}

    for entry in entries:
        cluster_id, cluster_status, assigned_to_uuid, review_started_at, anchor_report_id = (
            report_cluster_info.get(entry.report_id, (None, None, None, None, None))
        )

        cluster_key = cluster_id if cluster_id is not None else f"singleton:{entry.report_id}"

        if cluster_key not in cluster_map:
            # Resolve assigned_to display name
            assigned_to_name = None
            if assigned_to_uuid:
                name_row = db.execute(
                    text("SELECT username FROM wims.users WHERE user_id = :uid"),
                    {"uid": assigned_to_uuid},
                ).fetchone()
                if name_row:
                    assigned_to_name = name_row[0]

            cluster_map[cluster_key] = TriageClusterEntry(
                cluster_id=cluster_id,
                anchor_report_id=anchor_report_id,
                cluster_status=cluster_status,
                assigned_to=assigned_to_name,
                review_started_at=(
                    review_started_at.replace(tzinfo=timezone.utc)
                    if review_started_at and review_started_at.tzinfo is None
                    else review_started_at
                ),
                member_count=0,
                has_life_safety=False,
                severity="LOW",
                avg_trust=0.0,
                oldest_report_at=entry.created_at,
                is_aging=entry.is_aging,
                is_timeout_risk=entry.is_timeout_risk,
                is_danger=entry.is_danger,
                related_count=0,
                reports=[],
                station=entry.station,
            )

        cluster_map[cluster_key].reports.append(entry)
        cluster_map[cluster_key].member_count += 1

        if entry.safety_status in ("I_NEED_HELP", "SOMEONE_ELSE_NEEDS_HELP"):
            cluster_map[cluster_key].has_life_safety = True
        if entry.is_aging:
            cluster_map[cluster_key].is_aging = True
        if entry.is_timeout_risk:
            cluster_map[cluster_key].is_timeout_risk = True
        if entry.is_danger:
            cluster_map[cluster_key].is_danger = True
        if entry.related_count > cluster_map[cluster_key].related_count:
            cluster_map[cluster_key].related_count = entry.related_count

    # ── Compute cluster-level aggregates ─────────────────────────────────────
    for cluster in cluster_map.values():
        if cluster.reports:
            trust_scores = [r.trust_breakdown.score for r in cluster.reports]
            cluster.avg_trust = sum(trust_scores) / len(trust_scores)
            severities = [r.severity for r in cluster.reports]
            if "HIGH" in severities:
                cluster.severity = "HIGH"
            elif "MEDIUM" in severities:
                cluster.severity = "MEDIUM"
            oldest = min(r.created_at for r in cluster.reports)
            cluster.oldest_report_at = (
                oldest.replace(tzinfo=timezone.utc) if oldest.tzinfo is None else oldest
            )

    # ── Sort clusters by priority ordering ────────────────────────────────────
    sorted_clusters = sorted(
        cluster_map.values(),
        key=lambda c: (
            not c.has_life_safety,
            not c.is_danger,
            not c.is_aging,
            not c.is_timeout_risk,
            c.severity == "LOW",
            -c.member_count,
            -c.avg_trust,
            c.oldest_report_at,
        ),
    )

    return TriageQueueResponse(
        clusters=sorted_clusters,
        polled_at=datetime.now(timezone.utc),
        total_reports=len(entries),
    )
