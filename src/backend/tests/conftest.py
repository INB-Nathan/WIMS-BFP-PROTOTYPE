import os

import pytest
from dotenv import load_dotenv

load_dotenv()  # Load .env for local test runs against Docker containers

# Set a usable default REDIS_URL for local pytest runs (Docker hostname "redis"
# does not resolve from the bare-metal host).  Docker Compose and CI set
# REDIS_URL explicitly via environment, so setdefault is a no-op there.
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

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
# Redis rate-limit test isolation
# =============================================================================


@pytest.fixture(autouse=True)
def flush_public_rate_limit():
    """Clear Redis rate-limit keys before each test.

    Public submission tests use ``public_rate_limit:*`` keys, while the PKCE
    callback middleware in ``main.py`` uses ``rate_limit:*`` keys. Clearing both
    namespaces keeps endpoint tests focused on their own expected status codes
    instead of inheriting a spent sliding-window budget from earlier tests.
    """
    try:
        import redis as redis_sync
    except ImportError:
        return  # no redis package — skip silently

    r = None
    try:
        r = redis_sync.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True,
        )
        for pattern in ("public_rate_limit:*", "rate_limit:*"):
            for key in r.scan_iter(match=pattern):
                r.delete(key)
    except Exception:
        pass  # no Redis running — skip silently
    finally:
        if r is not None:
            r.close()


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
