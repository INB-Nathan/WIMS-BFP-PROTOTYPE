"""Shared external-service wrapper with circuit breaker, retry, and safety caps.

Issue #393: External service wrapper with circuit breaker + retry.
Applies to Nominatim geocode, Ollama/XAI, and OpenBao/KMS.
"""

from __future__ import annotations

import asyncio
import enum
import logging
import os
import threading
import time
import urllib.parse
from typing import Any

import httpx
import redis

logger = logging.getLogger("wims.external_service")

# ── Exceptions ────────────────────────────────────────────────────────────────


class ExternalServiceError(Exception):
    """Base exception for all external-service wrapper errors."""


class CircuitBreakerOpenError(ExternalServiceError):
    """Raised when a request is blocked because the circuit breaker is OPEN."""


class ResponseSizeExceededError(ExternalServiceError):
    """Raised when a response body exceeds the configured size limit."""


class ConcurrencyLimitError(ExternalServiceError):
    """Raised when the concurrency cap is hit."""


# ── Circuit breaker state machine ─────────────────────────────────────────────


class _BreakerState(enum.Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


# ── Client ────────────────────────────────────────────────────────────────────


class ExternalServiceClient:
    """Resilient HTTP client wrapper for outbound external-service calls.

    Features:
    - Circuit breaker (in-memory with optional Redis persistence)
    - Bounded retry with exponential backoff
    - Response size cap
    - Concurrency cap (per-service semaphore)
    - Sync and async request modes
    """

    def __init__(
        self,
        service_name: str,
        *,
        timeout: float = 30.0,
        max_retries: int = 0,
        base_delay: float = 1.0,
        response_size_limit: int | None = None,
        concurrency_limit: int = 0,
        cb_failure_threshold: int = 5,
        cb_recovery_timeout: float = 30.0,
        redis_url: str | None = None,
        retry_on_timeout: bool = True,
    ) -> None:
        self.service_name = service_name
        self.timeout = timeout
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.response_size_limit = response_size_limit
        self.concurrency_limit = concurrency_limit
        self.cb_failure_threshold = cb_failure_threshold
        self.cb_recovery_timeout = cb_recovery_timeout
        self.retry_on_timeout = retry_on_timeout

        # ── In-memory breaker state ───────────────────────────────────────
        self._breaker_state: _BreakerState = _BreakerState.CLOSED
        self._failure_count: int = 0
        self._last_failure_time: float = 0.0
        self._lock = threading.Lock()

        # ── Concurrency semaphore ─────────────────────────────────────────
        self._sync_semaphore: threading.BoundedSemaphore | None = None
        self._async_semaphore: asyncio.BoundedSemaphore | None = None
        if concurrency_limit > 0:
            self._sync_semaphore = threading.BoundedSemaphore(concurrency_limit)
            self._async_semaphore = asyncio.BoundedSemaphore(concurrency_limit)

        # ── Redis (optional) ──────────────────────────────────────────────
        self._redis_url = redis_url or os.environ.get("REDIS_URL", "")
        self._redis: redis.Redis | None = None
        if self._redis_url:
            try:
                self._redis = redis.from_url(self._redis_url, decode_responses=True)
                self._load_breaker_state()
            except Exception:
                self._redis = None
                logger.debug(
                    "ExternalServiceClient(%s): Redis unavailable, using in-memory breaker",
                    service_name,
                )

        # ── Outbound URL allowlist (V13.2.4) ─────────────────────────────
        self._allowed_hosts: set[str] = self._build_allowlist()
        logger.info(
            "ExternalServiceClient(%s): allowlist hosts: %s",
            service_name,
            sorted(self._allowed_hosts),
        )

    # ── Allowlist helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _build_allowlist() -> set[str]:
        """Build the outbound URL hostname allowlist from env vars and defaults.

        Derives hostnames from:
        - OLLAMA_URL (default http://ollama:11434)
        - OPENBAO_ADDR (default http://openbao:8200)
        - NOMINATIM_URL (default https://nominatim.openstreetmap.org)
        - EXTERNAL_SERVICE_ALLOWED_HOSTS (comma-separated, additive)
        - Docker internal service hostnames (backplane admin tasks)
        """
        hosts: set[str] = set()

        for var, default in [
            ("OLLAMA_URL", "http://ollama:11434"),
            ("OPENBAO_ADDR", "http://openbao:8200"),
            ("NOMINATIM_URL", "https://nominatim.openstreetmap.org"),
        ]:
            raw = os.environ.get(var, default)
            hostname = urllib.parse.urlparse(raw).hostname
            if hostname:
                hosts.add(hostname)

        # EXTERNAL_SERVICE_ALLOWED_HOSTS — additive, comma-separated
        extra = os.environ.get("EXTERNAL_SERVICE_ALLOWED_HOSTS", "")
        if extra:
            for h in extra.split(","):
                h = h.strip()
                if h:
                    hosts.add(h)

        # Docker internal services reachable by hostname for backplane ops
        docker_hosts = {
            "wims-postgres",
            "wims-redis",
            "wims-keycloak",
            "keycloak",
            "redis",
            "postgres",
        }
        hosts.update(docker_hosts)

        return hosts

    def _check_allowlist(self, url: str) -> None:
        """Raise ExternalServiceError if the URL's host is not in the allowlist.

        Parses the URL with urllib.parse — no DNS resolution (avoids DoS
        vector and unnecessary latency).
        """
        host = urllib.parse.urlparse(url).hostname
        if host is None:
            raise ExternalServiceError(f"URL has no hostname: {url}")
        if host not in self._allowed_hosts:
            raise ExternalServiceError(f"URL host not in allowlist: {host}")

    # ── Circuit breaker helpers ───────────────────────────────────────────────

    def _should_probe(self) -> bool:
        """Check whether the breaker should transition from OPEN to HALF_OPEN."""
        if self._breaker_state != _BreakerState.OPEN:
            return False
        elapsed = time.time() - self._last_failure_time
        return elapsed >= self.cb_recovery_timeout

    def _on_success(self) -> None:
        """Record a successful request — transition to CLOSED."""
        with self._lock:
            prev_state = self._breaker_state
            self._failure_count = 0
            if self._breaker_state != _BreakerState.CLOSED:
                self._breaker_state = _BreakerState.CLOSED
                logger.info(
                    "Circuit breaker for %s: %s -> CLOSED",
                    self.service_name,
                    prev_state.value,
                )
                self._persist_breaker_state()

    def _on_failure(self) -> None:
        """Record a failed request — may transition to OPEN."""
        with self._lock:
            self._failure_count += 1
            self._last_failure_time = time.time()
            prev_state = self._breaker_state

            if self._failure_count >= self.cb_failure_threshold:
                if self._breaker_state != _BreakerState.OPEN:
                    self._breaker_state = _BreakerState.OPEN
                    logger.warning(
                        "Circuit breaker for %s: %s -> OPEN (%d failures)",
                        self.service_name,
                        prev_state.value,
                        self._failure_count,
                    )
                    self._persist_breaker_state()
            elif self._breaker_state == _BreakerState.HALF_OPEN:
                # Probe failed — back to OPEN immediately
                self._breaker_state = _BreakerState.OPEN
                logger.warning(
                    "Circuit breaker for %s: HALF_OPEN probe failed -> OPEN",
                    self.service_name,
                )
                self._persist_breaker_state()

    def _check_open(self) -> None:
        """Raise CircuitBreakerOpenError if the breaker is not accepting requests."""
        with self._lock:
            if self._breaker_state == _BreakerState.CLOSED:
                return

            if self._breaker_state == _BreakerState.OPEN:
                if self._should_probe():
                    self._breaker_state = _BreakerState.HALF_OPEN
                    self._persist_breaker_state()
                    logger.info(
                        "Circuit breaker for %s: OPEN -> HALF_OPEN (probing)",
                        self.service_name,
                    )
                    # Allow this one probe through
                    return
                # Still OPEN — block
                raise CircuitBreakerOpenError(
                    f"Circuit breaker for {self.service_name} is OPEN; "
                    f"retry after {self.cb_recovery_timeout:.0f}s"
                )

            # HALF_OPEN — allow the probe request through (only ONE at a time)
            assert self._breaker_state == _BreakerState.HALF_OPEN
            return

    def _load_breaker_state(self) -> None:
        """Load persisted breaker state from Redis if present.

        Persisted state uses wall-clock timestamps so it can survive process
        restarts and be shared across workers. If Redis reads fail or contain
        invalid data, fall back to the in-memory CLOSED state.
        """
        if self._redis is None:
            return
        try:
            state = self._redis.get(f"cb:{self.service_name}:state")
            failure_count = self._redis.get(f"cb:{self.service_name}:failure_count")
            last_failure_time = self._redis.get(f"cb:{self.service_name}:last_failure_time")

            if state in {item.value for item in _BreakerState}:
                self._breaker_state = _BreakerState(state)
            if failure_count is not None:
                self._failure_count = int(failure_count)
            if last_failure_time is not None:
                self._last_failure_time = float(last_failure_time)
        except Exception:
            logger.debug(
                "Failed to load breaker state for %s from Redis",
                self.service_name,
                exc_info=True,
            )

    def _persist_breaker_state(self) -> None:
        """Persist breaker state to Redis if available."""
        if self._redis is None:
            return
        try:
            state_key = f"cb:{self.service_name}:state"
            failure_key = f"cb:{self.service_name}:failure_count"
            last_key = f"cb:{self.service_name}:last_failure_time"
            self._redis.set(state_key, self._breaker_state.value)
            self._redis.set(failure_key, str(self._failure_count))
            self._redis.set(last_key, str(self._last_failure_time))
        except Exception:
            logger.debug(
                "Failed to persist breaker state for %s to Redis",
                self.service_name,
                exc_info=True,
            )

    # ── Response size guard ───────────────────────────────────────────────────

    def _check_size(self, content: bytes) -> None:
        """Raise ResponseSizeExceededError if content exceeds the size limit."""
        if self.response_size_limit is not None and len(content) > self.response_size_limit:
            raise ResponseSizeExceededError(
                f"Response body size {len(content)} exceeds limit "
                f"{self.response_size_limit} bytes for {self.service_name}"
            )

    # ── Async request ─────────────────────────────────────────────────────────

    async def request_async(
        self,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> httpx.Response:
        """Make an async HTTP request through the circuit breaker.

        Returns an httpx.Response on success.
        Raises ExternalServiceError or subclasses on failure.
        """
        # Check outbound URL allowlist before anything else (V13.2.4)
        self._check_allowlist(url)
        # Check circuit breaker
        self._check_open()
        with self._lock:
            half_open_probe = self._breaker_state == _BreakerState.HALF_OPEN

        # Acquire concurrency semaphore if configured
        semaphore = self._async_semaphore
        if semaphore is not None:
            if semaphore.locked():
                raise ConcurrencyLimitError(
                    f"Concurrency limit {self.concurrency_limit} reached for {self.service_name}"
                )
            await semaphore.acquire()

        try:
            last_exc: Exception | None = None
            max_attempts = max(1, self.max_retries + 1)

            for attempt in range(max_attempts):
                try:
                    async with httpx.AsyncClient(timeout=self.timeout) as client:
                        http_method = getattr(client, method.lower())
                        resp = await http_method(url, **kwargs)

                    if self.response_size_limit is not None:
                        self._check_size(resp.content)

                    if resp.status_code < 500:
                        self._on_success()
                        return resp

                    last_exc = ExternalServiceError(
                        f"{self.service_name} returned {resp.status_code} on {method} {url}"
                    )
                    if attempt < max_attempts - 1 and not half_open_probe:
                        delay = self.base_delay * (2**attempt)
                        logger.warning(
                            "%s 5xx (attempt %d/%d, status=%d), retrying in %.1fs...",
                            self.service_name,
                            attempt + 1,
                            max_attempts,
                            resp.status_code,
                            delay,
                        )
                        await asyncio.sleep(delay)
                    else:
                        self._on_failure()
                        raise last_exc

                except httpx.TimeoutException as exc:
                    if not self.retry_on_timeout:
                        self._on_failure()
                        raise ExternalServiceError(
                            f"{self.service_name} request timed out on {method} {url}"
                        ) from exc
                    last_exc = ExternalServiceError(
                        f"{self.service_name} request timed out on {method} {url}: {exc}"
                    )
                    if attempt < max_attempts - 1 and not half_open_probe:
                        delay = self.base_delay * (2**attempt)
                        logger.warning(
                            "%s timeout (attempt %d/%d), retrying in %.1fs...",
                            self.service_name,
                            attempt + 1,
                            max_attempts,
                            delay,
                        )
                        await asyncio.sleep(delay)
                    else:
                        self._on_failure()
                        raise last_exc from exc
                except (httpx.ConnectError, httpx.RemoteProtocolError) as exc:
                    last_exc = ExternalServiceError(
                        f"{self.service_name} request failed on {method} {url}: {exc}"
                    )
                    if attempt < max_attempts - 1 and not half_open_probe:
                        delay = self.base_delay * (2**attempt)
                        logger.warning(
                            "%s transport error (attempt %d/%d), retrying in %.1fs...",
                            self.service_name,
                            attempt + 1,
                            max_attempts,
                            delay,
                        )
                        await asyncio.sleep(delay)
                    else:
                        self._on_failure()
                        raise last_exc from exc

            raise last_exc or ExternalServiceError(
                f"{self.service_name} request failed after {max_attempts} attempts"
            )

        except ExternalServiceError:
            raise
        except Exception as exc:
            self._on_failure()
            raise ExternalServiceError(
                f"{self.service_name} unexpected error on {method} {url}: {exc}"
            ) from exc
        finally:
            if semaphore is not None:
                semaphore.release()

    # ── Sync request ──────────────────────────────────────────────────────────

    def request_sync(
        self,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> httpx.Response:
        """Make a sync HTTP request through the circuit breaker.

        Returns an httpx.Response on success.
        Raises ExternalServiceError or subclasses on failure.
        """
        # Check outbound URL allowlist before anything else (V13.2.4)
        self._check_allowlist(url)
        self._check_open()
        with self._lock:
            half_open_probe = self._breaker_state == _BreakerState.HALF_OPEN

        semaphore = self._sync_semaphore
        if semaphore is not None:
            if not semaphore.acquire(blocking=False):
                raise ConcurrencyLimitError(
                    f"Concurrency limit {self.concurrency_limit} reached for {self.service_name}"
                )

        try:
            last_exc: Exception | None = None
            max_attempts = max(1, self.max_retries + 1)

            for attempt in range(max_attempts):
                try:
                    with httpx.Client(timeout=self.timeout) as client:
                        http_method = getattr(client, method.lower())
                        resp = http_method(url, **kwargs)

                    if self.response_size_limit is not None:
                        self._check_size(resp.content)

                    if resp.status_code < 500:
                        self._on_success()
                        return resp

                    last_exc = ExternalServiceError(
                        f"{self.service_name} returned {resp.status_code} on {method} {url}"
                    )
                    if attempt < max_attempts - 1 and not half_open_probe:
                        delay = self.base_delay * (2**attempt)
                        logger.warning(
                            "%s 5xx (attempt %d/%d, status=%d), retrying in %.1fs...",
                            self.service_name,
                            attempt + 1,
                            max_attempts,
                            resp.status_code,
                            delay,
                        )
                        time.sleep(delay)
                    else:
                        self._on_failure()
                        raise last_exc

                except httpx.TimeoutException as exc:
                    if not self.retry_on_timeout:
                        self._on_failure()
                        raise ExternalServiceError(
                            f"{self.service_name} request timed out on {method} {url}"
                        ) from exc
                    last_exc = ExternalServiceError(
                        f"{self.service_name} request timed out on {method} {url}: {exc}"
                    )
                    if attempt < max_attempts - 1 and not half_open_probe:
                        delay = self.base_delay * (2**attempt)
                        logger.warning(
                            "%s timeout (attempt %d/%d), retrying in %.1fs...",
                            self.service_name,
                            attempt + 1,
                            max_attempts,
                            delay,
                        )
                        time.sleep(delay)
                    else:
                        self._on_failure()
                        raise last_exc from exc
                except (httpx.ConnectError, httpx.RemoteProtocolError) as exc:
                    last_exc = ExternalServiceError(
                        f"{self.service_name} request failed on {method} {url}: {exc}"
                    )
                    if attempt < max_attempts - 1 and not half_open_probe:
                        delay = self.base_delay * (2**attempt)
                        logger.warning(
                            "%s transport error (attempt %d/%d), retrying in %.1fs...",
                            self.service_name,
                            attempt + 1,
                            max_attempts,
                            delay,
                        )
                        time.sleep(delay)
                    else:
                        self._on_failure()
                        raise last_exc from exc

            raise last_exc or ExternalServiceError(
                f"{self.service_name} request failed after {max_attempts} attempts"
            )

        except ExternalServiceError:
            raise
        except Exception as exc:
            self._on_failure()
            raise ExternalServiceError(
                f"{self.service_name} unexpected error on {method} {url}: {exc}"
            ) from exc
        finally:
            if semaphore is not None:
                semaphore.release()
