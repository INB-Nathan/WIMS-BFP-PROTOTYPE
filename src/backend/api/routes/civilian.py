"""Civilian Reporting Phase 2 — public signal records, no auth."""

import hashlib
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from schemas.civilian import (
    CivilianReportAppend,
    CivilianReportCreate,
    CivilianReportResponse,
    CivilianReportTimelineItem,
    CivilianReportTimelineResponse,
    DuplicateSuggestionResponse,
    DuplicateSuggestionItem,
    MyReportItem,
    MyReportResponse,
    NotifyRegisterRequest,
    NotifyRegisterResponse,
)

router = APIRouter(prefix="/api/civilian", tags=["civilian"])

REJECTION_GUIDANCE = {
    "REJECTED_BOGUS": "If this is a real emergency, call 911 or your nearest BFP station.",
    "REJECTED_DUPLICATE": "This incident was already reported. No further action needed.",
    "REJECTED_INSUFFICIENT": "We couldn't verify this with the information provided. Please call 911 if this is urgent.",
    "REJECTED_TIMEOUT": "Submit a new report if the emergency is ongoing, or call 911.",
}

STATUS_GUIDANCE = {
    "PENDING": "Your report is waiting for review. Call 911 if there is immediate danger.",
    "UNDER_REVIEW": "Your report is being reviewed. Stay safe and keep your phone available.",
    "ACTIONED": "For urgent updates, call 911 or your nearest BFP station.",
    "LINKED": "Your report was linked to a related civilian report.",
}


def _ip_hash(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    ip = (
        forwarded_for.split(",", 1)[0].strip()
        if forwarded_for
        else (request.client.host if request.client else "")
    )
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()


def _resolve_nearest(db: Session, wkt: str):
    return db.execute(
        text("""
            SELECT station_id, region_id,
                   ST_Distance(location, ST_GeogFromText(:wkt)) AS distance_m
            FROM wims.ref_fire_stations
            ORDER BY location <-> ST_GeogFromText(:wkt)
            LIMIT 1
        """),
        {"wkt": wkt},
    ).fetchone()


def _trust_score(
    db: Session,
    body: CivilianReportCreate | CivilianReportAppend,
    wkt: str,
    nearest_distance_m: float | None,
) -> int:
    score = 0
    if body.category:
        score += 20
    if body.sub_category:
        score += 15
    if body.reported_at:
        score += 10
    if body.device_id:
        score += 10
    if nearest_distance_m is not None:
        if nearest_distance_m < 500:
            score += 15
        elif nearest_distance_m < 2000:
            score += 10
        elif nearest_distance_m < 5000:
            score += 5
    if body.device_id:
        duplicate = db.execute(
            text("""
                SELECT 1
                FROM wims.citizen_reports
                WHERE device_id = :device_id
                  AND created_at >= now() - interval '30 minutes'
                LIMIT 1
            """),
            {"device_id": body.device_id},
        ).fetchone()
        if not duplicate:
            score += 15
    if body.reporting_context == "WITNESS":
        score += 20
    elif body.reporting_context == "NEARBY":
        score += 10
    if body.gps_distance_m is not None and body.gps_distance_m <= 200:
        score += 10
    cluster = db.execute(
        text("""
            SELECT COUNT(*)
            FROM wims.citizen_reports
            WHERE ST_DWithin(location, ST_GeogFromText(:wkt), 100)
              AND created_at >= now() - interval '1 hour'
        """),
        {"wkt": wkt},
    ).scalar()
    if cluster is not None and int(cluster) >= 3:
        score += 30
    if body.witness_name:
        score += 5
    if body.witness_phone:
        score += 7
    return min(score, 100)


def _require_previous_report(db: Session, previous_report_id: int | None) -> None:
    if previous_report_id is None:
        return
    exists = db.execute(
        text("SELECT 1 FROM wims.citizen_reports WHERE report_id = :rid"),
        {"rid": previous_report_id},
    ).fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail="Previous report not found")


def _response_from_row(row) -> CivilianReportResponse:
    status = row.status
    rejection_guidance = REJECTION_GUIDANCE.get(status)
    guidance = rejection_guidance or STATUS_GUIDANCE.get(status)
    return CivilianReportResponse(
        report_id=row.report_id,
        latitude=float(row.lat),
        longitude=float(row.lon),
        category=row.category,
        sub_category=row.sub_category,
        reporting_context=row.reporting_context,
        safety_status=row.safety_status,
        witness_name=row.witness_name,
        witness_phone=row.witness_phone,
        trust_score=row.trust_score,
        status=status,
        status_explanation=row.status_explanation,
        guidance=guidance,
        escalation_guidance=rejection_guidance,
        related_cluster_status=row.related_cluster_status,
        previous_report_id=row.previous_report_id,
        nearest_station_name=row.nearest_station_name,
        nearest_station_phone=row.nearest_station_phone,
        link_count=row.link_count or 0,
        created_at=row.created_at,
    )


