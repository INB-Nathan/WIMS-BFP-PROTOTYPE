"""
Tests for CSRF protection middleware (__Host- cookies + Origin/Referer validation).
Module 11b — Penetration Testing Scope: CSRF.
"""

import pytest
from fastapi.testclient import TestClient
from main import app

from utils.csrf import _normalize_origin, _build_allowlist

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_csrf_cache():
    """Force csrf module to rebuild its allowlist from current env on next request."""
    import utils.csrf as m

    m._allowed_origins = None
    yield
    m._allowed_origins = None


@pytest.fixture(autouse=True)
def _disable_rate_limiter(monkeypatch: pytest.MonkeyPatch):
    """Mock Redis unavailable so the rate-limiter fail-opens for every test.
    Without this, repeated POSTs to /api/auth/login hit the sliding-window
    threshold (5 req/15min) and return 429 instead of the expected CSRF or auth response.
    """

    async def _mock_redis_unavailable():
        return None

    monkeypatch.setattr("main._get_redis", _mock_redis_unavailable)
    yield


@pytest.fixture(autouse=True)
def _enable_csrf(monkeypatch: pytest.MonkeyPatch):
    """Override the global conftest WIMS_CSRF_DISABLED=1 — CSRF must be active for these tests."""
    monkeypatch.setenv("WIMS_CSRF_DISABLED", "0")
    yield


CLIENT = TestClient(app)

# ---------------------------------------------------------------------------
# Unit: URL normalization
# ---------------------------------------------------------------------------


class TestOriginNormalization:
    def test_strips_path(self):
        assert _normalize_origin("https://localhost/callback") == "https://localhost"

    def test_strips_query(self):
        assert _normalize_origin("http://wimsbfp.tech/api?foo=1") == "http://wimsbfp.tech"

    def test_preserves_port(self):
        assert _normalize_origin("http://localhost:3000") == "http://localhost:3000"

    def test_https_localhost(self):
        assert _normalize_origin("https://localhost:443") == "https://localhost:443"

    def test_handles_evil_domain(self):
        assert _normalize_origin("https://evil.com:8080/path") == "https://evil.com:8080"


# ---------------------------------------------------------------------------
# Unit: allowlist builder
# ---------------------------------------------------------------------------


class TestAllowlistBuilder:
    def test_from_csrf_trusted_origins(self):
        with pytest.MonkeyPatch.context() as mp:
            mp.setenv("CSRF_TRUSTED_ORIGINS", "https://wimsbfp.tech,http://localhost:3000")
            result = _build_allowlist()
        assert "https://wimsbfp.tech" in result
        assert "http://localhost:3000" in result

    def test_falls_back_to_defaults(self):
        with pytest.MonkeyPatch.context() as mp:
            mp.delenv("CSRF_TRUSTED_ORIGINS", raising=False)
            mp.delenv("CSRF_TRUSTED_HOST", raising=False)
            result = _build_allowlist()
        assert "http://localhost" in result
        assert "https://localhost" in result

    def test_from_csrf_trusted_host(self):
        with pytest.MonkeyPatch.context() as mp:
            mp.delenv("CSRF_TRUSTED_ORIGINS", raising=False)
            mp.setenv("CSRF_TRUSTED_HOST", "wimsbfp.tech")
            result = _build_allowlist()
        assert "https://wimsbfp.tech" in result
        assert "http://wimsbfp.tech" in result


# ---------------------------------------------------------------------------
# Integration: safe methods bypass
# ---------------------------------------------------------------------------


class TestSafeMethods:
    def test_get_bypasses_csrf(self):
        resp = CLIENT.get("/health", headers={})
        assert resp.status_code in (200,)

    def test_head_bypasses_csrf(self):
        resp = CLIENT.head("/health", headers={})
        assert resp.status_code in (200, 405)

    def test_options_bypasses_csrf(self):
        resp = CLIENT.options("/health", headers={})
        assert resp.status_code in (200, 405)

    def test_get_to_state_changing_route(self):
        """GET on a state-changing route (not safe-method exempt) — middleware should NOT block."""
        # GET /api/auth/login doesn't exist but should bypass CSRF
        resp = CLIENT.get("/api/auth/login", headers={})
        assert resp.status_code != 403  # Not CSRF-blocked


# ---------------------------------------------------------------------------
# Integration: POST with Origin validation
# ---------------------------------------------------------------------------


