"""Verify the public consent rate limiter keys on X-Real-IP, not spoofed XFF."""

from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from main import app
from database import get_db
import pytest


class MockRow:
    """Simulate a SQLAlchemy Row that supports indexed access by position."""

    def __getitem__(self, idx):
        return [1, "USER", "test-user", "data_processing", "GRANTED", "2026-06-22T00:00:00"][idx]


class TestConsentRateLimitKeysOnXRealIP:
    """PR #446 follow-up: consent.py must use trusted_client_ip, not get_client_ip."""

    def test_consent_rate_limit_uses_x_real_ip_not_xff(self):
        """Spoofed X-Forwarded-For must NOT be passed to rate_limit_public."""
        client = TestClient(app)

        try:
            mock_result = MagicMock()
            mock_result.fetchone.return_value = MockRow()
            mock_db = MagicMock()
            mock_db.execute.return_value = mock_result
            app.dependency_overrides[get_db] = lambda: mock_db

            with (
                patch("api.routes.consent.rate_limit_public") as mock_rl,
                patch("api.routes.consent.get_redis_client", return_value=MagicMock()),
            ):
                client.post(
                    "/api/auth/consent",
                    json={
                        "subject_type": "USER",
                        "subject_id": "test-user",
                        "consent_type": "data_processing",
                        "action": "GRANTED",
                    },
                    headers={
                        "X-Forwarded-For": "1.2.3.4",  # spoofed
                        "X-Real-IP": "5.6.7.8",  # trustworthy
                    },
                )
        finally:
            app.dependency_overrides.clear()

        # rate_limit_public(redis_client, ip, key_prefix, limit, window)
        # The ip argument is the 2nd positional arg (index 1)
        assert mock_rl.called, "rate_limit_public was not called"
        ip_arg = mock_rl.call_args[0][1]
        assert ip_arg == "5.6.7.8", (
            f"Consent rate limiter must use X-Real-IP (5.6.7.8), got: {ip_arg}"
        )

    @pytest.mark.unit
    def test_consent_denies_when_rate_limiter_raises(self):
        """A9 — when rate_limit_public raises, the route must DENY (5xx), not 201.

        The consent route calls rate_limit_public before any DB write and does
        not wrap it in try/except, so a raised HTTPException (e.g. the
        fail-closed 503 when Redis is unavailable, or 429 when over limit)
        propagates as the response. We assert the route does NOT return 201 and
        instead returns a deny status.

        A trusted Origin header is required so the CSRF middleware lets the
        request reach the route (http://localhost:8000 is a default trusted
        origin).
        """
        from fastapi import HTTPException

        client = TestClient(app)

        try:
            mock_result = MagicMock()
            mock_result.fetchone.return_value = MockRow()
            mock_db = MagicMock()
            mock_db.execute.return_value = mock_result
            app.dependency_overrides[get_db] = lambda: mock_db

            with (
                patch(
                    "api.routes.consent.rate_limit_public",
                    side_effect=HTTPException(status_code=503, detail="redis unavailable"),
                ),
                patch("api.routes.consent.get_redis_client", return_value=MagicMock()),
            ):
                resp = client.post(
                    "/api/auth/consent",
                    json={
                        "subject_type": "USER",
                        "subject_id": "test-user",
                        "consent_type": "data_processing",
                        "action": "GRANTED",
                    },
                    headers={
                        "X-Real-IP": "5.6.7.8",
                        "Origin": "http://localhost:8000",
                    },
                )
        finally:
            app.dependency_overrides.clear()

        # Deny, never 201. 503 is the fail-closed Redis-unavailable path.
        assert resp.status_code != 201
        assert resp.status_code in (429, 503)
