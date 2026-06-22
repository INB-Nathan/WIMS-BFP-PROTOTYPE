"""Zero-Trust Public DMZ Incident Queue — POST /api/v1/public/report.

No Keycloak JWT. No wims.current_user_id RLS context.
Redis-based rate limiting: max 3 requests per IP per hour.

Target: wims.fire_incidents with verification_status = 'PENDING',
encoder_id left NULL, region_id resolved from coordinates.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Annotated

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from schemas.public_incident import PublicIncidentCreate, PublicIncidentResponse
from utils.audit import trusted_client_ip, log_system_audit, hash_client_ip
from utils.rate_limit import (
    PUBLIC_REPORT_HOURLY_CAP,
    PUBLIC_REPORT_RATE_LIMIT_WINDOW_SECONDS,
    RETRY_AFTER_CEILING_SECONDS,
    RETRY_AFTER_FLOOR_SECONDS,
)

router = APIRouter(prefix="/api/v1/public", tags=["public-dmz"])

logger = logging.getLogger("wims.public_dmz")

# ---------------------------------------------------------------------------
# Redis Rate Limiter — 3 req/IP/hour (stricter than the auth callback limiter)
# ---------------------------------------------------------------------------
# Window and cap come from utils.rate_limit (single source of truth) so the
# threshold drop 5 → 3 (PR #446) and the Retry-After bounds cannot drift
# between the Lua script and the Python-side constants.
_PUBLIC_RATE_LIMIT_WINDOW = PUBLIC_REPORT_RATE_LIMIT_WINDOW_SECONDS
_PUBLIC_RATE_LIMIT_THRESHOLD = PUBLIC_REPORT_HOURLY_CAP
_REDIS_EMERGENCY_TTL = 3600

_REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")


async def _get_redis():
    """
    Return a request-scoped async Redis client.

    Each call creates a fresh ConnectionPool to avoid cross-event-loop
    failures when the rate limiter is called from different asyncio event
    loops (e.g. FastAPI TestClient creates a new loop per request).
    Caching the pool globally would bind it to the first request's event
    loop, causing RuntimeError on subsequent requests in different loops.

    The caller closes the client/pool after the rate-limit script runs so
    per-request pools do not accumulate idle sockets.
    """
    try:
        pool = aioredis.ConnectionPool.from_url(
            _REDIS_URL,
            decode_responses=True,
            max_connections=5,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
            health_check_interval=30,
        )
        return aioredis.Redis(connection_pool=pool)
    except Exception:
        logger.warning(
            "Redis connection failed at %s — rate limiting disabled for this request",
            _REDIS_URL,
        )
        return None


async def rate_limit_public_dmz(request: Request) -> None:
    """
    FastAPI dependency that enforces 3 req/IP/hour on /api/v1/public/*.

    Redis key : public_rate_limit:{client_ip}
    Algorithm: sliding-window sorted set (atomic Lua script)

    Raises HTTPException 429 if limit exceeded.
    Redis failures are fail-closed per D6 (public abuse surface).
    """
    # Read from X-Real-IP, which nginx sets to $realip_remote_addr (the actual
    # TCP socket address before real-IP-module processing).  This cannot be
    # spoofed by the client because nginx always overwrites the header with the
    # socket-level IP.  X-Forwarded-For is NOT used here: the real-IP module
    # rewrites $remote_addr from the client-controlled XFF chain, so reading
    # XFF would let an attacker rotate the rate-limit key with fake IPs.
    client_ip = trusted_client_ip(request)

    key = f"public_rate_limit:{client_ip}"
    now = time.time()

    r = await _get_redis()
    if r is None:
        return

    try:
        lua_script = (
            """
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local window = tonumber(ARGV[2])
        local limit = tonumber(ARGV[3])

        -- Remove entries older than the window
        redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

        -- Count entries in the current window
        local count = redis.call('ZCARD', key)

        if count >= limit then
            -- Get oldest entry's expiry as Retry-After. Bounded on both
            -- sides: floor keeps the client from immediately retrying;
            -- ceiling (P1-6) keeps a clock-skew or stale entry from
            -- advising the client to wait longer than the actual window.
            local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
            local retry_after = """
            + str(RETRY_AFTER_FLOOR_SECONDS)
            + """
            if oldest and #oldest >= 2 then
                retry_after = math.ceil(window - (now - tonumber(oldest[2])))
                if retry_after < """
            + str(RETRY_AFTER_FLOOR_SECONDS)
            + """ then
                    retry_after = """
            + str(RETRY_AFTER_FLOOR_SECONDS)
            + """
                end
                if retry_after > """
            + str(RETRY_AFTER_CEILING_SECONDS)
            + """ then
                    retry_after = """
            + str(RETRY_AFTER_CEILING_SECONDS)
            + """
                end
            end
            return {1, retry_after}
        end

        -- Add current request timestamp
        redis.call('ZADD', key, now, now .. '-' .. math.random())
        redis.call('EXPIRE', key, window)

        return {0, 0}
        """
        )
        result = await r.eval(
            lua_script,
            1,
            key,
            str(now),
            str(_PUBLIC_RATE_LIMIT_WINDOW),
            str(_PUBLIC_RATE_LIMIT_THRESHOLD),
        )
        blocked, retry_after = int(result[0]), int(result[1])
        if blocked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Max {_PUBLIC_RATE_LIMIT_THRESHOLD} submissions per hour per IP.",
                headers={"Retry-After": str(retry_after)},
            )
    except HTTPException:
        raise
    except Exception:
        logger.error("Redis eval failed for key=%s — fail-closed: denying request", key)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable — rate limiter unreachable",
        )
    finally:
        try:
            await r.aclose(close_connection_pool=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# POST /api/v1/public/report
# ---------------------------------------------------------------------------
@router.post(
    "/report",
    response_model=PublicIncidentResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_public_dmz)],
)
def submit_public_incident(
    body: PublicIncidentCreate,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> PublicIncidentResponse:
    """
    Public, no-auth endpoint for CIVILIAN_REPORTER to submit fire incidents.

    Security properties:
    - NO Keycloak JWT — no auth header required
    - NO wims.current_user_id RLS context set (encoder_id = NULL)
    - Redis rate limiting: 3 submissions per IP per hour
    - verification_status = 'PENDING_VALIDATION' (awaiting NATIONAL_VALIDATOR review)
    - region_id resolved via nearest ref_fire_stations (location <-> wkt) — ref_regions has no PostGIS geometry
    - import_batch_id = NULL (no batch association)
    """
    wkt = f"SRID=4326;POINT({body.longitude} {body.latitude})"

    # ---------------------------------------------------------------------------
    # Step 1: Resolve region_id via nearest fire station (civilian.py pattern).
    # ref_fire_stations.location is GEOGRAPHY(POINT,4326); ref_regions has no
    # geometry.  ORDER BY location <-> finds the physically nearest station.
    # ---------------------------------------------------------------------------
    station_row = db.execute(
        text("""
            SELECT region_id
            FROM wims.ref_fire_stations
            ORDER BY location <-> ST_GeogFromText(:wkt)
            LIMIT 1
        """),
        {"wkt": wkt},
    ).fetchone()

    region_id = station_row.region_id if station_row else None

    if region_id is None:
        # SECURITY DEFINER helper bypasses ref_regions RLS — no user GUC
        # is set in this unauthenticated path, so direct SELECT would
        # return zero rows under M15 region-scoped policies.
        row = db.execute(text("SELECT wims.get_first_region_id()")).fetchone()
        region_id = row[0] if row else None

    if region_id is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No region reference data found — cannot route public incident",
        )

    # ---------------------------------------------------------------------------
    # Step 2: Insert into fire_incidents — encoder_id intentionally NULL.
    # The INSERT and the audit row below share a single transaction so that
    # fail-closed semantics hold (D20 / issue #394): if the audit INSERT
    # raises, the fire_incidents row is rolled back and the caller sees 500.
    # ---------------------------------------------------------------------------
    result = db.execute(
        text("""
            INSERT INTO wims.fire_incidents
                (location, region_id, verification_status, encoder_id, import_batch_id)
            VALUES
                (ST_GeogFromText(:wkt), :region_id, 'PENDING_VALIDATION', NULL, NULL)
            RETURNING incident_id, verification_status, created_at
        """),
        {"wkt": wkt, "region_id": region_id},
    )
    row = result.fetchone()

    if row is None:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to insert public incident",
        )

    incident_id, verification_status, created_at = row

    # ---------------------------------------------------------------------------
    # Step 2.5: Audit log entry (D20 / issue #394).
    # No authenticated user — the public DMZ has no encoder_id. sensitive=True
    # means: if the audit INSERT fails, the fire_incidents row above is rolled
    # back and the caller sees a 500. The IP is salted-hashed, not stored raw.
    # ---------------------------------------------------------------------------
    ip_hash_value = hash_client_ip(trusted_client_ip(request))
    try:
        log_system_audit(
            db=db,
            user_id=None,
            action_type="PUBLIC_INCIDENT_SUBMIT",
            table_affected="wims.fire_incidents",
            record_id=incident_id,
            request=request,
            ip_hash=ip_hash_value,
            sensitive=True,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to commit public incident + audit; rolling back")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record public incident audit trail",
        ) from exc

    # ---------------------------------------------------------------------------
    # Step 3: Extract coordinates back from PostGIS for the response.
    # ---------------------------------------------------------------------------
    coord_row = db.execute(
        text("""
            SELECT ST_Y(location::geometry), ST_X(location::geometry)
            FROM wims.fire_incidents
            WHERE incident_id = :id
        """),
        {"id": incident_id},
    ).fetchone()

    if coord_row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve inserted incident coordinates",
        )

    lat = float(coord_row[0])
    lon = float(coord_row[1])

    return PublicIncidentResponse(
        incident_id=incident_id,
        latitude=lat,
        longitude=lon,
        verification_status=verification_status,
        created_at=created_at,
    )
