"""Civilian Reporting Phase 2 — public signal records, no auth."""

import hashlib
import json
import logging
import math
import os
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

import redis
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from uuid import UUID

from database import get_db
from services.event_bus import publish_verification_event_sync
from services.kms import get_crypto_provider
from tasks.routing import compute_routing_task
from utils.audit import hash_client_ip, log_system_audit, trusted_client_ip
from utils.crypto import SecurityProviderError
from utils.public_abuse import rate_limit_public
from utils.device_abuse import check_device_abuse
from utils.rate_limit import (
    CIVILIAN_FOLLOWUP_PER_IP_HOURLY_CAP,
    CIVILIAN_FOLLOWUP_PER_REPORT_HOURLY_CAP,
    CIVILIAN_REPORT_HOURLY_CAP,
    CIVILIAN_REPORT_RATE_LIMIT_WINDOW_SECONDS,
    REGISTERED_REPORT_HOURLY_CAP,
    RETRY_AFTER_CEILING_SECONDS,
    RETRY_AFTER_FLOOR_SECONDS,
)

from auth import (
    get_anonymous_session_id,
    get_current_wims_user,
    get_national_validator,
    get_photo_db,
    optional_auth,
)
from schemas.civilian import (
    CivilianFollowupCreate,
    CivilianFollowupResponse,
    CivilianReportAppend,
    CivilianReportCreate,
    CivilianReportResponse,
    CivilianTrackingResponse,
    ContributorDetailResponse,
    ContributorProfileResponse,
    ContributorReportsResponse,
    ContributorStatsResponse,
    DuplicateSuggestionResponse,
    DuplicateSuggestionItem,
    NotifyRegisterRequest,
    NotifyRegisterResponse,
    PendingPhotoUploadResponse,
    PhotoUploadResponse,
    ReportClusterResponse,
    ReportClusterArea,
)
from services.contributor import (
    get_contributor_profile as contributor_profile,
    get_contributor_reports,
    get_contributor_stats as contributor_stats,
)
from services.report_photos import (
    is_terminal_status,
    upload_and_attach_photo,
    upload_pending_photo,
)

logger = logging.getLogger("wims.civilian")

router = APIRouter(prefix="/api/civilian", tags=["civilian"])

logger = logging.getLogger("wims.civilian")

# Module-level Redis client singleton with connection pooling.
# Prevents connection leak from per-request redis.from_url() on this
# public unauthenticated endpoint.
_redis_client: redis.Redis | None = None
_redis_lock = threading.Lock()


def _get_redis() -> redis.Redis:
    """Return the module-level Redis client singleton.

    Uses double-checked locking to avoid a startup race where multiple
    threads could create concurrent connections before the global
    reference is published. Under CPython GIL the window is narrow,
    but the lock eliminates it entirely.
    """
    global _redis_client
    if _redis_client is None:
        with _redis_lock:
            if _redis_client is None:
                _redis_client = redis.from_url(
                    os.environ.get("REDIS_URL", "redis://redis:6379/0"),
                    decode_responses=True,
                    socket_connect_timeout=0.5,
                    socket_timeout=0.5,
                    health_check_interval=30,
                    max_connections=10,
                )
    return _redis_client


def _encrypt_witness_pii(
    db: Session,
    report_id: int,
    witness_name: str | None,
    witness_phone: str | None,
    device_id: str | None,
    ip_hash: str | None,
) -> None:
    """Encrypt witness PII into witness_pii_blob_enc and NULL plaintext columns.

    Idempotent: skips if no PII is present or if blob already exists.
    The AAD binds the ciphertext to ``citizen_report:{report_id}``.
    """
    pii_for_blob = {}
    if witness_name:
        pii_for_blob["witness_name"] = witness_name
    if witness_phone:
        pii_for_blob["witness_phone"] = witness_phone

    if not pii_for_blob:
        return

    try:
        aad = f"citizen_report:{report_id}".encode("utf-8")
        provider = get_crypto_provider()
        nonce_b64, ct_b64 = provider.encrypt_json(pii_for_blob, aad)
    except (SecurityProviderError, Exception) as exc:
        logger.warning(
            "Witness PII encryption unavailable for report_id=%s (%s); falling through",
            report_id,
            exc,
        )
        # Not fail-closed: civilian reports are public submissions and encryption
        # unavailability should not block the report. PII stays in plaintext
        # columns as a fallback.
        return

    enc_iv = nonce_b64 if provider.crypto_provider == "env_aesgcm" else None

    db.execute(
        text("""
            UPDATE wims.citizen_reports SET
                witness_pii_blob_enc   = :blob,
                witness_encryption_iv  = :iv,
                witness_crypto_provider = :crypto_provider,
                witness_key_version    = :key_version,
                witness_name           = NULL,
                witness_phone          = NULL
            WHERE report_id = :rid
              AND witness_pii_blob_enc IS NULL
        """),
        {
            "rid": report_id,
            "blob": ct_b64,
            "iv": enc_iv,
            "crypto_provider": provider.crypto_provider,
            "key_version": provider.current_version,
        },
    )


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
    """Build response, decrypting witness PII blob if present."""
    status = row.status
    rejection_guidance = REJECTION_GUIDANCE.get(status)
    guidance = rejection_guidance or STATUS_GUIDANCE.get(status)

    # ── Decrypt witness PII blob ──────────────────────────────────────────
    witness_name = row.witness_name  # legacy plaintext fallback
    witness_phone = row.witness_phone  # legacy plaintext fallback
    witness_pii_blob_enc = getattr(row, "witness_pii_blob_enc", None)

    if witness_pii_blob_enc:
        try:
            aad = f"citizen_report:{row.report_id}".encode("utf-8")
            provider = get_crypto_provider(
                {"crypto_provider": getattr(row, "witness_crypto_provider", None)}
            )
            decrypted = provider.decrypt_json(
                getattr(row, "witness_encryption_iv", None),
                witness_pii_blob_enc,
                aad,
                getattr(row, "witness_key_version", None) or 1,
            )
            witness_name = decrypted.get("witness_name") or witness_name
            witness_phone = decrypted.get("witness_phone") or witness_phone
        except Exception:
            logger.error(
                "Witness PII blob decryption failed for report_id=%s",
                row.report_id,
                exc_info=True,
            )
            # Fail-closed: PII fields stay as their NULL fallback

    # Derive submitter_type from contributor_user_id (not from request auth)
    submitter_type = "registered" if getattr(row, "contributor_user_id", None) else "anonymous"

    return CivilianReportResponse(
        report_id=row.report_id,
        latitude=float(row.lat),
        longitude=float(row.lon),
        category=row.category,
        sub_category=row.sub_category,
        reporting_context=row.reporting_context,
        safety_status=row.safety_status,
        witness_name=witness_name,
        witness_phone=witness_phone,
        trust_score=row.trust_score,
        status=status,
        status_explanation=row.status_explanation,
        guidance=guidance,
        escalation_guidance=rejection_guidance,
        related_cluster_status=row.related_cluster_status,
        previous_report_id=row.previous_report_id,
        nearest_station_name=row.nearest_station_name,
        nearest_station_phone=row.nearest_station_phone,
        routing_distance_m=getattr(row, "routing_distance_m", None),
        routing_duration_s=getattr(row, "routing_duration_s", None),
        routing_data_source=getattr(row, "routing_data_source", None),
        photo_count=getattr(row, "photo_count", 0) or 0,
        routing_geometry=getattr(row, "routing_geometry", None),
        submitter_type=submitter_type,
        link_count=row.link_count or 0,
        created_at=row.created_at,
    )


