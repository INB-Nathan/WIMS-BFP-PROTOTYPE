import os

import pytest

try:
    import pytest_asyncio
    import redis.asyncio as aioredis

    @pytest_asyncio.fixture(autouse=True)
    async def flush_rate_limits():
        """Ensure each test starts with a clean bucket."""
        redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
        r = aioredis.from_url(redis_url)
        await r.delete("rate_limit:192.168.1.1")
        await r.aclose()
except ImportError:

    @pytest.fixture(autouse=True)
    def flush_rate_limits():
        """No-op when pytest_asyncio/redis not installed (e.g. model-only tests)."""
        return None
