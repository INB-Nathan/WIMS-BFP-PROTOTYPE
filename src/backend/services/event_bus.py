"""Redis pub/sub event bus for real-time SSE notifications.

Channels
--------
wims:events:incident     — incident status changes, corrections
wims:events:verification — triage cluster workflow (claim, terminal action, split, merge)
wims:events:security     — threat log insertions, AI analysis results
wims:events:system       — system-level events (maintenance, config changes)
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, AsyncIterator

import redis
import redis.asyncio as aioredis

logger = logging.getLogger("wims.event_bus")

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

_sync_pool = redis.ConnectionPool.from_url(REDIS_URL, decode_responses=True)

_async_pool: aioredis.ConnectionPool | None = None


async def _get_async_pool() -> aioredis.ConnectionPool:
    global _async_pool
    if _async_pool is None:
        _async_pool = aioredis.ConnectionPool.from_url(
            REDIS_URL, decode_responses=True, max_connections=20
        )
    return _async_pool


CHANNELS = {
    "incident": "wims:events:incident",
    "verification": "wims:events:verification",
    "security": "wims:events:security",
    "system": "wims:events:system",
}


class EventBus:
    """Async Redis-backed publish/subscribe message bus.

    Uses a dedicated connection for publishing (connection pool) and a
    separate connection for blocking subscribe-mode reads."""

    def __init__(self) -> None:
        self._redis: aioredis.Redis | None = None
        self._pubsub_redis: aioredis.Redis | None = None

    async def _ensure_pub(self) -> aioredis.Redis:
        if self._redis is None:
            pool = await _get_async_pool()
            self._redis = aioredis.Redis(connection_pool=pool)
            await self._redis.ping()
        return self._redis

    async def _ensure_sub(self) -> aioredis.Redis:
        if self._pubsub_redis is None:
            pool = await _get_async_pool()
            self._pubsub_redis = aioredis.Redis(connection_pool=pool)
            await self._pubsub_redis.ping()
        return self._pubsub_redis

    async def publish(
        self,
        channel: str,
        event_type: str,
        payload: dict[str, Any],
        *,
        actor_id: str | None = None,
        actor_role: str | None = None,
    ) -> None:
        """Publish an event to a Redis channel (async)."""
        try:
            r = await self._ensure_pub()
            message = json.dumps(
                {
                    "channel": channel,
                    "event_type": event_type,
                    "payload": payload,
                    "actor_id": actor_id,
                    "actor_role": actor_role,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )
            await r.publish(channel, message)
            logger.debug("Published %s → %s", event_type, channel)
        except Exception:
            logger.warning("Failed to publish %s to %s", event_type, channel, exc_info=True)

    async def subscribe(self, channels: list[str]) -> AsyncIterator[dict[str, Any]]:
        """Subscribe to one or more Redis channels and yield parsed events.

        This is an async generator — the caller should iterate over it
        in an async for loop (typically inside an SSE streaming response).

        Args:
            channels: List of wims:events:* channel names to subscribe to.

        Yields:
            Parsed event dicts: {channel, event_type, payload, actor_id, actor_role, timestamp}
        """
        try:
            r = await self._ensure_sub()
            pubsub = r.pubsub()
            await pubsub.subscribe(*channels)
            logger.info("Subscribed to channels: %s", channels)

            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    yield json.loads(message["data"])
                except json.JSONDecodeError:
                    logger.warning("Failed to parse pubsub message: %s", message.get("data"))
        except Exception:
            logger.warning("Subscriber connection lost", exc_info=True)
            raise


# Global singleton
_event_bus: EventBus | None = None


async def get_event_bus() -> EventBus:
    """Return the global async EventBus singleton."""
    global _event_bus
    if _event_bus is None:
        _event_bus = EventBus()
    return _event_bus


# ---------------------------------------------------------------------------
# Convenience helpers for common event types
# ---------------------------------------------------------------------------


async def publish_incident_event(
    event_type: str,
    incident_id: int,
    *,
    status: str | None = None,
    previous_status: str | None = None,
    actor_id: str | None = None,
    actor_role: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Publish an incident lifecycle event."""
    bus = await get_event_bus()
    payload: dict[str, Any] = {"incident_id": incident_id}
    if status:
        payload["status"] = status
    if previous_status:
        payload["previous_status"] = previous_status
    if extra:
        payload.update(extra)
    await bus.publish(
        CHANNELS["incident"],
        event_type,
        payload,
        actor_id=actor_id,
        actor_role=actor_role,
    )