def _require_device_ownership(db: Session, report_id: int, device_id: str | None) -> None:
    """Require that a public report object belongs to the provided device token.

    Civilian report routes are intentionally unauthenticated, so the device_id token
    is the object-level authorization boundary. Missing, unknown, and wrong-device
    accesses all return the same neutral 404 shape.
    """
    if not device_id:
        raise HTTPException(status_code=404, detail="Report not found")
    exists = db.execute(
        text("""
            SELECT 1
            FROM wims.citizen_reports
            WHERE report_id = :rid
              AND device_id = :device_id
            LIMIT 1
        """),
        {"rid": report_id, "device_id": device_id},
    ).fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail="Report not found")


def _fetch_report_response(
    db: Session,
    report_id: int,
    device_id: str | None = None,
) -> CivilianReportResponse:
    if device_id is not None:
        _require_device_ownership(db, report_id, device_id)

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
                   cr.contributor_user_id,
                   cr.witness_pii_blob_enc,
                   cr.witness_encryption_iv,
                   cr.witness_crypto_provider,
                   cr.witness_key_version,
                   fs.station_name AS nearest_station_name,
                   fs.phone AS nearest_station_phone,
                   cl.status AS related_cluster_status,
                   cr.routing_distance_m,
                   cr.routing_duration_s,
                   cr.routing_data_source,
                   ST_AsGeoJSON(cr.routing_geometry)::jsonb AS routing_geometry,
                   (SELECT COUNT(*) FROM wims.report_photos rp WHERE rp.report_id = cr.report_id) AS photo_count
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
    return _response_from_row(row)


@router.get("/reports")
def legacy_list_gone():
    """Device-ID public report enumeration is retired in favor of secure tracking links."""
    raise HTTPException(
        status_code=410,
        detail="This legacy tracking endpoint has been retired. Use the secure tracking link.",
    )


