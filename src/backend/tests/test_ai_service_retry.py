"""Unit tests for Ollama retry logic and timeout configurability (GH #245)."""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException


@pytest.fixture(autouse=True)
def _clear_ollama_env_and_client():
    """Clear env vars and shared Ollama client state that affect retry tests."""
    saved = os.environ.get("OLLAMA_TIMEOUT")
    if "OLLAMA_TIMEOUT" in os.environ:
        del os.environ["OLLAMA_TIMEOUT"]

    import services.ai_service as ai_service

    ai_service._ollama_client = None
    yield
    ai_service._ollama_client = None

    if saved is not None:
        os.environ["OLLAMA_TIMEOUT"] = saved
    elif "OLLAMA_TIMEOUT" in os.environ:
        del os.environ["OLLAMA_TIMEOUT"]


class TestOllamaTimeout:
    """Tests for _ollama_timeout() priority chain."""

    def test_default_timeout_when_no_env(self):
        from services.ai_service import _ollama_timeout

        assert _ollama_timeout() == 120.0

    def test_env_var_overrides_default(self, monkeypatch):
        monkeypatch.setenv("OLLAMA_TIMEOUT", "180")
        from services.ai_service import _ollama_timeout

        assert _ollama_timeout() == 180.0

    def test_invalid_env_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("OLLAMA_TIMEOUT", "not-a-number")
        from services.ai_service import _ollama_timeout

        assert _ollama_timeout() == 120.0


