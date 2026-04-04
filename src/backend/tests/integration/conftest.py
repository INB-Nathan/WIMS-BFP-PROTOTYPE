import pytest

"""Integration test fixtures. Override Redis-dependent fixtures from parent conftest."""
@pytest.fixture(autouse=True)
def flush_rate_limits():
    """Override redis-dependent fixture — integration tests do not use rate limiting."""
    return None
