"""Backend proxy for Nominatim geocoding.

All geocode requests are routed through this endpoint so that fire incident
coordinates and address data never leave the server to a third-party service.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from utils.external_service import (
    CircuitBreakerOpenError,
    ConcurrencyLimitError,
    ExternalServiceClient,
    ExternalServiceError,
    ResponseSizeExceededError,
)

router = APIRouter(prefix="/api/geocode", tags=["geocode"])
logger = logging.getLogger("wims.geocode")

_NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
_HEADERS = {
    "User-Agent": "WIMS-BFP/1.0 (Bureau of Fire Protection incident management)",
    "Accept-Language": "en",
    "Accept": "application/json",
}
_TIMEOUT = 10.0

# Shared resilient wrapper for Nominatim — gains retry, circuit breaker, size cap,
# and concurrency cap (none of which the old bare httpx.AsyncClient had).
_nominatim_client = ExternalServiceClient(
    service_name="nominatim",
    timeout=_TIMEOUT,
    max_retries=2,
    base_delay=1.0,
    response_size_limit=5 * 1024 * 1024,  # 5 MB
    concurrency_limit=10,
    cb_failure_threshold=5,
    cb_recovery_timeout=30.0,
)


@router.get("/reverse")
async def reverse_geocode(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
):
    """Reverse-geocode a coordinate pair via Nominatim (server-side proxy)."""
    try:
        resp = await _nominatim_client.request_async(
            "GET",
            f"{_NOMINATIM_BASE}/reverse",
            params={"lat": lat, "lon": lon, "format": "json", "addressdetails": 1, "zoom": 18},
            headers=_HEADERS,
        )
        resp.raise_for_status()
        return JSONResponse(content=resp.json())
    except CircuitBreakerOpenError:
        logger.warning("Nominatim circuit breaker open")
        raise HTTPException(status_code=503, detail="Geocode service temporarily unavailable")
    except ConcurrencyLimitError:
        logger.warning("Nominatim concurrency limit reached")
        raise HTTPException(status_code=503, detail="Geocode service is busy, try again later")
    except ResponseSizeExceededError:
        logger.warning("Nominatim response too large lat=%s lon=%s", lat, lon)
        raise HTTPException(status_code=502, detail="Geocode service returned oversized response")
    except ExternalServiceError as exc:
        logger.warning("Nominatim reverse geocode error: %s", exc)
        raise HTTPException(status_code=502, detail="Geocode service error")


@router.get("/search")
async def search_geocode(
    q: str = Query(..., description="Search query"),
    limit: int = Query(5, ge=1, le=10, description="Max results"),
    addressdetails: int = Query(1, description="Include address breakdown"),
):
    """Forward-geocode an address string via Nominatim (server-side proxy)."""
    try:
        resp = await _nominatim_client.request_async(
            "GET",
            f"{_NOMINATIM_BASE}/search",
            params={
                "q": q,
                "format": "json",
                "countrycodes": "ph",
                "limit": limit,
                "addressdetails": addressdetails,
            },
            headers=_HEADERS,
        )
        resp.raise_for_status()
        return JSONResponse(content=resp.json())
    except CircuitBreakerOpenError:
        logger.warning("Nominatim circuit breaker open")
        raise HTTPException(status_code=503, detail="Geocode service temporarily unavailable")
    except ConcurrencyLimitError:
        logger.warning("Nominatim concurrency limit reached")
        raise HTTPException(status_code=503, detail="Geocode service is busy, try again later")
    except ResponseSizeExceededError:
        logger.warning("Nominatim response too large q=%r", q)
        raise HTTPException(status_code=502, detail="Geocode service returned oversized response")
    except ExternalServiceError as exc:
        logger.warning("Nominatim search error: %s", exc)
        raise HTTPException(status_code=502, detail="Geocode service error")
