"""Backend proxy for Nominatim geocoding.

All geocode requests are routed through this endpoint so that fire incident
coordinates and address data never leave the server to a third-party service.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/geocode", tags=["geocode"])
logger = logging.getLogger("wims.geocode")

_NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
_HEADERS = {
    "User-Agent": "WIMS-BFP/1.0 (Bureau of Fire Protection incident management)",
    "Accept-Language": "en",
    "Accept": "application/json",
}
_TIMEOUT = 10.0


@router.get("/reverse")
async def reverse_geocode(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
):
    """Reverse-geocode a coordinate pair via Nominatim (server-side proxy)."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{_NOMINATIM_BASE}/reverse",
                params={"lat": lat, "lon": lon, "format": "json", "addressdetails": 1, "zoom": 18},
                headers=_HEADERS,
            )
            resp.raise_for_status()
            return JSONResponse(content=resp.json())
    except httpx.TimeoutException:
        logger.warning("Nominatim reverse geocode timed out lat=%s lon=%s", lat, lon)
        raise HTTPException(status_code=504, detail="Geocode service timed out")
    except httpx.HTTPStatusError as exc:
        logger.warning("Nominatim reverse geocode error: %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail="Geocode service error")


@router.get("/search")
async def search_geocode(
    q: str = Query(..., description="Search query"),
    limit: int = Query(5, ge=1, le=10, description="Max results"),
    addressdetails: int = Query(1, description="Include address breakdown"),
):
    """Forward-geocode an address string via Nominatim (server-side proxy)."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
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
    except httpx.TimeoutException:
        logger.warning("Nominatim search timed out q=%r", q)
        raise HTTPException(status_code=504, detail="Geocode service timed out")
    except httpx.HTTPStatusError as exc:
        logger.warning("Nominatim search error: %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail="Geocode service error")
