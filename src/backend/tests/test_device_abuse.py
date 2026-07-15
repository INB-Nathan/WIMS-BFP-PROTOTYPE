"""Tests for utils/device_abuse.py — check_device_abuse() three-tier escalation
(Wayfinder — issue #572).
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, Request

import utils.device_abuse as device_abuse


def _make_request(device_token_hash: str | None = "abc123") -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/civilian/reports",
        "headers": [(b"x-real-ip", b"1.2.3.4")],
        "client": ("1.2.3.4", 12345),
    }
    request = Request(scope)
    request.state.device_token_hash = device_token_hash
    return request


@pytest.fixture(autouse=True)
def _reset_redis_singleton():
    device_abuse._sync_redis = None
    yield


class TestCaptchaRequired:
    @pytest.mark.asyncio
    async def test_missing_token_returns_403(self):
        with pytest.raises(HTTPException) as exc_info:
            await device_abuse.captcha_required(None, "1.2.3.4")
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_empty_token_returns_403(self):
        with pytest.raises(HTTPException) as exc_info:
            await device_abuse.captcha_required("", "1.2.3.4")
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_invalid_token_normalized_to_403(self):
        with patch.object(
            device_abuse,
            "verify_turnstile",
            new=AsyncMock(side_effect=HTTPException(status_code=429, detail="bad token")),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await device_abuse.captcha_required("bad-token", "1.2.3.4")
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_valid_token_passes(self):
        with patch.object(device_abuse, "verify_turnstile", new=AsyncMock(return_value=True)):
            await device_abuse.captcha_required("good-token", "1.2.3.4")  # no raise

    @pytest.mark.asyncio
    async def test_misconfiguration_500_propagates(self):
        with patch.object(
            device_abuse,
            "verify_turnstile",
            new=AsyncMock(side_effect=HTTPException(status_code=500, detail="not configured")),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await device_abuse.captcha_required("token", "1.2.3.4")
        assert exc_info.value.status_code == 500


class TestCheckDeviceAbuse:
    @pytest.mark.asyncio
    async def test_unblocked_device_normal_rate_limit(self):
        request = _make_request(device_token_hash="abc123")
        with (
            patch.object(device_abuse, "verify_turnstile", new=AsyncMock(return_value=True)),
            patch.object(device_abuse, "is_device_blocked", new=AsyncMock(return_value=False)),
            patch.object(device_abuse, "rate_limit_public") as mock_rl,
            patch.object(device_abuse, "_is_quarantined", return_value=False),
        ):
            await device_abuse.check_device_abuse(request, "good-token")

        assert mock_rl.call_args.kwargs["limit"] == device_abuse._NORMAL_RATE_LIMIT
        assert request.state.device_quarantined is False

    @pytest.mark.asyncio
    async def test_blocked_device_tighter_rate_limit(self):
        request = _make_request(device_token_hash="abc123")
        with (
            patch.object(device_abuse, "verify_turnstile", new=AsyncMock(return_value=True)),
            patch.object(device_abuse, "is_device_blocked", new=AsyncMock(return_value=True)),
            patch.object(device_abuse, "rate_limit_public") as mock_rl,
            patch.object(device_abuse, "_is_quarantined", return_value=False),
        ):
            await device_abuse.check_device_abuse(request, "good-token")

        assert mock_rl.call_args.kwargs["limit"] == device_abuse._BLOCKED_RATE_LIMIT

    @pytest.mark.asyncio
    async def test_missing_captcha_token_403_before_rate_limit(self):
        request = _make_request()
        with patch.object(device_abuse, "rate_limit_public") as mock_rl:
            with pytest.raises(HTTPException) as exc_info:
                await device_abuse.check_device_abuse(request, None)
        assert exc_info.value.status_code == 403
        mock_rl.assert_not_called()

    @pytest.mark.asyncio
    async def test_third_violation_triggers_quarantine_unblocked(self):
        """Normal (unblocked) device: 3rd 429 within the window quarantines."""
        fake_redis = MagicMock()
        fake_redis.incr.return_value = 3
        with (
            patch.object(device_abuse, "verify_turnstile", new=AsyncMock(return_value=True)),
            patch.object(device_abuse, "is_device_blocked", new=AsyncMock(return_value=False)),
            patch.object(device_abuse, "_get_sync_redis", return_value=fake_redis),
            patch.object(
                device_abuse,
                "rate_limit_public",
                side_effect=HTTPException(status_code=429, detail="rate limited"),
            ),
        ):
            request = _make_request(device_token_hash="abc123")
            with pytest.raises(HTTPException) as exc_info:
                await device_abuse.check_device_abuse(request, "good-token")

        assert exc_info.value.status_code == 429
        fake_redis.set.assert_called_once_with(
            "device:quarantine:abc123", "1", ex=device_abuse._QUARANTINE_TTL_SECONDS
        )

    @pytest.mark.asyncio
    async def test_blocked_device_quarantines_at_second_violation(self):
        fake_redis = MagicMock()
        fake_redis.incr.return_value = 2
        with (
            patch.object(device_abuse, "verify_turnstile", new=AsyncMock(return_value=True)),
            patch.object(device_abuse, "is_device_blocked", new=AsyncMock(return_value=True)),
            patch.object(device_abuse, "_get_sync_redis", return_value=fake_redis),
            patch.object(
                device_abuse,
                "rate_limit_public",
                side_effect=HTTPException(status_code=429, detail="rate limited"),
            ),
        ):
            request = _make_request(device_token_hash="abc123")
            with pytest.raises(HTTPException):
                await device_abuse.check_device_abuse(request, "good-token")

        fake_redis.set.assert_called_once_with(
            "device:quarantine:abc123", "1", ex=device_abuse._QUARANTINE_TTL_SECONDS
        )

    @pytest.mark.asyncio
    async def test_first_violation_does_not_quarantine(self):
        fake_redis = MagicMock()
        fake_redis.incr.return_value = 1
        with (
            patch.object(device_abuse, "verify_turnstile", new=AsyncMock(return_value=True)),
            patch.object(device_abuse, "is_device_blocked", new=AsyncMock(return_value=False)),
            patch.object(device_abuse, "_get_sync_redis", return_value=fake_redis),
            patch.object(
                device_abuse,
                "rate_limit_public",
                side_effect=HTTPException(status_code=429, detail="rate limited"),
            ),
        ):
            request = _make_request(device_token_hash="abc123")
            with pytest.raises(HTTPException):
                await device_abuse.check_device_abuse(request, "good-token")

        fake_redis.expire.assert_called_once_with("device:abuse:abc123", 3600)
        fake_redis.set.assert_not_called()

    @pytest.mark.asyncio
    async def test_quarantine_flag_read_on_success(self):
        """A device already quarantined from a prior violation still passes
        (quarantine is advisory) but sets device_quarantined=True."""
        request = _make_request(device_token_hash="abc123")
        with (
            patch.object(device_abuse, "verify_turnstile", new=AsyncMock(return_value=True)),
            patch.object(device_abuse, "is_device_blocked", new=AsyncMock(return_value=False)),
            patch.object(device_abuse, "rate_limit_public"),
            patch.object(device_abuse, "_is_quarantined", return_value=True),
        ):
            await device_abuse.check_device_abuse(request, "good-token")

        assert request.state.device_quarantined is True

    @pytest.mark.asyncio
    async def test_no_device_hash_skips_quarantine_bookkeeping(self):
        """Bot/no-cookie clients (no device hash) never touch quarantine keys."""
        request = _make_request(device_token_hash=None)
        with (
            patch.object(device_abuse, "verify_turnstile", new=AsyncMock(return_value=True)),
            patch.object(device_abuse, "is_device_blocked", new=AsyncMock()) as mock_blocked,
            patch.object(
                device_abuse,
                "rate_limit_public",
                side_effect=HTTPException(status_code=429, detail="rate limited"),
            ),
            patch.object(device_abuse, "_record_violation_and_maybe_quarantine") as mock_record,
        ):
            with pytest.raises(HTTPException):
                await device_abuse.check_device_abuse(request, "good-token")

        mock_blocked.assert_not_called()
        mock_record.assert_not_called()
