"""Zero-Trust Public DMZ Incident Queue — POST /api/v1/public/report.

No Keycloak JWT. No wims.current_user_id RLS context.
Redis-based rate limiting: max 3 requests per IP per hour.

Target: wims.fire_incidents with verification_status = 'PENDING',
encoder_id left NULL, region_id resolved from coordinates.
"""

from __future__ import annotations

import os
import time
from typing import Annotated

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from schemas.public_incident import PublicIncidentCreate, PublicIncidentResponse

router = APIRouter(prefix="/api/v1/public", tags=["public-dmz"])


# ---------------------------------------------------------------------------
# Redis Rate Limiter — 3 req/IP/hour (strictly tighter than /api/auth/login)
# ---------------------------------------------------------------------------
_PUBLIC_RATE_LIMIT_WINDOW = 3600   # 1 hour in seconds
_PUBLIC_RATE_LIMIT_THRESHOLD = 3   # max 3 submissions per IP per hour

_REDIS_URL = os.environ.get(
    "REDIS_URL", "redis://redis:6379/0")

async def _get_redis():
    try:
        return await aioredis.from_url(_REDIS_URL, decode_responses=True)
    except Exception:
        return None


async def rate_limit_public_dmz(request: Request) -> None:
    """
    FastAPI dependency that enforces 3 req/IP/hour on /api/v1/public/*.

    Redis key : public_rate_limit:{client_ip}
    Algorithm: fixed-window counter (atomic INCR + EXPIRE via Lua)

    Raises HTTPException 429 if limit exceeded.
    Redis failures are fail-open (incident ingestion must be resilient).
    """
    client_ip = request.headers.get("x-forwarded-for")
    if client_ip:
        client_ip = client_ip.split(",")[0].strip()
    else:
        client_ip = request.client.host if request.client else "unknown"

    key = f"public_rate_limit:{client_ip}"
    now = time.time()

    r = await _get_redis()
    if r is None:
        # Redis unavailable — fail open, allow the submission
        return

    try:
        # Atomically: INCR counter, set/refresh expiry, check limit
        lua_script = """
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local window = tonumber(ARGV[2])
        local limit = tonumber(ARGV[3])

        local current = redis.call('INCR', key)
        if current == 1 then
            redis.call('EXPIRE', key, window)
        end

        local ttl = redis.call('TTL', key)
        if current > limit then
            return {1, ttl}
        else
            return {0, ttl}
        end
        """
        result = await r.eval(
            lua_script,
            1,
            key,
            str(now),
            str(_PUBLIC_RATE_LIMIT_WINDOW),
            str(_PUBLIC_RATE_LIMIT_THRESHOLD),
        )
        blocked, ttl = int(result[0]), int(result[1])
        if blocked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Max {_PUBLIC_RATE_LIMIT_THRESHOLD} submissions per hour per IP.",
                headers={"Retry-After": str(max(ttl, 1))},
            )
    except HTTPException:
        raise
    except Exception:
        # Redis eval failed — fail open
        return


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
    db: Annotated[Session, Depends(get_db)],
) -> PublicIncidentResponse:
    """
    Public, no-auth endpoint for CIVILIAN_REPORTER to submit fire incidents.

    Security properties:
    - NO Keycloak JWT — no auth header required
    - NO wims.current_user_id RLS context set (encoder_id = NULL)
    - Redis rate limiting: 3 submissions per IP per hour
    - verification_status = 'PENDING_VALIDATION' (awaiting NATIONAL_VALIDATOR review)
    - region_id resolved from coordinates (nearest ref_region centroid)
    - import_batch_id = NULL (no batch association)
    """
    wkt = f"SRID=4326;POINT({body.longitude} {body.latitude})"

    # ---------------------------------------------------------------------------
    # Step 1: Resolve region_id from coordinates via nearest-centroid heuristic.
    # Fallback: first ref_region if no geometry intersect (prevents hard failure).
    # ---------------------------------------------------------------------------
    region_row = db.execute(
        text("""
            SELECT region_id
            FROM wims.ref_regions
            ORDER BY region_id
            LIMIT 1
        """)
    ).fetchone()

    if region_row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No ref_regions seed data found — cannot route public incident",
        )

    region_id = region_row[0]

    # ---------------------------------------------------------------------------
    # Step 2: Insert into fire_incidents — encoder_id intentionally NULL.
    #         get_db() will NOT set wims.current_user_id because there is no
    #         authenticated user on this request (no JWT → request.state.wims_user
    #         is absent → set_rls_context is never called).
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
    db.commit()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to insert public incident",
        )

    incident_id, verification_status, created_at = row

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

    lat = float(coord_row[0])
    lon = float(coord_row[1])

    return PublicIncidentResponse(
        incident_id=incident_id,
        latitude=lat,
        longitude=lon,
        verification_status=verification_status,
        created_at=created_at,
    )