class TestRetryLogic:
    """Tests for _ollama_post_with_retry() behavior."""

    def test_returns_response_on_success(self):
        from services.ai_service import _ollama_post_with_retry

        mock_resp = AsyncMock(spec=httpx.Response)
        mock_resp.status_code = 200

        async def mock_post(*args, **kwargs):
            return mock_resp

        with patch("services.ai_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.post = mock_post
            mock_instance.__aenter__.return_value = mock_instance
            mock_client_cls.return_value = mock_instance

            import asyncio

            result = asyncio.run(
                _ollama_post_with_retry({"model": "qwen2.5:3b"}, call_label="test")
            )

        assert result is mock_resp

    def test_raises_502_on_connect_error_after_retries(self):
        from services.ai_service import _ollama_post_with_retry

        call_count = [0]

        async def mock_post(*args, **kwargs):
            call_count[0] += 1
            raise httpx.ConnectError("Connection refused")

        with patch("services.ai_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.post = mock_post
            mock_instance.__aenter__.return_value = mock_instance
            mock_client_cls.return_value = mock_instance

            import asyncio

            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(_ollama_post_with_retry({"model": "qwen2.5:3b"}, call_label="test"))

        assert exc_info.value.status_code == 502
        assert "unavailable" in exc_info.value.detail.lower()
        assert call_count[0] == 3  # 3 retries

    def test_raises_502_on_timeout_without_retry(self):
        from services.ai_service import _ollama_post_with_retry

        call_count = [0]

        async def mock_post(*args, **kwargs):
            call_count[0] += 1
            raise httpx.TimeoutException("Request timed out")

        with patch("services.ai_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.post = mock_post
            mock_instance.__aenter__.return_value = mock_instance
            mock_client_cls.return_value = mock_instance

            import asyncio

            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(_ollama_post_with_retry({"model": "qwen2.5:3b"}, call_label="test"))

        assert exc_info.value.status_code == 502
        assert "timed out" in exc_info.value.detail.lower()
        # Timeout must NOT be retried — only 1 attempt
        assert call_count[0] == 1

    def test_retries_on_5xx_then_succeeds(self):
        from services.ai_service import _ollama_post_with_retry

        call_count = [0]

        mock_success = AsyncMock(spec=httpx.Response)
        mock_success.status_code = 200

        async def mock_post(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] < 3:
                fail = AsyncMock(spec=httpx.Response)
                fail.status_code = 503
                return fail
            return mock_success

        with patch("services.ai_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.post = mock_post
            mock_instance.__aenter__.return_value = mock_instance
            mock_client_cls.return_value = mock_instance

            import asyncio

            result = asyncio.run(
                _ollama_post_with_retry({"model": "qwen2.5:3b"}, call_label="test")
            )

        assert result is mock_success
        assert call_count[0] == 3  # 2 fails + 1 success

    def test_raises_502_on_5xx_after_all_retries(self):
        from services.ai_service import _ollama_post_with_retry

        call_count = [0]

        async def mock_post(*args, **kwargs):
            call_count[0] += 1
            fail = AsyncMock(spec=httpx.Response)
            fail.status_code = 503
            return fail

        with patch("services.ai_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.post = mock_post
            mock_instance.__aenter__.return_value = mock_instance
            mock_client_cls.return_value = mock_instance

            import asyncio

            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(_ollama_post_with_retry({"model": "qwen2.5:3b"}, call_label="test"))

        assert exc_info.value.status_code == 502
        assert call_count[0] == 3

    def test_no_retry_on_4xx(self):
        from services.ai_service import _ollama_post_with_retry

        call_count = [0]

        async def mock_post(*args, **kwargs):
            call_count[0] += 1
            fail = AsyncMock(spec=httpx.Response)
            fail.status_code = 400
            return fail

        with patch("services.ai_service.httpx.AsyncClient") as mock_client_cls:
            mock_instance = AsyncMock()
            mock_instance.post = mock_post
            mock_instance.__aenter__.return_value = mock_instance
            mock_client_cls.return_value = mock_instance

            import asyncio

            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(_ollama_post_with_retry({"model": "qwen2.5:3b"}, call_label="test"))

        assert exc_info.value.status_code == 502
        assert call_count[0] == 1  # 4xx is not retried


class TestDockerComposeConfig:
    """Validate docker-compose.yml against GH #245 acceptance criteria."""

    def test_ollama_has_healthcheck_ollama_list(self):
        import yaml
        from pathlib import Path

        compose_path = Path(__file__).resolve().parent.parent.parent / "docker-compose.yml"
        with open(compose_path) as f:
            data = yaml.safe_load(f)

        ollama = data["services"]["ollama"]
        assert "healthcheck" in ollama, "Ollama must have a healthcheck"
        hc = ollama["healthcheck"]
        test_cmd = hc["test"]
        assert any("ollama" in part for part in test_cmd if isinstance(part, str)), (
            f"Healthcheck should call ollama CLI, got {test_cmd}"
        )
        assert any("list" in part for part in test_cmd if isinstance(part, str)), (
            f"Healthcheck should call ollama list, got {test_cmd}"
        )
        assert hc["retries"] >= 30, f"Expected retries >= 30, got {hc['retries']}"

    def test_celery_depends_on_ollama(self):
        import yaml
        from pathlib import Path

        compose_path = Path(__file__).resolve().parent.parent.parent / "docker-compose.yml"
        with open(compose_path) as f:
            data = yaml.safe_load(f)

        celery = data["services"]["celery-worker"]
        deps = celery.get("depends_on", {})
        assert "ollama" in deps, f"celery-worker must depend on ollama, got {list(deps.keys())}"
        assert deps["ollama"]["condition"] == "service_healthy"

    def test_ollama_resources_increased(self):
        import yaml
        from pathlib import Path

        compose_path = Path(__file__).resolve().parent.parent.parent / "docker-compose.yml"
        with open(compose_path) as f:
            data = yaml.safe_load(f)

        ollama = data["services"]["ollama"]
        limits = ollama["deploy"]["resources"]["limits"]
        assert limits["cpus"] in ("4", 4), (
            f"Expected 4 CPUs reserved for Qwen2.5-3B, got {limits['cpus']}"
        )
        assert limits["memory"].lower() in ("6gb", "6g", "6144m"), (
            f"Expected 6GB memory, got {limits['memory']}"
        )