@router.post("/reports", response_model=CivilianReportResponse, status_code=201)
async def submit_civilian_report(
    body: CivilianReportCreate,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[dict | None, Depends(optional_auth)] = None,
) -> CivilianReportResponse:
    """Public endpoint: submit emergency report.

    Authenticated CIVILIAN_REPORTER users skip Turnstile and get a
    higher hourly rate limit (20 vs 3). Anonymous submitters must
    pass Turnstile verification.
    """
    wkt = f"SRID=4326;POINT({body.longitude} {body.latitude})"
    # trusted_client_ip reads X-Real-IP (set by nginx to $realip_remote_addr)
    # and falls back to the ASGI socket peer. It NEVER reads X-Forwarded-For,
    # which is client-controlled (gap #14).
    ip_hash = hash_client_ip(trusted_client_ip(request))
    _require_previous_report(db, body.previous_report_id)

    # ── Device abuse escalation (CAPTCHA + rate limit + quarantine) for
    # anonymous submitters — issue #572. Authenticated CIVILIAN_REPORTER
    # users skip this entirely, same as the CAPTCHA-only guard it replaces.
    if user is None:
        await check_device_abuse(request, body.turnstile_token)

    # ── Determine rate-limit cap and contributor identity ─────────────────
    is_registered_reporter = user is not None and user.get("role") == "CIVILIAN_REPORTER"
    rate_limit_cap = (
        REGISTERED_REPORT_HOURLY_CAP if is_registered_reporter else CIVILIAN_REPORT_HOURLY_CAP
    )
    contributor_user_id = user["user_id"] if is_registered_reporter else None

    # ── Early duplicate check for client_report_id ──────────────────
    # If the client provides a client_report_id that already exists in the
    # database, return the existing report immediately WITHOUT consuming the
    # per-IP rate-limit quota. This ensures a lost-response retry succeeds
    # even if the IP has since hit the hourly cap.
    parsed_client_report_id: uuid.UUID | None = None
    if body.client_report_id is not None:
        try:
            parsed_client_report_id = uuid.UUID(str(body.client_report_id))
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=422,
                detail="client_report_id must be a valid UUID",
            )
        if parsed_client_report_id:
            existing = db.execute(
                text("SELECT report_id FROM wims.citizen_reports WHERE client_report_id = :crid"),
                {"crid": parsed_client_report_id},
            ).scalar()
            if existing is not None:
                existing_response = _fetch_report_response(db, int(existing))
                return JSONResponse(
                    content=existing_response.model_dump(mode="json"),
                    status_code=200,
                )

    # PR #446 gap #14 followup (P0-2): take a Postgres transaction-scoped
    # advisory lock keyed on the per-IP hash BEFORE the COUNT(*) rate-limit
    # query. This closes the TOCTOU race: N concurrent requests at the
    # boundary previously all observed count<3 and all INSERTed, exceeding
    # the per-IP cap. pg_advisory_xact_lock auto-releases on commit/rollback,
    # so no explicit unlock is required.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('rl:civilian:' || :ip_hash))"),
        {"ip_hash": ip_hash},
    ).scalar()
    rate_row = db.execute(
        text("""
            SELECT COUNT(*) AS rate_count,
                   MIN(created_at) AS oldest_created_at
            FROM wims.citizen_reports
            WHERE ip_hash = :ip_hash
              AND linked_to_report_id IS NULL
              AND created_at >= now() - interval '1 hour'
        """),
        {"ip_hash": ip_hash},
    ).fetchone()
    if rate_row is not None and int(rate_row.rate_count) >= rate_limit_cap:
        oldest = rate_row.oldest_created_at
        if oldest is not None:
            # PR #446 P1-11: wims.citizen_reports.created_at is TIMESTAMPTZ
            # (see postgres-init/05_citizen_reports.sql — created_at
            # TIMESTAMPTZ DEFAULT now()), so the row returned by SQLAlchemy
            # always has tzinfo set. The defensive
            # ``if oldest.tzinfo is None: oldest = oldest.replace(...)``
            # check is dead code and was removed.
            # Retry-After must be bounded on both sides: lower bound keeps the
            # client from immediately retrying; upper bound keeps a clock-skew
            # or stale row from advising the client to wait longer than the
            # rate-limit window actually is (P1-6).
            retry_after = min(
                RETRY_AFTER_CEILING_SECONDS,
                max(
                    RETRY_AFTER_FLOOR_SECONDS,
                    math.ceil(
                        (
                            oldest
                            + timedelta(seconds=CIVILIAN_REPORT_RATE_LIMIT_WINDOW_SECONDS)
                            - datetime.now(timezone.utc)
                        ).total_seconds()
                    ),
                ),
            )
        else:
            # P1-10: the if-branch should be impossible — if COUNT(*) >=
            # rate_limit_cap then MIN(created_at) cannot be NULL.
            # Assert loudly so a future schema/migration regression fails here
            # instead of silently advising the client to wait 1 hour.
            assert oldest is not None, (
                f"MIN(created_at) is None despite COUNT(*) >= "
                f"{rate_limit_cap}; citizen_reports schema regression"
            )
            retry_after = RETRY_AFTER_CEILING_SECONDS
        _retry_minutes = max(1, math.ceil(retry_after / 60))
        raise HTTPException(
            status_code=429,
            detail=f"Too many reports from this network. Try again in {_retry_minutes} minutes.",
            headers={"Retry-After": str(retry_after)},
        )

    # ── Parse client_report_id for idempotency ───────────────────────────
    nearest = _resolve_nearest(db, wkt)
    nearest_station_id = nearest.station_id if nearest else None
    region_id = nearest.region_id if nearest else None
    nearest_distance_m = (
        float(nearest.distance_m) if nearest and nearest.distance_m is not None else None
    )
    trust_score = _trust_score(db, body, wkt, nearest_distance_m)

    # ── Atomic INSERT with idempotency safety net ────────────────────────
    # The early duplicate check above caught any existing client_report_id.
    # Still use ON CONFLICT DO NOTHING here as a TOCTOU safety net: a
    # concurrent transaction could have inserted after the early SELECT.
    # The RETURNING clause handles both the fresh and the TOCTOU-hit case.
    if parsed_client_report_id:
        result = db.execute(
            text("""
                INSERT INTO wims.citizen_reports (
                    location, category, sub_category, reported_via, reported_at, device_id,
                    ip_hash, trust_score, region_id, nearest_station_id,
                    contributor_user_id, status,
                    reporting_context, safety_status, phone_latitude, phone_longitude,
                    gps_distance_m, gps_warning_confirmed, witness_name, witness_phone,
                    previous_report_id, source_url, client_report_id
                )
                VALUES (
                    ST_GeogFromText(:wkt), :category, :sub_category, 'WEB', :reported_at,
                    :device_id, :ip_hash, :trust_score, :region_id, :nearest_station_id,
                    :contributor_user_id, 'PENDING', :reporting_context, :safety_status, :phone_latitude,
                    :phone_longitude, :gps_distance_m, :gps_warning_confirmed,
                    :witness_name, :witness_phone, :previous_report_id, :source_url,
                    :client_report_id
                )
                ON CONFLICT (client_report_id) WHERE client_report_id IS NOT NULL
                DO NOTHING
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
                "contributor_user_id": contributor_user_id,
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
                "client_report_id": parsed_client_report_id,
            },
        )
        row = result.fetchone()
        if row is None:
            # TOCTOU hit — a concurrent INSERT won the race after the early
            # duplicate SELECT. Fetch the existing report_id (safe RLS for
            # ANONYMOUS) and return 200 as a duplicate response.
            existing = db.execute(
                text("SELECT report_id FROM wims.citizen_reports WHERE client_report_id = :crid"),
                {"crid": parsed_client_report_id},
            ).scalar()
            if existing is None:
                raise HTTPException(status_code=500, detail="Failed to create or find report")
            existing_response = _fetch_report_response(db, int(existing))
            return JSONResponse(
                content=existing_response.model_dump(mode="json"),
                status_code=200,
            )
        report_id = int(row[0])
    else:
        # No client_report_id — standard INSERT without idempotency
        result = db.execute(
            text("""
                INSERT INTO wims.citizen_reports (
                    location, category, sub_category, reported_via, reported_at, device_id,
                    ip_hash, trust_score, region_id, nearest_station_id,
                    contributor_user_id, status,
                    reporting_context, safety_status, phone_latitude, phone_longitude,
                    gps_distance_m, gps_warning_confirmed, witness_name, witness_phone,
                    previous_report_id, source_url
                )
                VALUES (
                    ST_GeogFromText(:wkt), :category, :sub_category, 'WEB', :reported_at,
                    :device_id, :ip_hash, :trust_score, :region_id, :nearest_station_id,
                    :contributor_user_id, 'PENDING', :reporting_context, :safety_status, :phone_latitude,
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
                "contributor_user_id": contributor_user_id,
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

        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create report")

        report_id = int(row[0])

    # ── Device quarantine flag (issue #572) — the submission is never
    # blocked, but a device past the Tier-3 quarantine threshold is routed
    # to mandatory validator review instead of the normal triage path.
    device_quarantined = getattr(request.state, "device_quarantined", False)
    if device_quarantined:
        db.execute(
            text("UPDATE wims.citizen_reports SET requires_review = true WHERE report_id = :rid"),
            {"rid": report_id},
        )

    # ── Encrypt witness PII into blob, NULL out plaintext columns ──────────
    _encrypt_witness_pii(
        db,
        report_id=report_id,
        witness_name=body.witness_name,
        witness_phone=body.witness_phone,
        device_id=body.device_id,
        ip_hash=ip_hash,
    )

    # ---------------------------------------------------------------------------
    # Audit log entry (D20 / issue #394). The INSERT and the audit are kept
    # in a SINGLE transaction so that fail-closed semantics hold: if the
    # audit INSERT raises, the report INSERT is rolled back too and the
    # caller sees a 500 rather than an unaudited civilian record.
    # ---------------------------------------------------------------------------
    try:
        log_system_audit(
            db=db,
            user_id=None,
            action_type="CIVILIAN_REPORT_SUBMIT",
            table_affected="wims.citizen_reports",
            record_id=report_id,
            request=request,
            ip_hash=ip_hash,
            sensitive=True,
        )
        if device_quarantined:
            log_system_audit(
                db=db,
                user_id=None,
                action_type="PUBLIC_QUARANTINED_SUBMISSION",
                table_affected="wims.citizen_reports",
                record_id=report_id,
                request=request,
                ip_hash=ip_hash,
                sensitive=True,
            )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to commit civilian report + audit; rolling back")
        raise HTTPException(
            status_code=500, detail="Failed to record civilian report audit trail"
        ) from exc

    # ── Generate tracking token for public sharing ────────────────────────
    tracking_token = secrets.token_hex(32)
    token_hash = hashlib.sha256(tracking_token.encode("utf-8")).hexdigest()
    try:
        db.execute(
            text("""
                INSERT INTO wims.report_tracking_tokens (report_id, token_hash, token_type)
                VALUES (:rid, :token_hash, 'public')
            """),
            {"rid": report_id, "token_hash": token_hash},
        )
        db.commit()
    except Exception as exc:
        logger.warning("Failed to create tracking token for report_id=%s: %s", report_id, exc)

    # ── Enqueue async routing computation ────────────────────────────────
    try:
        compute_routing_task.delay(report_id)
    except Exception as exc:
        logger.warning("Failed to enqueue routing for report_id=%s: %s", report_id, exc)

    # Notify triage workers (REGIONAL_ENCODER / NATIONAL_VALIDATOR) that a new
    # civilian report is pending review. Fire-and-forget: publish_verification_event_sync
    # already guards its own Redis errors, so publish failures never surface a 500
    # to the anonymous submitter.
    publish_verification_event_sync(
        "civilian.report_submitted",
        report_id=report_id,
        extra={"region_id": region_id},
    )

    response = _fetch_report_response(db, report_id)
    response.tracking_token = tracking_token
    response.tracking_url = f"/tracking/v2/{report_id}/{tracking_token}"
    return response


@router.get(
    "/reports/{report_id}/track/{tracking_token}",
    response_model=CivilianTrackingResponse,
)
def get_civilian_report_by_tracking_token(
    report_id: int,
    tracking_token: str,
    db: Annotated[Session, Depends(get_db)],
) -> CivilianReportResponse:
    """Read-only tracking page API. Validates tracking token and returns
    Tier 1 report data (status, station info, coarse routing, photo count).

    Returns neutral 404 for invalid, expired, revoked, or mismatched tokens.
    """
    token_hash = hashlib.sha256(tracking_token.encode("utf-8")).hexdigest()

    # Use SECURITY DEFINER function to bypass RLS on report_tracking_tokens
    is_valid = db.execute(
        text("SELECT wims.validate_tracking_token(:rid, :token_hash)"),
        {"rid": report_id, "token_hash": token_hash},
    ).scalar()

    if not is_valid:
        # Neutral 404 — do not reveal whether the report exists or the token is wrong
        raise HTTPException(status_code=404, detail="Report not found")

    # Fetch limited Tier 1 report data (no location, PII, internal notes, or chain IDs)
    row = db.execute(
        text("""
            SELECT cr.report_id,
                   cr.category,
                   cr.sub_category,
                   cr.safety_status,
                   cr.status,
                   cr.created_at,
                   cr.routing_distance_m,
                   cr.routing_duration_s,
                   cr.routing_data_source,
                   ST_AsGeoJSON(cr.routing_geometry)::jsonb AS routing_geometry,
                   fs.station_name AS nearest_station_name,
                   fs.phone AS nearest_station_phone,
                   (SELECT COUNT(*) FROM wims.report_photos rp WHERE rp.report_id = cr.report_id) AS photo_count
            FROM wims.citizen_reports cr
            LEFT JOIN wims.ref_fire_stations fs ON fs.station_id = cr.nearest_station_id
            WHERE cr.report_id = :rid
            LIMIT 1
        """),
        {"rid": report_id},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Report not found")

    status_val = row.status
    rejection_guidance = REJECTION_GUIDANCE.get(status_val)
    guidance = rejection_guidance or STATUS_GUIDANCE.get(status_val)

    return CivilianTrackingResponse(
        report_id=row.report_id,
        category=row.category,
        sub_category=row.sub_category,
        safety_status=row.safety_status,
        status=status_val,
        guidance=guidance,
        escalation_guidance=rejection_guidance,
        nearest_station_name=row.nearest_station_name,
        nearest_station_phone=row.nearest_station_phone,
        routing_distance_m=getattr(row, "routing_distance_m", None),
        routing_duration_s=getattr(row, "routing_duration_s", None),
        routing_data_source=getattr(row, "routing_data_source", None),
        routing_geometry=getattr(row, "routing_geometry", None),
        photo_count=getattr(row, "photo_count", 0) or 0,
        created_at=row.created_at,
    )


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
async def append_civilian_report(
    report_id: int,
    body: CivilianReportAppend,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[dict | None, Depends(optional_auth)] = None,
) -> CivilianReportResponse:
    """Append a child report to an active parent report."""
    # ── Device abuse escalation for anonymous submitters (issue #572) ─────
    if user is None:
        await check_device_abuse(request, body.turnstile_token)

    _require_device_ownership(db, report_id, body.device_id)
    parent = db.execute(
        text("SELECT report_id, status FROM wims.citizen_reports WHERE report_id = :rid"),
        {"rid": report_id},
    ).fetchone()
    if is_terminal_status(parent.status):
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

    append_report_id = int(result[0])

    # ── Encrypt witness PII into blob, NULL out plaintext columns ──────────
    _encrypt_witness_pii(
        db,
        report_id=append_report_id,
        witness_name=body.witness_name,
        witness_phone=body.witness_phone,
        device_id=body.device_id,
        ip_hash=None,  # append route does not capture a new ip_hash
    )

    db.execute(
        text("UPDATE wims.citizen_reports SET link_count = link_count + 1 WHERE report_id = :rid"),
        {"rid": report_id},
    )

    # ── Device quarantine flag (issue #572) — same treatment as
    # submit_civilian_report: never blocked, but a device past the Tier-3
    # quarantine threshold is routed to mandatory validator review instead
    # of the normal triage path.
    device_quarantined = getattr(request.state, "device_quarantined", False)
    if device_quarantined:
        db.execute(
            text("UPDATE wims.citizen_reports SET requires_review = true WHERE report_id = :rid"),
            {"rid": append_report_id},
        )
        log_system_audit(
            db=db,
            user_id=None,
            action_type="PUBLIC_QUARANTINED_SUBMISSION",
            table_affected="wims.citizen_reports",
            record_id=append_report_id,
            request=request,
            sensitive=True,
        )

    db.commit()
    if not result:
        raise HTTPException(status_code=500, detail="Failed to append report")
    return _fetch_report_response(db, append_report_id)


@router.post(
    "/reports/{report_id}/followup",
    response_model=CivilianFollowupResponse,
    status_code=201,
)
def submit_civilian_followup(
    report_id: int,
    body: CivilianFollowupCreate,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> CivilianFollowupResponse:
    """Public endpoint: submit text follow-up to an existing report. No auth."""
    _require_device_ownership(db, report_id, body.device_id)
    parent = db.execute(
        text("SELECT report_id, status FROM wims.citizen_reports WHERE report_id = :rid"),
        {"rid": report_id},
    ).fetchone()
    if is_terminal_status(parent.status):
        raise HTTPException(
            status_code=409,
            detail="Terminal reports cannot receive follow-ups. Submit a new report or call 911.",
        )

    # Rate limit: max 5 follow-ups per IP per hour on the same report
    ip_hash = hash_client_ip(trusted_client_ip(request))
    # P0-2 TOCTOU: take a per-IP advisory lock before the count queries so
    # concurrent follow-up submissions cannot all observe count<cap and
    # all INSERT, bypassing the per-IP cap. pg_advisory_xact_lock is
    # transaction-scoped and auto-releases on commit/rollback.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('rl:civilian-followup:' || :ip_hash))"),
        {"ip_hash": ip_hash},
    ).scalar()
    recent_count = db.execute(
        text("""
            SELECT COUNT(*)
            FROM wims.citizen_report_followups
            WHERE report_id = :rid
              AND ip_hash = :ip_hash
              AND created_at >= now() - interval '1 hour'
        """),
        {"rid": report_id, "ip_hash": ip_hash},
    ).scalar()
    # Also check total follow-up rate across all reports from this IP
    ip_recent = db.execute(
        text("""
            SELECT COUNT(*)
            FROM wims.citizen_report_followups
            WHERE ip_hash = :ip_hash
              AND created_at >= now() - interval '1 hour'
        """),
        {"ip_hash": ip_hash},
    ).scalar()
    if recent_count is not None and int(recent_count) >= CIVILIAN_FOLLOWUP_PER_REPORT_HOURLY_CAP:
        raise HTTPException(
            status_code=429,
            detail="Too many follow-ups on this report. Try again later.",
        )
    if ip_recent is not None and int(ip_recent) >= CIVILIAN_FOLLOWUP_PER_IP_HOURLY_CAP:
        raise HTTPException(
            status_code=429,
            detail="Too many follow-ups from this network. Try again later.",
        )

    result = db.execute(
        text("""
            INSERT INTO wims.citizen_report_followups (report_id, followup_text, ip_hash)
            VALUES (:report_id, :followup_text, :ip_hash)
            RETURNING followup_id, report_id, followup_text, created_at
        """),
        {
            "report_id": report_id,
            "followup_text": body.followup_text,
            "ip_hash": ip_hash,
        },
    ).fetchone()
    db.commit()
    if not result:
        raise HTTPException(status_code=500, detail="Failed to save follow-up")

    # Log audit trail entry (no user — civilian submission). Use
    # trusted_client_ip so the audit row's ip_address / ip_hash are anchored
    # to the TCP socket IP, not the client-controlled XFF (gap #14).
    try:
        from utils.audit import log_system_audit

        log_system_audit(
            db=db,
            user_id=None,
            action_type="CIVILIAN_FOLLOWUP",
            table_affected="citizen_report_followups",
            record_id=result[0],
            request=request,
            ip_hash=ip_hash,
        )
        db.commit()
    except Exception:
        logger.warning("Failed to log audit for follow-up %s", result[0], exc_info=True)

    return CivilianFollowupResponse(
        followup_id=result[0],
        report_id=result[1],
        followup_text=result[2],
        created_at=result[3],
    )


@router.post(
    "/photos/upload",
    response_model=PendingPhotoUploadResponse,
    status_code=201,
)
def upload_pending_civilian_photo(
    db: Annotated[Session, Depends(get_photo_db)],
    user: Annotated[dict | None, Depends(optional_auth)],
    anonymous_session_id: Annotated[uuid.UUID | None, Depends(get_anonymous_session_id)],
    file: UploadFile = File(...),
    browser_gps_lat: float | None = Form(default=None),
    browser_gps_lon: float | None = Form(default=None),
    browser_gps_accuracy: float | None = Form(default=None),
    browser_gps_captured_at: datetime | None = Form(default=None),
    exif_gps_lat: float | None = Form(default=None),
    exif_gps_lon: float | None = Form(default=None),
    exif_gps_altitude: float | None = Form(default=None),
    exif_datetime_original: str | None = Form(default=None),
    client_photo_id: str | None = Form(default=None),
) -> PendingPhotoUploadResponse:
    """Create an encrypted pending photo for a registered contributor.

    No report ID or device ID is accepted: pending rows are owned only by the
    authenticated CIVILIAN_REPORTER RLS identity. Anonymous requests remain
    explicitly unavailable until a dedicated capability-bound INSERT helper
    exists, even when a session capability was supplied.
    """
    if exif_gps_lat is not None and not (-90 <= exif_gps_lat <= 90):
        raise HTTPException(status_code=422, detail="exif_gps_lat must be in [-90, 90]")
    if exif_gps_lon is not None and not (-180 <= exif_gps_lon <= 180):
        raise HTTPException(status_code=422, detail="exif_gps_lon must be in [-180, 180]")
    if exif_gps_altitude is not None and not math.isfinite(exif_gps_altitude):
        raise HTTPException(status_code=422, detail="exif_gps_altitude must be a finite float")
    parsed_exif_dt: datetime | None = None
    if exif_datetime_original is not None:
        try:
            parsed_exif_dt = datetime.fromisoformat(exif_datetime_original)
        except (ValueError, TypeError) as exc:
            raise HTTPException(
                status_code=422,
                detail="exif_datetime_original must be a valid ISO 8601 timestamp",
            ) from exc

    parsed_client_photo_id: uuid.UUID | None = None
    if client_photo_id is not None:
        try:
            parsed_client_photo_id = uuid.UUID(client_photo_id)
        except (ValueError, TypeError) as exc:
            raise HTTPException(
                status_code=422,
                detail="client_photo_id must be a valid UUID",
            ) from exc

    return upload_pending_photo(
        db=db,
        file=file,
        registered_user=user,
        anonymous_session_id=anonymous_session_id,
        browser_gps_lat=browser_gps_lat,
        browser_gps_lon=browser_gps_lon,
        browser_gps_accuracy=browser_gps_accuracy,
        browser_gps_captured_at=browser_gps_captured_at,
        exif_gps_lat=exif_gps_lat,
        exif_gps_lon=exif_gps_lon,
        exif_gps_altitude=exif_gps_altitude,
        exif_datetime_original=parsed_exif_dt,
        client_photo_id=parsed_client_photo_id,
    )


@router.post(
    "/reports/{report_id}/photos",
    response_model=PhotoUploadResponse,
    status_code=201,
)
async def upload_report_photo(
    report_id: int,
    db: Annotated[Session, Depends(get_photo_db)],
    user: Annotated[dict | None, Depends(optional_auth)],
    request: Request,
    file: UploadFile = File(...),
    device_id: str | None = Form(default=None),
    turnstile_token: str | None = Form(default=None),
    browser_gps_lat: float | None = Form(default=None),
    browser_gps_lon: float | None = Form(default=None),
    browser_gps_accuracy: float | None = Form(default=None),
    browser_gps_captured_at: datetime | None = Form(default=None),
    exif_gps_lat: float | None = Form(default=None),
    exif_gps_lon: float | None = Form(default=None),
    exif_gps_altitude: float | None = Form(default=None),
    exif_datetime_original: str | None = Form(default=None),
    client_photo_id: str | None = Form(default=None),
) -> PhotoUploadResponse:
    """Upload and attach a photo to an existing civilian report.

    Uses ``optional_auth`` + ``get_photo_db``: registered CIVILIAN_REPORTER
    users get 5 photos / 10 MiB; anonymous users get 1 photo / 5 MiB via
    device_id ownership.

    Session is non-superuser wims_app_user with RLS context set so that
    FORCE ROW LEVEL SECURITY on wims.report_photos is enforced.

    No SQL, crypto, EXIF, filesystem, or business logic here —
    all delegated to ``services.report_photos.upload_and_attach_photo``.
    """
    # ── Device abuse escalation for anonymous submitters (issue #572) ─────
    if user is None:
        await check_device_abuse(request, turnstile_token)

    # Validate EXIF fields if present
    if exif_gps_lat is not None and not (-90 <= exif_gps_lat <= 90):
        raise HTTPException(status_code=422, detail="exif_gps_lat must be in [-90, 90]")
    if exif_gps_lon is not None and not (-180 <= exif_gps_lon <= 180):
        raise HTTPException(status_code=422, detail="exif_gps_lon must be in [-180, 180]")
    if exif_gps_altitude is not None and (not math.isfinite(exif_gps_altitude)):
        raise HTTPException(status_code=422, detail="exif_gps_altitude must be a finite float")
    parsed_exif_dt: datetime | None = None
    if exif_datetime_original is not None:
        try:
            parsed_exif_dt = datetime.fromisoformat(exif_datetime_original)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=422,
                detail="exif_datetime_original must be a valid ISO 8601 timestamp",
            )
    # Validate client_photo_id
    parsed_client_photo_id: uuid.UUID | None = None
    if client_photo_id is not None:
        try:
            parsed_client_photo_id = uuid.UUID(client_photo_id)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=422,
                detail="client_photo_id must be a valid UUID",
            )

    response = upload_and_attach_photo(
        db=db,
        report_id=report_id,
        file=file,
        device_id=device_id,
        browser_gps_lat=browser_gps_lat,
        browser_gps_lon=browser_gps_lon,
        browser_gps_accuracy=browser_gps_accuracy,
        browser_gps_captured_at=browser_gps_captured_at,
        registered_user=user,
        exif_gps_lat=exif_gps_lat,
        exif_gps_lon=exif_gps_lon,
        exif_gps_altitude=exif_gps_altitude,
        exif_datetime_original=parsed_exif_dt,
        client_photo_id=parsed_client_photo_id,
    )

    # ── Device quarantine flag (issue #572) — same treatment as
    # submit_civilian_report/append_civilian_report: never blocked, but a
    # device past the Tier-3 quarantine threshold routes the parent report
    # to mandatory validator review instead of the normal triage path.
    if getattr(request.state, "device_quarantined", False):
        db.execute(
            text("UPDATE wims.citizen_reports SET requires_review = true WHERE report_id = :rid"),
            {"rid": report_id},
        )
        log_system_audit(
            db=db,
            user_id=None,
            action_type="PUBLIC_QUARANTINED_SUBMISSION",
            table_affected="wims.citizen_reports",
            record_id=report_id,
            request=request,
            sensitive=True,
        )
        db.commit()

    return response


@router.post(
    "/reports/{report_id}/notify",
    response_model=NotifyRegisterResponse,
    status_code=201,
)
def register_notification(
    report_id: int,
    body: NotifyRegisterRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> NotifyRegisterResponse:
    """Register FCM token for push notifications on report status change. No auth.

    Rate limited: max 10 FCM tokens per report, max 5 registrations per IP per hour.
    """
    _require_device_ownership(db, report_id, body.device_id)

    # Max FCM tokens per report (limit 10)
    token_count = db.execute(
        text("SELECT COUNT(*) FROM wims.report_notification_tokens WHERE report_id = :rid"),
        {"rid": report_id},
    ).scalar()
    if token_count is not None and int(token_count) >= 10:
        raise HTTPException(
            status_code=429,
            detail="Too many notification registrations for this report",
        )

    # Per-IP token registration cap (5 per IP per hour, Redis fail-closed).
    # Uses trusted_client_ip (X-Real-IP / socket peer only) so the rate-limit
    # key cannot be rotated by spoofing X-Forwarded-For (gap #14).
    client_ip = trusted_client_ip(request)
    rate_limit_public(
        _get_redis(), client_ip, "public_notify", limit=5, window=3600, fail_closed=True
    )

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


# ═══════════════════════════════════════════════════════════════════════════════
# Contributor routes — authenticated (CIVILIAN_REPORTER)
# ═══════════════════════════════════════════════════════════════════════════════


@router.get("/contributor/me", response_model=ContributorProfileResponse)
async def get_contributor_profile_route(
    user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ContributorProfileResponse:
    """Return the authenticated contributor's profile: trust score, badge, lifetime stats."""
    if user.get("role") != "CIVILIAN_REPORTER":
        raise HTTPException(
            status_code=403,
            detail="CIVILIAN_REPORTER role required to access contributor profile",
        )
    profile = contributor_profile(user["user_id"], db)
    return ContributorProfileResponse(**profile)


@router.get("/contributor/reports", response_model=ContributorReportsResponse)
async def get_contributor_reports_route(
    page: int = 1,
    limit: int = 20,
    user: Annotated[dict, Depends(get_current_wims_user)] = None,
    db: Annotated[Session, Depends(get_db)] = None,
) -> ContributorReportsResponse:
    """Return paginated root reports for the authenticated contributor."""
    if user.get("role") != "CIVILIAN_REPORTER":
        raise HTTPException(
            status_code=403,
            detail="CIVILIAN_REPORTER role required to access contributor reports",
        )
    result = get_contributor_reports(user["user_id"], page=page, limit=limit, db=db)
    return ContributorReportsResponse(**result)


@router.get("/contributor/stats", response_model=ContributorStatsResponse)
async def get_contributor_stats_route(
    user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ContributorStatsResponse:
    """Return contributor vanity metrics with monthly report count breakdown."""
    if user.get("role") != "CIVILIAN_REPORTER":
        raise HTTPException(
            status_code=403,
            detail="CIVILIAN_REPORTER role required to access contributor stats",
        )
    stats = contributor_stats(user["user_id"], db)
    return ContributorStatsResponse(**stats)


@router.get("/contributor/leaderboard", status_code=410)
async def leaderboard_removed():
    """The public leaderboard endpoint was removed in the civilian-contributor
    refactor. Return 410 Gone so callers can detect the removal."""
    raise HTTPException(
        status_code=410,
        detail="The contributor leaderboard has been removed",
    )


@router.get("/contributor/{user_id}", response_model=ContributorDetailResponse)
async def get_contributor_profile_by_id(
    user_id: str,
    _validator: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db)],
) -> ContributorDetailResponse:
    """Validator view of an arbitrary contributor's profile + reports.

    Reuses the existing contributor services (which accept any user_id). RBAC is
    enforced server-side via get_national_validator; REGIONAL_VALIDATOR is not a
    live role in this schema, so NATIONAL_VALIDATOR is the gate.
    """
    try:
        target = str(UUID(user_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid user_id UUID")

    profile = contributor_profile(target, db)
    reports = get_contributor_reports(target, page=1, limit=20, db=db)
    return ContributorDetailResponse(
        profile=ContributorProfileResponse(**profile),
        reports=ContributorReportsResponse(**reports),
    )


def _get_count_bucket(count: int) -> str:
    if count < 3:
        raise ValueError(f"unexpected cluster report count {count} (min 3 required)")
    if count < 5:
        return "3-4"
    elif count < 10:
        return "5-9"
    elif count < 20:
        return "10-19"
    return "20+"


def _get_age_bucket(delta_seconds: float) -> str:
    if delta_seconds < 15 * 60:
        return "0-15 min"
    elif delta_seconds < 30 * 60:
        return "15-30 min"
    return "30-60 min"


def _bucket_center_500m(lat: float, lon: float) -> tuple[float, float, str]:
    """Return approximate 500m grid center for cache key and local query."""
    lat_step = 500 / 111_320
    lon_step = 500 / (111_320 * max(math.cos(math.radians(lat)), 0.01))
    lat_index = math.floor(lat / lat_step)
    lon_index = math.floor(lon / lon_step)
    center_lat = (lat_index + 0.5) * lat_step
    center_lon = (lon_index + 0.5) * lon_step
    return center_lat, center_lon, f"{lat_index}:{lon_index}"


def _area_id(cluster_id: int, newest_iso: str | None) -> str:
    token = f"{cluster_id}:{newest_iso or ''}".encode("utf-8")
    return hashlib.sha256(token).hexdigest()[:16]


@router.get(
    "/report-clusters",
    response_model=ReportClusterResponse,
    summary="Get recent report clusters (heat map areas)",
)
def get_report_clusters(
    lat: float | None = None,
    lon: float | None = None,
    db: Session = Depends(get_db),
):
    """
    Local mode: lat/lon provided. Returns up to 50 clusters within 10km, min 3 reports.
    National mode: no lat/lon. Returns up to 25 clusters nationwide from last 1 hour, min 10 reports.
    """
    redis_client = None
    center = None
    radius_m: int | None = None
    if lat is not None and lon is not None:
        mode = "local"
        min_reports = 3
        max_results = 50
        radius_m = 10_000
        center_lat, center_lon, bucket_id = _bucket_center_500m(lat, lon)
        center = {"latitude": center_lat, "longitude": center_lon}
        local_having = (
            "AND ST_DWithin(ST_SetSRID(centroid, 4326)::geography, "
            "ST_SetSRID(ST_MakePoint(:center_lon, :center_lat), 4326)::geography, :radius_m)"
        )
        params = {
            "center_lat": center_lat,
            "center_lon": center_lon,
            "radius_m": radius_m,
            "min_reports": min_reports,
            "limit": max_results + 1,
        }
        cache_key = f"wims:civilian:report-clusters:v1:local:{bucket_id}:r10000:w60:min3"
    else:
        mode = "national"
        min_reports = 10
        max_results = 25
        local_having = ""
        params = {"min_reports": min_reports, "limit": max_results + 1}
        cache_key = "wims:civilian:report-clusters:v1:national:w60:min10"

    try:
        redis_client = _get_redis()
        fresh = redis_client.get(cache_key)
        if fresh:
            data = json.loads(fresh)
            return ReportClusterResponse(**data)
    except Exception:
        logger.warning(
            "Redis cache fresh-read failed for report-clusters key=%s", cache_key, exc_info=True
        )

    try:
        sql = f"""
            WITH member_reports AS (
                SELECT
                    c.cluster_id,
                    cr.report_id,
                    cr.location,
                    cr.status,
                    cr.created_at
                FROM wims.citizen_report_clusters c
                JOIN wims.citizen_report_cluster_members cm ON cm.cluster_id = c.cluster_id
                JOIN wims.citizen_reports cr ON cr.report_id = cm.report_id
                WHERE c.status IN ('CLUSTER_MONITORING', 'CLUSTER_UNDER_REVIEW')
                  AND c.merged_into_cluster_id IS NULL
                  AND cr.status IN ('PENDING', 'UNDER_REVIEW', 'LINKED')
                  AND cr.created_at >= NOW() - INTERVAL '1 hour'
            ),
            grouped AS (
                SELECT
                    cluster_id,
                    ST_Centroid(ST_Collect(location::geometry)) AS centroid,
                    COUNT(*) AS total_reports,
                    SUM(CASE WHEN status IN ('PENDING', 'UNDER_REVIEW') THEN 1 ELSE 0 END) AS active_reports,
                    MAX(created_at) AS newest_report_at
                FROM member_reports
                GROUP BY cluster_id
            ),
            with_radius AS (
                SELECT
                    g.cluster_id,
                    g.centroid,
                    g.total_reports,
                    g.active_reports,
                    g.newest_report_at,
                    MAX(ST_Distance(m.location::geography, ST_SetSRID(g.centroid, 4326)::geography)) AS spread_m
                FROM grouped g
                JOIN member_reports m ON m.cluster_id = g.cluster_id
                GROUP BY g.cluster_id, g.centroid, g.total_reports, g.active_reports, g.newest_report_at
            )
            SELECT
                cluster_id,
                ST_Y(centroid) AS center_lat,
                ST_X(centroid) AS center_lon,
                total_reports,
                EXTRACT(EPOCH FROM (NOW() - newest_report_at)) AS age_seconds,
                newest_report_at,
                GREATEST(100, LEAST(1000, CEIL(COALESCE(spread_m, 0) / 100.0) * 100))::int AS public_radius_m
            FROM with_radius
            WHERE active_reports > 0
              AND total_reports >= :min_reports
              {local_having}
            ORDER BY total_reports DESC, newest_report_at DESC
            LIMIT :limit
        """

        rows = db.execute(text(sql), params).fetchall()
        truncated = len(rows) > max_results
        rows = rows[:max_results]

        areas = []
        for row in rows:
            areas.append(
                ReportClusterArea(
                    area_id=_area_id(
                        int(row.cluster_id),
                        row.newest_report_at.isoformat() if row.newest_report_at else None,
                    ),
                    latitude=row.center_lat,
                    longitude=row.center_lon,
                    radius_m=int(row.public_radius_m),
                    count_bucket=_get_count_bucket(row.total_reports),
                    age_bucket=_get_age_bucket(row.age_seconds),
                )
            )

        resp = ReportClusterResponse(
            mode=mode,
            center=center,
            radius_m=radius_m,
            min_reports=min_reports,
            truncated=truncated,
            areas=areas,
        )

        try:
            if redis_client:
                dumped = resp.model_dump_json()
                redis_client.setex(cache_key, 60, dumped)
                redis_client.setex(f"{cache_key}:stale", 600, dumped)
        except Exception:
            logger.warning(
                "Redis cache write failed for report-clusters key=%s", cache_key, exc_info=True
            )

        return resp

    except Exception:
        logger.warning("report-clusters DB query failed", exc_info=True)
        try:
            stale = redis_client.get(f"{cache_key}:stale") if redis_client else None
            if stale:
                data = json.loads(stale)
                data["stale"] = True
                return ReportClusterResponse(**data)
        except Exception:
            logger.warning(
                "Stale cache read failed for report-clusters key=%s:stale", cache_key, exc_info=True
            )

        return ReportClusterResponse(
            mode=mode,
            center=center,
            radius_m=radius_m,
            min_reports=min_reports,
            areas=[],
            degraded=True,
        )