async def publish_verification_event(
    event_type: str,
    *,
    cluster_id: int | None = None,
    report_id: int | None = None,
    action: str | None = None,
    actor_id: str | None = None,
    actor_role: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Publish a verification/triage workflow event."""
    bus = await get_event_bus()
    payload: dict[str, Any] = {}
    if cluster_id is not None:
        payload["cluster_id"] = cluster_id
    if report_id is not None:
        payload["report_id"] = report_id
    if action:
        payload["action"] = action
    if extra:
        payload.update(extra)
    await bus.publish(
        CHANNELS["verification"],
        event_type,
        payload,
        actor_id=actor_id,
        actor_role=actor_role,
    )


async def publish_security_event(
    event_type: str,
    *,
    log_id: int | None = None,
    severity: str | None = None,
    threat_type: str | None = None,
    actor_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Publish a security event (IDS alert, AI analysis, HITL confirmation)."""
    bus = await get_event_bus()
    payload: dict[str, Any] = {}
    if log_id is not None:
        payload["log_id"] = log_id
    if severity:
        payload["severity"] = severity
    if threat_type:
        payload["threat_type"] = threat_type
    if extra:
        payload.update(extra)
    await bus.publish(
        CHANNELS["security"],
        event_type,
        payload,
        actor_id=actor_id,
        actor_role="SYSTEM_ADMIN",
    )


async def publish_system_event(
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> None:
    """Publish a system-level event."""
    bus = await get_event_bus()
    await bus.publish(
        CHANNELS["system"],
        event_type,
        payload or {},
    )


# ---------------------------------------------------------------------------
# Synchronous convenience helpers (for Celery tasks and sync code)
# ---------------------------------------------------------------------------


def publish_incident_event_sync(
    event_type: str,
    *,
    incident_id: int | None = None,
    status: str | None = None,
    previous_status: str | None = None,
    actor_id: str | None = None,
    actor_role: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Publish an incident lifecycle event synchronously (for sync endpoints)."""
    try:
        r = redis.Redis(connection_pool=_sync_pool)
        payload: dict[str, Any] = {}
        if incident_id is not None:
            payload["incident_id"] = incident_id
        if status:
            payload["status"] = status
        if previous_status:
            payload["previous_status"] = previous_status
        if extra:
            payload.update(extra)
        message = json.dumps(
            {
                "channel": CHANNELS["incident"],
                "event_type": event_type,
                "payload": payload,
                "actor_id": actor_id,
                "actor_role": actor_role,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        r.publish(CHANNELS["incident"], message)
        logger.debug("Published (sync) %s → %s", event_type, CHANNELS["incident"])
    except Exception:
        logger.warning("Failed to publish (sync) %s", event_type, exc_info=True)


def publish_verification_event_sync(
    event_type: str,
    *,
    cluster_id: int | None = None,
    report_id: int | None = None,
    action: str | None = None,
    actor_id: str | None = None,
    actor_role: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Publish a verification/triage event synchronously (for sync endpoints)."""
    try:
        r = redis.Redis(connection_pool=_sync_pool)
        payload: dict[str, Any] = {}
        if cluster_id is not None:
            payload["cluster_id"] = cluster_id
        if report_id is not None:
            payload["report_id"] = report_id
        if action:
            payload["action"] = action
        if extra:
            payload.update(extra)
        message = json.dumps(
            {
                "channel": CHANNELS["verification"],
                "event_type": event_type,
                "payload": payload,
                "actor_id": actor_id,
                "actor_role": actor_role,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        r.publish(CHANNELS["verification"], message)
        logger.debug("Published (sync) %s → %s", event_type, CHANNELS["verification"])
    except Exception:
        logger.warning("Failed to publish (sync) %s", event_type, exc_info=True)


def publish_security_event_sync(
    event_type: str,
    *,
    log_id: int | None = None,
    severity: str | None = None,
    threat_type: str | None = None,
    actor_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Publish a security event synchronously (for Celery tasks)."""
    try:
        r = redis.Redis(connection_pool=_sync_pool)
        payload: dict[str, Any] = {}
        if log_id is not None:
            payload["log_id"] = log_id
        if severity:
            payload["severity"] = severity
        if threat_type:
            payload["threat_type"] = threat_type
        if extra:
            payload.update(extra)
        message = json.dumps(
            {
                "channel": CHANNELS["security"],
                "event_type": event_type,
                "payload": payload,
                "actor_id": actor_id,
                "actor_role": "SYSTEM_ADMIN",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        r.publish(CHANNELS["security"], message)
        logger.debug("Published (sync) %s → %s", event_type, CHANNELS["security"])
    except Exception:
        logger.warning("Failed to publish (sync) %s", event_type, exc_info=True)
