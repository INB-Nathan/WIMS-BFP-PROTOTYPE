"""Server-Sent Events (SSE) streaming endpoint.

GET /api/events/stream?channels=incident,verification

Requires valid access_token cookie (same auth as all API routes).
Subscribes to Redis pub/sub channels and streams real-time events to the
client as SSE text/event-stream messages.

Channel authorization:
  incident     — internal WIMS roles (excludes CIVILIAN_REPORTER)
  verification — REGIONAL_ENCODER, NATIONAL_VALIDATOR
  security     — SYSTEM_ADMIN
  system       — SYSTEM_ADMIN

The client reconnects automatically via EventSource API; each connection
is authenticated independently via the cookie.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from auth import get_current_user, resolve_wims_role_from_token
from services.event_bus import CHANNELS, get_event_bus

logger = logging.getLogger("wims.events")

router = APIRouter(prefix="/api/events", tags=["events"])

# Resolve role from token (canonical source: auth.resolve_wims_role_from_token)
_resolve_role_from_token = resolve_wims_role_from_token

# Channels that each role is permitted to subscribe to
_ROLE_CHANNEL_MAP: dict[str, frozenset[str]] = {
    "REGIONAL_ENCODER": frozenset({"incident", "verification"}),
    "NATIONAL_VALIDATOR": frozenset({"incident", "verification"}),
    "NATIONAL_ANALYST": frozenset({"incident"}),
    "SYSTEM_ADMIN": frozenset({"incident", "verification", "security", "system"}),
}


def _resolve_channels(raw: str | None, role: str) -> list[str]:
    """Parse comma-separated channel names and enforce role authorization.

    Returns the list of Redis channel names (wims:events:*).
    If raw is empty, defaults to all channels the role is authorized for.
    """
    allowed = _ROLE_CHANNEL_MAP.get(role, frozenset())
    if not raw:
        requested = list(allowed)
    else:
        requested = [c.strip().lower() for c in raw.split(",") if c.strip()]
        for channel in requested:
            if channel not in CHANNELS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown channel: '{channel}'. Valid channels: {', '.join(CHANNELS)}",
                )
            if channel not in allowed:
                raise HTTPException(
                    status_code=403,
                    detail=f"Role '{role}' is not authorized for channel '{channel}'",
                )

    return [CHANNELS[c] for c in requested]


@router.get("/stream")
async def event_stream(
    request: Request,
    channels: Annotated[str | None, Query(description="Comma-separated channel names: incident,verification,security,system")] = None,
):
    """SSE streaming endpoint.

    Authenticates via access_token cookie, then subscribes to Redis pub/sub
    and streams events to the client as SSE.

    The client should use EventSource with withCredentials: true.
    Reconnection is handled automatically by the browser.
    """
    # --- Authenticate ---
    try:
        token_payload = await get_current_user(request)
        role = _resolve_role_from_token(token_payload)
        if not role:
            raise HTTPException(status_code=403, detail="No WIMS role in token")
        user_id = token_payload.get("sub", "unknown")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("SSE auth failed: %s", exc)
        raise HTTPException(status_code=401, detail="Authentication failed")

    # --- Resolve channels ---
    redis_channels = _resolve_channels(channels, role)

    if not redis_channels:
        raise HTTPException(status_code=400, detail="No channels available for your role")

    logger.info("SSE stream opened: user=%s role=%s channels=%s", user_id[:8], role, redis_channels)

    # --- Stream events ---
    async def event_generator():
        bus = await get_event_bus()
        try:
            async for event in bus.subscribe(redis_channels):
                event_type = event.get("event_type", "message")
                data = json.dumps(event)
                # SSE format: event:<type>\ndata:<json>\n\n
                yield f"event: {event_type}\ndata: {data}\n\n"
        except asyncio.CancelledError:
            logger.info("SSE stream cancelled: user=%s", user_id[:8])
        except Exception:
            logger.exception("SSE stream error: user=%s", user_id[:8])
        finally:
            logger.info("SSE stream closed: user=%s", user_id[:8])

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
