"""Detailed, privacy-minimized cluster evidence workspace projection."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from schemas.triage_workspace import (
    ContributorCredibility,
    EvidenceLocation,
    TriageWorkspaceResponse,
    WorkspaceCluster,
    WorkspaceFollowup,
    WorkspacePhoto,
    WorkspaceReport,
    WorkspaceStatusUpdate,
)
from services.civilian_triage.workflow import get_cluster_activity_command
from services.contributor import get_contributor_profile


def _location(
    source: str,
    latitude,
    longitude,
    *,
    accuracy_m=None,
    approximate: bool = False,
    distance_to_report_m=None,
) -> EvidenceLocation:
    available = latitude is not None and longitude is not None
    return EvidenceLocation(
        source=source,
        available=available,
        latitude=float(latitude) if available else None,
        longitude=float(longitude) if available else None,
        accuracy_m=float(accuracy_m) if accuracy_m is not None else None,
        approximate=approximate,
        distance_to_report_m=(
            float(distance_to_report_m) if distance_to_report_m is not None else None
        ),
    )


def _metadata(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def get_workspace(db: Session, cluster_id: int) -> TriageWorkspaceResponse:
    cluster = db.execute(
        text("""
            SELECT c.cluster_id, c.anchor_report_id, c.status, c.status_note,
                   c.assigned_to, u.username AS assigned_username,
                   c.review_started_at, c.updated_at
            FROM wims.citizen_report_clusters c
            LEFT JOIN wims.users u ON u.user_id = c.assigned_to
            WHERE c.cluster_id = :cluster_id
        """),
        {"cluster_id": cluster_id},
    ).fetchone()
    if cluster is None:
        raise HTTPException(status_code=404, detail="Cluster not found")

    report_rows = db.execute(
        text("""
            SELECT cr.report_id, cr.category, cr.sub_category,
                   cr.reporting_context, cr.safety_status, cr.status,
                   cr.status_explanation, cr.description, cr.trust_score,
                   cr.created_at, cr.reported_at, cr.previous_report_id,
                   cr.contributor_user_id,
                   ST_Y(cr.location::geometry) AS report_lat,
                   ST_X(cr.location::geometry) AS report_lon,
                   cr.phone_latitude, cr.phone_longitude,
                   CASE WHEN cr.phone_latitude IS NOT NULL
                              AND cr.phone_longitude IS NOT NULL
                        THEN ST_Distance(
                            cr.location,
                            ST_SetSRID(ST_MakePoint(
                                cr.phone_longitude, cr.phone_latitude
                            ), 4326)::geography
                        ) END AS device_to_report_m,
                   ST_Y(cr.ip_geo_centroid::geometry) AS ip_lat,
                   ST_X(cr.ip_geo_centroid::geometry) AS ip_lon,
                   cr.ip_geo_accuracy_m,
                   CASE WHEN cr.ip_geo_centroid IS NOT NULL
                        THEN ST_Distance(cr.location, cr.ip_geo_centroid) END
                        AS ip_to_report_m
            FROM wims.citizen_report_cluster_members cm
            JOIN wims.citizen_reports cr ON cr.report_id = cm.report_id
            WHERE cm.cluster_id = :cluster_id
            ORDER BY cr.created_at, cr.report_id
        """),
        {"cluster_id": cluster_id},
    ).fetchall()
    report_ids = [int(row.report_id) for row in report_rows]

    photos: dict[int, list[WorkspacePhoto]] = defaultdict(list)
    followups: dict[int, list[WorkspaceFollowup]] = defaultdict(list)
    feedback: dict[int, list[WorkspaceStatusUpdate]] = defaultdict(list)
    if report_ids:
        for row in db.execute(
            text("""
                SELECT rp.photo_id::text AS photo_id, rp.report_id,
                       rp.media_type, rp.image_width, rp.image_height,
                       rp.exif_datetime_original, rp.exif_gps_status,
                       rp.gps_consensus, rp.exif_data_source,
                       rp.exif_to_report_distance_m,
                       rp.exif_gps_lat, rp.exif_gps_lon,
                       CASE WHEN cr.phone_latitude IS NOT NULL
                                  AND cr.phone_longitude IS NOT NULL
                                  AND rp.exif_gps_lat IS NOT NULL
                                  AND rp.exif_gps_lon IS NOT NULL
                            THEN ST_Distance(
                                ST_SetSRID(ST_MakePoint(
                                    cr.phone_longitude, cr.phone_latitude
                                ), 4326)::geography,
                                ST_SetSRID(ST_MakePoint(
                                    rp.exif_gps_lon, rp.exif_gps_lat
                                ), 4326)::geography
                            ) END AS device_to_exif_m
                FROM wims.report_photos rp
                JOIN wims.citizen_reports cr ON cr.report_id = rp.report_id
                WHERE rp.report_id = ANY(:report_ids)
                ORDER BY rp.created_at, rp.photo_id
            """),
            {"report_ids": report_ids},
        ).fetchall():
            photo_id = str(row.photo_id)
            photos[int(row.report_id)].append(
                WorkspacePhoto(
                    photo_id=photo_id,
                    content_url=(
                        f"/api/triage/reports/{int(row.report_id)}/photos/{photo_id}/content"
                    ),
                    media_type=row.media_type,
                    image_width=int(row.image_width),
                    image_height=int(row.image_height),
                    capture_time=row.exif_datetime_original,
                    exif_available=row.exif_gps_status == "present",
                    gps_consensus=row.gps_consensus,
                    evidence_source=row.exif_data_source,
                    image_to_report_distance_m=(
                        float(row.exif_to_report_distance_m)
                        if row.exif_to_report_distance_m is not None
                        else None
                    ),
                    device_to_exif_distance_m=(
                        float(row.device_to_exif_m) if row.device_to_exif_m is not None else None
                    ),
                    exif_location=_location(
                        "image_exif_gps",
                        row.exif_gps_lat,
                        row.exif_gps_lon,
                        distance_to_report_m=row.exif_to_report_distance_m,
                    ),
                )
            )

        for row in db.execute(
            text("""
                SELECT followup_id, report_id, followup_text, created_at
                FROM wims.citizen_report_followups
                WHERE report_id = ANY(:report_ids)
                ORDER BY created_at, followup_id
            """),
            {"report_ids": report_ids},
        ).fetchall():
            followups[int(row.report_id)].append(
                WorkspaceFollowup(
                    followup_id=int(row.followup_id),
                    followup_text=row.followup_text,
                    created_at=row.created_at,
                )
            )

        for row in db.execute(
            text("""
                SELECT update_id, report_id, stage, metadata, created_at
                FROM wims.report_status_updates
                WHERE report_id = ANY(:report_ids)
                ORDER BY created_at, update_id
            """),
            {"report_ids": report_ids},
        ).fetchall():
            feedback[int(row.report_id)].append(
                WorkspaceStatusUpdate(
                    update_id=int(row.update_id),
                    stage=row.stage,
                    metadata=_metadata(row.metadata),
                    created_at=row.created_at,
                )
            )

    contributor_cache: dict[str, ContributorCredibility] = {}
    reports: list[WorkspaceReport] = []
    for row in report_rows:
        contributor_id = str(row.contributor_user_id) if row.contributor_user_id else None
        if contributor_id and contributor_id not in contributor_cache:
            summary = get_contributor_profile(contributor_id, db)
            contributor_cache[contributor_id] = ContributorCredibility(
                authenticated=True,
                trust_score=summary["trust_score"],
                badge=summary["badge"],
                total_reports=summary["total_reports"],
                actioned_reports=summary["actioned_reports"],
                pending_reports=summary["pending_reports"],
                evidence_quality=summary["evidence_quality"],
                active_months=summary["active_months"],
            )
        contributor = (
            contributor_cache[contributor_id]
            if contributor_id
            else ContributorCredibility(authenticated=False)
        )
        report_id = int(row.report_id)
        reports.append(
            WorkspaceReport(
                report_id=report_id,
                category=row.category,
                sub_category=row.sub_category,
                reporting_context=row.reporting_context,
                safety_status=row.safety_status,
                status=row.status,
                status_explanation=row.status_explanation,
                description=row.description,
                trust_score=int(row.trust_score),
                created_at=row.created_at,
                reported_at=row.reported_at,
                previous_report_id=row.previous_report_id,
                report_location=_location("report_pin", row.report_lat, row.report_lon),
                device_location=_location(
                    "device_gps",
                    row.phone_latitude,
                    row.phone_longitude,
                    distance_to_report_m=row.device_to_report_m,
                ),
                ip_location=_location(
                    "ip_city_centroid",
                    row.ip_lat,
                    row.ip_lon,
                    accuracy_m=row.ip_geo_accuracy_m,
                    approximate=True,
                    distance_to_report_m=row.ip_to_report_m,
                ),
                photos=photos[report_id],
                contributor=contributor,
                followups=followups[report_id],
                feedback=feedback[report_id],
                contact_reveal_url=f"/api/triage/reports/{report_id}/contact-reveal",
            )
        )

    activity = get_cluster_activity_command(cluster_id, db)
    return TriageWorkspaceResponse(
        cluster=WorkspaceCluster(
            cluster_id=int(cluster.cluster_id),
            anchor_report_id=int(cluster.anchor_report_id),
            status=cluster.status,
            status_note=cluster.status_note,
            assigned_to_user_id=(str(cluster.assigned_to) if cluster.assigned_to else None),
            assigned_to=cluster.assigned_username,
            review_started_at=cluster.review_started_at,
            updated_at=cluster.updated_at,
        ),
        reports=reports,
        activity=activity.events,
        loaded_at=datetime.now(timezone.utc),
    )
