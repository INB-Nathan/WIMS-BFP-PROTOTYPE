import os

import pytest

try:
    import pytest_asyncio
    import redis.asyncio as aioredis

    @pytest_asyncio.fixture(autouse=True)
    async def flush_rate_limits():
        """Ensure each test starts with a clean bucket."""
        redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        try:
            client = await aioredis.from_url(redis_url, decode_responses=True)
            await client.flushdb()
            await client.aclose()
        except Exception:
            pass  # Skip if Redis is unavailable in test env

    HAS_ASYNC_REDIS = True
except ImportError:
    HAS_ASYNC_REDIS = False

    @pytest.fixture(autouse=True)
    def flush_rate_limits():
        """No-op when pytest_asyncio/redis not installed (e.g. model-only tests)."""
        return None
