"""Unit tests for ExternalServiceClient — circuit breaker, retry, size cap, concurrency cap.

Issue #393: External service wrapper with circuit breaker + retry.
Tracer bullet: test_circuit_breaker_opens_after_n_failures — proves breaker
opens after N consecutive failures and blocks subsequent calls.
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from utils.external_service import (
    CircuitBreakerOpenError,
    ConcurrencyLimitError,
    ExternalServiceClient,
    ExternalServiceError,
    ResponseSizeExceededError,
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_async_client_mock(get_fn=None, post_fn=None, request_fn=None):
    """Build a mock httpx.AsyncClient that returns itself from __aenter__."""
    mock_instance = AsyncMock()
    if get_fn is not None:
        mock_instance.get = get_fn
    if post_fn is not None:
        mock_instance.post = post_fn
    if request_fn is not None:
        mock_instance.request = request_fn
    mock_instance.__aenter__.return_value = mock_instance
    return mock_instance


def _make_sync_client_mock(get_fn=None, post_fn=None, request_fn=None):
    """Build a mock httpx.Client that returns itself from __enter__."""
    mock_instance = MagicMock()
    if get_fn is not None:
        mock_instance.get = get_fn
    if post_fn is not None:
        mock_instance.post = post_fn
    if request_fn is not None:
        mock_instance.request = request_fn
    mock_instance.__enter__.return_value = mock_instance
    return mock_instance


# ── Circuit breaker tests ─────────────────────────────────────────────────────


class TestCircuitBreaker:
    """Circuit breaker state machine: CLOSED → OPEN → HALF_OPEN → CLOSED."""

    @pytest.mark.unit
    def test_circuit_breaker_opens_after_n_failures(self):
        """After cb_failure_threshold consecutive failures, the breaker opens
        and subsequent calls raise CircuitBreakerOpenError without making
        additional HTTP requests.

        Tracer bullet (RED→GREEN first) per Issue #393 AC:
        "Circuit breaker opens on N failures, half-open probes, auto-closes on success."
        """
        client = ExternalServiceClient(
            service_name="test-nominatim",
            cb_failure_threshold=3,
            cb_recovery_timeout=30.0,
        )

        # Track how many actual HTTP calls are made
        call_count = [0]

        async def failing_get(*args, **kwargs):
            call_count[0] += 1
            raise httpx.ConnectError("Connection refused")

        with patch("utils.external_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = _make_async_client_mock(get_fn=failing_get)
            mock_client_cls.return_value = mock_instance

            # ── Phase 1: Trigger cb_failure_threshold failures ──────────────
            for _ in range(3):
                with pytest.raises(ExternalServiceError):
                    asyncio.run(client.request_async("GET", "http://nominatim.example/reverse"))

            # All N failures must have hit the wire
            assert call_count[0] == 3, (
                f"Expected 3 HTTP attempts before breaker opens, got {call_count[0]}"
            )

            # ── Phase 2: Breaker is OPEN — next call must fail immediately ──
            calls_before = call_count[0]
            with pytest.raises(CircuitBreakerOpenError) as exc_info:
                asyncio.run(client.request_async("GET", "http://nominatim.example/reverse"))

            assert "open" in str(exc_info.value).lower(), (
                f"CircuitBreakerOpenError message must indicate breaker is open, "
                f"got: {exc_info.value}"
            )
            # CRITICAL: No additional HTTP call was made — the breaker blocked it
            assert call_count[0] == calls_before, (
                f"Breaker open but HTTP call was still made! "
                f"call_count went from {calls_before} to {call_count[0]}"
            )

    @pytest.mark.unit
    def test_circuit_breaker_half_open_probe_succeeds(self):
        """After recovery timeout, breaker transitions OPEN → HALF_OPEN,
        probe succeeds → CLOSED."""
        client = ExternalServiceClient(
            service_name="test-probe",
            cb_failure_threshold=2,
            cb_recovery_timeout=0.05,  # 50ms — very short for testing
        )

        call_count = [0]

        async def failing_get(*args, **kwargs):
            call_count[0] += 1
            raise httpx.ConnectError("Connection refused")

        async def succeeding_get(*args, **kwargs):
            call_count[0] += 1
            resp = AsyncMock(spec=httpx.Response)
            resp.status_code = 200
            return resp

        with patch("utils.external_service.httpx.AsyncClient") as mock_client_cls:
            # Phase 1: Trigger OPEN with 2 failures
            mock_instance = _make_async_client_mock(get_fn=failing_get)
            mock_client_cls.return_value = mock_instance

            for _ in range(2):
                with pytest.raises(ExternalServiceError):
                    asyncio.run(client.request_async("GET", "http://example/1"))

            assert call_count[0] == 2

            # Verify breaker is OPEN
            with pytest.raises(CircuitBreakerOpenError):
                asyncio.run(client.request_async("GET", "http://example/1"))

            # Phase 2: Wait for recovery timeout
            time.sleep(0.1)

            # Phase 3: Switch mock to succeed — probe should pass
            mock_instance.get = succeeding_get
            calls_before = call_count[0]

            result = asyncio.run(client.request_async("GET", "http://example/probe"))
            assert result.status_code == 200
            assert call_count[0] == calls_before + 1  # exactly one probe request

            # Phase 4: Breaker is now CLOSED — subsequent calls work normally
            result2 = asyncio.run(client.request_async("GET", "http://example/normal"))
            assert result2.status_code == 200

    @pytest.mark.unit
    def test_circuit_breaker_half_open_probe_fails(self):
        """HALF_OPEN probe fails → back to OPEN."""
        client = ExternalServiceClient(
            service_name="test-probe-fail",
            cb_failure_threshold=2,
            cb_recovery_timeout=0.05,
        )

        call_count = [0]

        async def failing_get(*args, **kwargs):
            call_count[0] += 1
            raise httpx.ConnectError("Connection refused")

        with patch("utils.external_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = _make_async_client_mock(get_fn=failing_get)
            mock_client_cls.return_value = mock_instance

            # Trigger OPEN
            for _ in range(2):
                with pytest.raises(ExternalServiceError):
                    asyncio.run(client.request_async("GET", "http://example/1"))

            # Wait for recovery
            time.sleep(0.1)

            # Probe attempt — still fails
            with pytest.raises(ExternalServiceError):
                asyncio.run(client.request_async("GET", "http://example/probe"))

            # Breaker is OPEN again — next call blocked immediately
            calls_before = call_count[0]
            with pytest.raises(CircuitBreakerOpenError):
                asyncio.run(client.request_async("GET", "http://example/blocked"))

            assert call_count[0] == calls_before

    @pytest.mark.unit
    def test_circuit_breaker_redis_state_persists_across_clients(self):
        """A new client loads OPEN breaker state from Redis and blocks immediately."""
        fake_redis = MagicMock()
        fake_redis.get.side_effect = lambda key: {
            "cb:test-redis:state": "open",
            "cb:test-redis:failure_count": "3",
            "cb:test-redis:last_failure_time": str(time.time()),
        }.get(key)

        call_count = [0]

        async def succeeding_get(*args, **kwargs):
            call_count[0] += 1
            resp = AsyncMock(spec=httpx.Response)
            resp.status_code = 200
            return resp

        with patch("utils.external_service.redis.from_url", return_value=fake_redis):
            client = ExternalServiceClient(
                service_name="test-redis",
                redis_url="redis://example/0",
                cb_failure_threshold=3,
                cb_recovery_timeout=30.0,
            )

        with patch("utils.external_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = _make_async_client_mock(get_fn=succeeding_get)
            mock_client_cls.return_value = mock_instance

            with pytest.raises(CircuitBreakerOpenError):
                asyncio.run(client.request_async("GET", "http://example/blocked"))

        assert call_count[0] == 0


# ── Retry tests ───────────────────────────────────────────────────────────────


class TestRetry:
    """Retry with exponential backoff."""

    @pytest.mark.unit
    def test_retry_exponential_backoff(self):
        """Retries exhausted → ExternalServiceError raised."""
        client = ExternalServiceClient(
            service_name="test-retry",
            max_retries=3,
            base_delay=0.01,  # tiny for fast tests
            cb_failure_threshold=10,  # high so breaker doesn't interfere
        )

        call_count = [0]

        async def failing_get(*args, **kwargs):
            call_count[0] += 1
            raise httpx.ConnectError("Connection refused")

        with patch("utils.external_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = _make_async_client_mock(get_fn=failing_get)
            mock_client_cls.return_value = mock_instance

            with pytest.raises(ExternalServiceError) as exc_info:
                asyncio.run(client.request_async("GET", "http://example/test"))

            assert "test-retry" in str(exc_info.value)
            # 1 original + 3 retries = 4 total attempts
            assert call_count[0] == 4

    @pytest.mark.unit
    def test_retry_succeeds_on_retryable_failure(self):
        """First attempts fail with ConnectError, then success."""
        client = ExternalServiceClient(
            service_name="test-retry-success",
            max_retries=3,
            base_delay=0.01,
            cb_failure_threshold=10,
        )

        call_count = [0]

        async def flaky_get(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] < 3:
                raise httpx.ConnectError("Connection refused")
            resp = AsyncMock(spec=httpx.Response)
            resp.status_code = 200
            return resp

        with patch("utils.external_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = _make_async_client_mock(get_fn=flaky_get)
            mock_client_cls.return_value = mock_instance

            result = asyncio.run(client.request_async("GET", "http://example/test"))

        assert result.status_code == 200
        assert call_count[0] == 3  # 2 failures + 1 success


# ── Response size cap tests ───────────────────────────────────────────────────


class TestSizeCap:
    """Response size cap enforcement."""

    @pytest.mark.unit
    def test_response_size_cap_exceeded(self):
        """Response body > limit → ResponseSizeExceededError."""
        client = ExternalServiceClient(
            service_name="test-size-cap",
            response_size_limit=100,
            cb_failure_threshold=10,
        )

        async def large_response_get(*args, **kwargs):
            resp = AsyncMock(spec=httpx.Response)
            resp.status_code = 200
            resp.content = b"x" * 200  # 200 bytes > 100 limit
            return resp

        with patch("utils.external_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = _make_async_client_mock(get_fn=large_response_get)
            mock_client_cls.return_value = mock_instance

            with pytest.raises(ResponseSizeExceededError) as exc_info:
                asyncio.run(client.request_async("GET", "http://example/large"))

            assert "200" in str(exc_info.value)
            assert "100" in str(exc_info.value)

    @pytest.mark.unit
    def test_response_size_within_limit(self):
        """Response body within limit → success."""
        client = ExternalServiceClient(
            service_name="test-size-ok",
            response_size_limit=100,
            cb_failure_threshold=10,
        )

        async def small_response_get(*args, **kwargs):
            resp = AsyncMock(spec=httpx.Response)
            resp.status_code = 200
            resp.content = b"small"
            return resp

        with patch("utils.external_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = _make_async_client_mock(get_fn=small_response_get)
            mock_client_cls.return_value = mock_instance

            result = asyncio.run(client.request_async("GET", "http://example/small"))
            assert result.status_code == 200


# ── Concurrency cap tests ─────────────────────────────────────────────────────


class TestConcurrencyCap:
    """Concurrency cap via semaphore."""

    @pytest.mark.unit
    def test_concurrency_cap_enforced(self):
        """With concurrency_limit=1, second request blocked."""
        client = ExternalServiceClient(
            service_name="test-concurrency",
            concurrency_limit=1,
            cb_failure_threshold=10,
        )

        # Simulate a request holding the semaphore
        held = asyncio.Event()
        released = asyncio.Event()

        async def slow_get(*args, **kwargs):
            held.set()
            await released.wait()
            resp = AsyncMock(spec=httpx.Response)
            resp.status_code = 200
            return resp

        with patch("utils.external_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = _make_async_client_mock(get_fn=slow_get)
            mock_client_cls.return_value = mock_instance

            async def first_request():
                return await client.request_async("GET", "http://example/slow")

            async def second_request():
                # Wait for first to acquire semaphore
                await held.wait()
                return await client.request_async("GET", "http://example/blocked")

            async def runner():
                task1 = asyncio.create_task(first_request())
                task2 = asyncio.create_task(second_request())
                # task2 should fail with ConcurrencyLimitError
                with pytest.raises(ConcurrencyLimitError):
                    await task2
                # Release task1
                released.set()
                result = await task1
                return result

            result = asyncio.run(runner())
            assert result.status_code == 200


# ── Sync mode tests ───────────────────────────────────────────────────────────


class TestSyncMode:
    """Sync HTTP request path (for OpenBao)."""

    @pytest.mark.unit
    def test_sync_mode_retry(self):
        """Sync mode retries on ConnectError then succeeds."""
        client = ExternalServiceClient(
            service_name="test-sync",
            max_retries=2,
            base_delay=0.01,
            cb_failure_threshold=10,
        )

        call_count = [0]

        def flaky_get(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] < 2:
                raise httpx.ConnectError("Connection refused")
            resp = MagicMock(spec=httpx.Response)
            resp.status_code = 200
            return resp

        with patch("utils.external_service.httpx.Client") as mock_client_cls:
            mock_instance = _make_sync_client_mock(get_fn=flaky_get)
            mock_client_cls.return_value = mock_instance

            result = client.request_sync("GET", "http://example/test")

        assert result.status_code == 200
        assert call_count[0] == 2

    @pytest.mark.unit
    def test_sync_mode_circuit_breaker(self):
        """Sync mode opens breaker after N failures."""
        client = ExternalServiceClient(
            service_name="test-sync-cb",
            cb_failure_threshold=2,
            cb_recovery_timeout=30.0,
        )

        call_count = [0]

        def failing_get(*args, **kwargs):
            call_count[0] += 1
            raise httpx.ConnectError("Connection refused")

        with patch("utils.external_service.httpx.Client") as mock_client_cls:
            mock_instance = _make_sync_client_mock(get_fn=failing_get)
            mock_client_cls.return_value = mock_instance

            for _ in range(2):
                with pytest.raises(ExternalServiceError):
                    client.request_sync("GET", "http://example/1")

            assert call_count[0] == 2

            calls_before = call_count[0]
            with pytest.raises(CircuitBreakerOpenError):
                client.request_sync("GET", "http://example/blocked")

            assert call_count[0] == calls_before


# ── Regression guards ─────────────────────────────────────────────────────────


class TestRegressionGuards:
    """Preserve existing behavior contracts."""

    @pytest.mark.unit
    def test_timeout_not_retried(self):
        """TimeoutException should NOT be retried (existing Ollama contract)."""
        client = ExternalServiceClient(
            service_name="test-no-retry-timeout",
            max_retries=3,
            base_delay=0.01,
            cb_failure_threshold=10,
            retry_on_timeout=False,
        )

        call_count = [0]

        async def timeout_get(*args, **kwargs):
            call_count[0] += 1
            raise httpx.TimeoutException("Request timed out")

        with patch("utils.external_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = _make_async_client_mock(get_fn=timeout_get)
            mock_client_cls.return_value = mock_instance

            with pytest.raises(ExternalServiceError):
                asyncio.run(client.request_async("GET", "http://example/test"))

        # Existing Ollama behavior: TimeoutException → 502 immediately, no retry.
        # The wrapper preserves that behavior when retry_on_timeout=False.
        assert call_count[0] == 1