class TestPostOriginValidation:
    def test_post_rejected_without_origin(self):
        """POST with neither Origin nor Referer → 403"""
        resp = CLIENT.post("/api/auth/login", json={}, headers={})
        assert resp.status_code == 403
        assert "CSRF validation failed" in resp.text

    def test_post_rejected_invalid_origin(self):
        """POST from evil.com → 403"""
        resp = CLIENT.post(
            "/api/auth/login",
            json={},
            headers={"origin": "https://evil.com"},
        )
        assert resp.status_code == 403
        assert "CSRF validation failed" in resp.text

    def test_post_rejected_malformed_origin(self):
        """POST from gibberish origin → 403"""
        resp = CLIENT.post(
            "/api/auth/login",
            json={},
            headers={"origin": "this-is-not-a-url"},
        )
        assert resp.status_code == 403

    def test_post_accepted_with_valid_origin(self):
        """POST from localhost → passes CSRF (hits route handler)"""
        resp = CLIENT.post(
            "/api/auth/login",
            json={},
            headers={"origin": "http://localhost"},
        )
        # Should not be 403 — CSRF passed. 401 from stub auth is expected.
        assert resp.status_code != 403
        assert resp.status_code == 401

    def test_post_accepted_with_https_localhost(self):
        """POST from https://localhost → passes CSRF"""
        resp = CLIENT.post(
            "/api/auth/login",
            json={},
            headers={"origin": "https://localhost"},
        )
        assert resp.status_code == 401  # stub auth, not CSRF block

    def test_post_with_referer_valid(self):
        """POST with only Referer (matching localhost) → passes CSRF"""
        resp = CLIENT.post(
            "/api/auth/login",
            json={},
            headers={"referer": "http://localhost/login"},
        )
        assert resp.status_code == 401  # stub auth, not CSRF block


# ---------------------------------------------------------------------------
# Integration: PUT, PATCH, DELETE
# ---------------------------------------------------------------------------


class TestOtherUnsafeMethods:
    def test_put_rejected_invalid_origin(self):
        """PUT with invalid origin → 403"""
        resp = CLIENT.put(
            "/api/auth/login",
            json={},
            headers={"origin": "https://evil.com"},
        )
        assert resp.status_code == 403

    def test_patch_rejected_invalid_origin(self):
        """PATCH with invalid origin → 403"""
        resp = CLIENT.patch(
            "/api/auth/login",
            json={},
            headers={"origin": "https://attacker.org"},
        )
        assert resp.status_code == 403

    def test_delete_rejected_invalid_origin(self):
        """DELETE with invalid origin → 403"""
        resp = CLIENT.delete(
            "/api/auth/login",
            headers={"origin": "https://evil.net"},
        )
        assert resp.status_code == 403

    def test_put_accepted_valid_referer(self):
        """PUT with valid Referer → passes CSRF"""
        resp = CLIENT.put(
            "/api/auth/login",
            json={},
            headers={"referer": "https://localhost/"},
        )
        assert resp.status_code != 403

    def test_patch_accepted_valid_origin(self):
        """PATCH with valid Origin → passes CSRF"""
        resp = CLIENT.patch(
            "/api/auth/login",
            json={},
            headers={"origin": "http://localhost"},
        )
        assert resp.status_code != 403


# ---------------------------------------------------------------------------
# Integration: VPS production origin
# ---------------------------------------------------------------------------


class TestProductionOrigin:
    def test_post_accepted_vps_origin(self):
        """POST from https://wimsbfp.tech when configured as trusted → passes CSRF"""
        with pytest.MonkeyPatch.context() as mp:
            mp.setenv("CSRF_TRUSTED_ORIGINS", "https://wimsbfp.tech")
            import utils.csrf as m

            m._allowed_origins = None
            resp = CLIENT.post(
                "/api/auth/login",
                json={},
                headers={"origin": "https://wimsbfp.tech"},
            )
        assert resp.status_code != 403

    def test_post_rejected_vps_port_variation(self):
        """POST from https://wimsbfp.tech:8443 when only wimsbfp.tech is trusted → 403"""
        with pytest.MonkeyPatch.context() as mp:
            mp.setenv("CSRF_TRUSTED_ORIGINS", "https://wimsbfp.tech")
            import utils.csrf as m

            m._allowed_origins = None
            resp = CLIENT.post(
                "/api/auth/login",
                json={},
                headers={"origin": "https://wimsbfp.tech:8443"},
            )
        assert resp.status_code == 403
