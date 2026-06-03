import os

import pytest
from dotenv import load_dotenv

load_dotenv()  # Load .env for local test runs against Docker containers

# Deterministic local/test AES-256 key. Production and deployed CI should still
# inject WIMS_MASTER_KEY explicitly; this fallback keeps local pytest runs stable.
TEST_WIMS_MASTER_KEY = "76/kA0LVDzvX/mQWIxx3UJZl0SrTSIO/k0KdRMdRxCU="
if not os.environ.get("WIMS_MASTER_KEY"):
    os.environ["WIMS_MASTER_KEY"] = TEST_WIMS_MASTER_KEY

# =============================================================================
# Pytest markers
# =============================================================================
# Register custom markers so pytest -m <marker> works reliably.
# CI uses these to select fast test subsets vs. integration-heavy suites.


def pytest_configure(config):
    config.addinivalue_line("markers", "unit: Unit tests that do not require Docker services")
    config.addinivalue_line(
        "markers", "integration: Integration tests requiring Docker services (postgres, redis)"
    )
    config.addinivalue_line(
        "markers", "requires_keycloak: Tests that require Keycloak to be running"
    )
    config.addinivalue_line(
        "markers", "requires_docker: Tests that require Docker containers to be running"
    )
    config.addinivalue_line("markers", "slow: Tests that take >5s to run")


# =============================================================================
# Rate-limit flushing
# =============================================================================

try:
    import pytest_asyncio
    import redis.asyncio as aioredis

    @pytest_asyncio.fixture(autouse=True)
    async def flush_rate_limits():
        """Ensure each test starts with a clean Redis bucket."""
        if os.environ.get("PYTEST_FLUSH_REDIS") != "1":
            return
        redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        try:
            client = await aioredis.from_url(
                redis_url,
                decode_responses=True,
                socket_connect_timeout=0.2,
                socket_timeout=0.2,
            )
            await client.flushdb()
            await client.aclose()
        except Exception:
            pass  # CI environments without Redis skip silently

except ImportError:

    @pytest.fixture(autouse=True)
    def flush_rate_limits():
        """No-op when pytest_asyncio/redis not installed."""
        return None


# =============================================================================
# CSRF middleware: disabled by default in test suite
# =============================================================================
# Existing tests send POST/PUT/PATCH/DELETE without Origin/Referer headers.
# To keep them passing, disable CSRF enforcement globally and let the
# dedicated test_csrf_middleware.py re-enable it per-test via MonkeyPatch.
@pytest.fixture(autouse=True)
def _disable_csrf():
    """Globally disable CSRF middleware for all non-CSRF tests."""
    os.environ["WIMS_CSRF_DISABLED"] = "1"
    yield
    os.environ.pop("WIMS_CSRF_DISABLED", None)