def _fetch_report_response(db: Session, report_id: int) -> CivilianReportResponse:
    row = db.execute(
        text("""
            SELECT cr.report_id,
                   ST_Y(cr.location::geometry) AS lat,
                   ST_X(cr.location::geometry) AS lon,
                   cr.category,
                   cr.sub_category,
                   cr.reporting_context,
                   cr.safety_status,
                   cr.witness_name,
                   cr.witness_phone,
                   cr.trust_score,
                   cr.status,
                   cr.status_explanation,
                   cr.link_count,
                   cr.previous_report_id,
                   cr.created_at,
                   fs.station_name AS nearest_station_name,
                   fs.phone AS nearest_station_phone,
                   cl.status AS related_cluster_status
            FROM wims.citizen_reports cr
            LEFT JOIN wims.ref_fire_stations fs ON fs.station_id = cr.nearest_station_id
            LEFT JOIN wims.citizen_report_cluster_members cm ON cm.report_id = cr.report_id
            LEFT JOIN wims.citizen_report_clusters cl ON cl.cluster_id = cm.cluster_id
            WHERE cr.report_id = :rid
            ORDER BY cl.updated_at DESC NULLS LAST, cl.created_at DESC NULLS LAST
            LIMIT 1
        """),
        {"rid": report_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    return _response_from_row(row)


@router.post("/reports", response_model=CivilianReportResponse, status_code=201)
def submit_civilian_report(
    body: CivilianReportCreate,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> CivilianReportResponse:
    """Public endpoint: submit emergency report with no auth."""
    wkt = f"SRID=4326;POINT({body.longitude} {body.latitude})"
    ip_hash = _ip_hash(request)
    _require_previous_report(db, body.previous_report_id)
    rate_count = db.execute(
        text("""
            SELECT COUNT(*)
            FROM wims.citizen_reports
            WHERE ip_hash = :ip_hash
              AND linked_to_report_id IS NULL
              AND created_at >= now() - interval '1 hour'
        """),
        {"ip_hash": ip_hash},
    ).scalar()
    if rate_count is not None and int(rate_count) >= 5:
        raise HTTPException(
            status_code=429, detail="Too many reports from this network. Try again later."
        )

    nearest = _resolve_nearest(db, wkt)
    nearest_station_id = nearest.station_id if nearest else None
    region_id = nearest.region_id if nearest else None
    nearest_distance_m = (
        float(nearest.distance_m) if nearest and nearest.distance_m is not None else None
    )
    trust_score = _trust_score(db, body, wkt, nearest_distance_m)

    result = db.execute(
        text("""
            INSERT INTO wims.citizen_reports (
                location, category, sub_category, reported_via, reported_at, device_id,
                ip_hash, trust_score, region_id, nearest_station_id, status,
                reporting_context, safety_status, phone_latitude, phone_longitude,
                gps_distance_m, gps_warning_confirmed, witness_name, witness_phone,
                previous_report_id, source_url
            )
            VALUES (
                ST_GeogFromText(:wkt), :category, :sub_category, 'WEB', :reported_at,
                :device_id, :ip_hash, :trust_score, :region_id, :nearest_station_id,
                'PENDING', :reporting_context, :safety_status, :phone_latitude,
                :phone_longitude, :gps_distance_m, :gps_warning_confirmed,
                :witness_name, :witness_phone, :previous_report_id, :source_url
            )
            RETURNING report_id
        """),
        {
            "wkt": wkt,
            "category": body.category,
            "sub_category": body.sub_category,
            "reported_at": body.reported_at,
            "device_id": body.device_id,
            "ip_hash": ip_hash,
            "trust_score": trust_score,
            "region_id": region_id,
            "nearest_station_id": nearest_station_id,
            "reporting_context": body.reporting_context,
            "safety_status": body.safety_status,
            "phone_latitude": body.phone_latitude,
            "phone_longitude": body.phone_longitude,
            "gps_distance_m": body.gps_distance_m,
            "gps_warning_confirmed": body.gps_warning_confirmed,
            "witness_name": body.witness_name,
            "witness_phone": body.witness_phone,
            "previous_report_id": body.previous_report_id,
            "source_url": body.source_url,
        },
    )
    row = result.fetchone()
    db.commit()

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create report")

    return _fetch_report_response(db, row[0])


@router.post("/reports/duplicate-suggestions", response_model=DuplicateSuggestionResponse)
def suggest_duplicate_reports(
    body: CivilianReportCreate,
    db: Annotated[Session, Depends(get_db)],
) -> DuplicateSuggestionResponse:
    """Return nearby active civilian reports as non-blocking duplicate suggestions."""
    if body.safety_status in ("I_NEED_HELP", "SOMEONE_ELSE_NEEDS_HELP"):
        return DuplicateSuggestionResponse(suggestions=[])

    wkt = f"SRID=4326;POINT({body.longitude} {body.latitude})"
    rows = db.execute(
        text("""
            SELECT cr.report_id,
                   ST_Distance(cr.location::geography, ST_GeogFromText(:wkt)::geography) AS distance_m,
                   cr.category,
                   cr.sub_category,
                   cr.safety_status,
                   cr.status,
                   cr.created_at,
                   fs.station_name
            FROM wims.citizen_reports cr
            LEFT JOIN wims.ref_fire_stations fs ON fs.station_id = cr.nearest_station_id
            WHERE cr.status IN ('PENDING', 'UNDER_REVIEW', 'LINKED')
              AND ST_DWithin(cr.location::geography, ST_GeogFromText(:wkt)::geography, 100)
              AND cr.created_at >= now() - interval '1 hour'
            ORDER BY distance_m ASC, cr.created_at DESC
            LIMIT 5
        """),
        {"wkt": wkt},
    ).fetchall()

    return DuplicateSuggestionResponse(
        suggestions=[
            DuplicateSuggestionItem(
                report_id=row.report_id,
                distance_m=float(row.distance_m),
                category=row.category,
                sub_category=row.sub_category,
                safety_status=row.safety_status,
                status=row.status,
                created_at=row.created_at,
                nearest_station_name=row.station_name,
            )
            for row in rows
        ]
    )


@router.patch("/reports/{report_id}/append", response_model=CivilianReportResponse, status_code=201)
def append_civilian_report(
    report_id: int,
    body: CivilianReportAppend,
    db: Annotated[Session, Depends(get_db)],
) -> CivilianReportResponse:
    """Append a child report to an active parent report."""
    parent = db.execute(
        text("SELECT report_id, status FROM wims.citizen_reports WHERE report_id = :rid"),
        {"rid": report_id},
    ).fetchone()
    if not parent:
        raise HTTPException(status_code=404, detail="Report not found")
    if parent.status == "ACTIONED" or str(parent.status).startswith("REJECTED_"):
        raise HTTPException(
            status_code=409,
            detail="Terminal reports cannot be appended. Submit a new report or call 911.",
        )
    recent_append = db.execute(
        text("""
            SELECT 1
            FROM wims.citizen_reports
            WHERE device_id = :device_id
              AND linked_to_report_id IS NOT NULL
              AND created_at >= now() - interval '5 minutes'
            LIMIT 1
        """),
        {"device_id": body.device_id},
    ).fetchone()
    if recent_append:
        raise HTTPException(status_code=429, detail="Please wait before appending another update.")

    wkt = f"SRID=4326;POINT({body.longitude} {body.latitude})"
    nearest = _resolve_nearest(db, wkt)
    nearest_station_id = nearest.station_id if nearest else None
    region_id = nearest.region_id if nearest else None
    nearest_distance_m = (
        float(nearest.distance_m) if nearest and nearest.distance_m is not None else None
    )
    trust_score = _trust_score(db, body, wkt, nearest_distance_m)

    result = db.execute(
        text("""
            INSERT INTO wims.citizen_reports (
                location, category, sub_category, reported_via, reported_at, device_id,
                trust_score, region_id, nearest_station_id, status, linked_to_report_id,
                reporting_context, safety_status, phone_latitude, phone_longitude,
                gps_distance_m, gps_warning_confirmed, witness_name, witness_phone,
                description
            )
            VALUES (
                ST_GeogFromText(:wkt), :category, :sub_category, 'WEB', :reported_at,
                :device_id, :trust_score, :region_id, :nearest_station_id, 'LINKED',
                :linked_to_report_id, :reporting_context, :safety_status,
                :phone_latitude, :phone_longitude, :gps_distance_m,
                :gps_warning_confirmed, :witness_name, :witness_phone,
                :description
            )
            RETURNING report_id
        """),
        {
            "wkt": wkt,
            "category": body.category,
            "sub_category": body.sub_category,
            "reported_at": body.reported_at,
            "device_id": body.device_id,
            "trust_score": trust_score,
            "region_id": region_id,
            "nearest_station_id": nearest_station_id,
            "linked_to_report_id": report_id,
            "reporting_context": body.reporting_context,
            "safety_status": body.safety_status,
            "phone_latitude": body.phone_latitude,
            "phone_longitude": body.phone_longitude,
            "gps_distance_m": body.gps_distance_m,
            "gps_warning_confirmed": body.gps_warning_confirmed,
            "witness_name": body.witness_name,
            "witness_phone": body.witness_phone,
            "description": body.description,
        },
    ).fetchone()
    db.execute(
        text("UPDATE wims.citizen_reports SET link_count = link_count + 1 WHERE report_id = :rid"),
        {"rid": report_id},
    )
    db.commit()
    if not result:
        raise HTTPException(status_code=500, detail="Failed to append report")
    return _fetch_report_response(db, result[0])


@router.get("/reports", response_model=MyReportResponse)
def get_my_reports(
    device_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> MyReportResponse:
    """Fetch all reports submitted by this device. No auth required.

    device_id is passed as a query param — Zero-Trust, so callers must
    supply the actual device UUID. Only returns reports for that device.
    """
    rows = db.execute(
        text("""
            SELECT report_id, category, sub_category, status, safety_status,
                   created_at,
                   ST_Y(location::geometry) AS latitude,
                   ST_X(location::geometry) AS longitude
            FROM wims.citizen_reports
            WHERE device_id = :device_id
            ORDER BY created_at DESC
        """),
        {"device_id": device_id},
    ).fetchall()

    return MyReportResponse(
        reports=[
            MyReportItem(
                report_id=r.report_id,
                category=r.category,
                sub_category=r.sub_category,
                status=r.status,
                safety_status=r.safety_status,
                created_at=r.created_at,
                latitude=r.latitude,
                longitude=r.longitude,
            )
            for r in rows
        ]
    )


@router.get("/reports/{report_id}", response_model=CivilianReportResponse)
def get_civilian_report(
    report_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> CivilianReportResponse:
    """Fetch status of a public report. No auth required."""
    return _fetch_report_response(db, report_id)


@router.get("/reports/{report_id}/timeline", response_model=CivilianReportTimelineResponse)
def get_civilian_report_timeline(
    report_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> CivilianReportTimelineResponse:
    """Fetch parent report plus append children as a public tracking timeline."""
    exists = db.execute(
        text("SELECT 1 FROM wims.citizen_reports WHERE report_id = :rid"),
        {"rid": report_id},
    ).fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail="Report not found")

    rows = db.execute(
        text("""
            SELECT report_id, status, category, sub_category, safety_status,
                   reporting_context, status_explanation, created_at, description
            FROM wims.citizen_reports
            WHERE report_id = :rid OR linked_to_report_id = :rid
            ORDER BY created_at ASC, report_id ASC
        """),
        {"rid": report_id},
    ).fetchall()

    return CivilianReportTimelineResponse(
        report_id=report_id,
        timeline=[
            CivilianReportTimelineItem(
                report_id=row.report_id,
                status=row.status,
                category=row.category,
                sub_category=row.sub_category,
                safety_status=row.safety_status,
                reporting_context=row.reporting_context,
                status_explanation=row.status_explanation,
                created_at=row.created_at,
                description=row.description,
            )
            for row in rows
        ],
    )


@router.post(
    "/reports/{report_id}/notify",
    response_model=NotifyRegisterResponse,
    status_code=201,
)
def register_notification(
    report_id: int,
    body: NotifyRegisterRequest,
    db: Annotated[Session, Depends(get_db)],
) -> NotifyRegisterResponse:
    """Register FCM token for push notifications on report status change. No auth."""
    exists = db.execute(
        text("SELECT 1 FROM wims.citizen_reports WHERE report_id = :rid"),
        {"rid": report_id},
    ).fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail="Report not found")

    result = db.execute(
        text("""
            INSERT INTO wims.report_notification_tokens (report_id, fcm_token)
            VALUES (:rid, :token)
            ON CONFLICT ON CONSTRAINT uq_report_notification_token DO NOTHING
            RETURNING token_id
        """),
        {"rid": report_id, "token": body.fcm_token},
    )
    row = result.fetchone()
    db.commit()

    return NotifyRegisterResponse(
        status="registered" if row else "already_registered",
        report_id=report_id,
    )
