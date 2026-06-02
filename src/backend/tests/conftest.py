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
# Public DMZ rate-limit test isolation
# =============================================================================


@pytest.fixture(autouse=True)
def flush_public_rate_limit():
    """Clear Redis public rate-limit keys before each test.

    Without this, tests that run before the dedicated rate-limit tests
    (test_rate_limit_exceeded_returns_429_with_retry_after_header,
     test_different_ips_independent_rate_limits) spend the 3-request budget
    for 127.0.0.1, causing subsequent validation tests to get 429 instead of 422.
    """
    try:
        import redis as redis_sync
    except ImportError:
        return  # no redis package — skip silently

    try:
        r = redis_sync.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True,
        )
        for key in r.keys("public_rate_limit:*"):
            r.delete(key)
    except Exception:
        pass  # no Redis running — skip silently
