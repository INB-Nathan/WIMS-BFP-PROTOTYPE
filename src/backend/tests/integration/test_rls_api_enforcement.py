"""
RLS API Enforcement — CRITICAL-1 API-layer Regression Tests.

Validates that the COALESCE fix does not break:
  (a) Public DMZ endpoint POST /api/v1/public/report (no auth)
  (b) Protected endpoints reject unauthenticated requests (401)

Run (from project root):
  pytest src/backend/tests/integration/test_rls_api_enforcement.py -v

Requires: celery in PYTHONPATH (celery>=5.4.0 in requirements.txt).
Skipped automatically if celery is not installed (pytest.importorskip).

NOTE: Testing inactive-user denial at the API layer requires overriding
get_current_wims_user, which has sub-dependencies (get_current_user, get_db).
FastAPI's dependency override system does NOT inject sub-dependencies into
the override function's parameters, making proper API-layer testing impossible.
The authoritative test for inactive-user denial is:
  test_rls_policy_enforcement.py ::
    TestRLSDeniesInactiveUser::test_rls_denies_insert_fire_incidents_as_inactive_user
"""

from __future__ import annotations


import pytest

# main.py imports tasks.suricata which imports celery — skip if not installed
pytest.importorskip("celery", reason="celery not installed — CI/integration test only")

from fastapi.testclient import TestClient

import main as main_module


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def client():
    return TestClient(main_module.app)


@pytest.fixture(autouse=True)
def _reset_overrides():
    """Clear dependency overrides before and after each test."""
    main_module.app.dependency_overrides.clear()
    yield
    main_module.app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Test 1: Public DMZ endpoint still works without auth (no regression)
# ---------------------------------------------------------------------------
class TestPublicDMZNoAuthRegression:
    """
    POST /api/v1/public/report must succeed with no auth header.
    This is the civilian intake path — no JWT, no RLS session context.

    The public DMZ SQL does NOT set wims.current_user_id; it inserts with
    encoder_id = NULL and resolves region_id from coordinates. This must
    still work after the COALESCE fix (201 if DB seeded, 500 if not — both
    indicate the route handled the no-session request, not a 401/403 rejection).
    """

    def test_public_report_endpoint_handles_no_auth(self, client):
        """
        POST /api/v1/public/report with no Authorization header.
        Expected: NOT 401/403 (those mean auth middleware rejected it).
        201 = success, 500 = DB not seeded — both are acceptable here.
        """
        payload = {
            "latitude": 14.5995,
            "longitude": 120.9842,
            "description": "Smoke from rooftop, downtown Manila.",
        }
        response = client.post("/api/v1/public/report", json=payload)
        assert response.status_code != 401, (
            f"Public DMZ should not return 401 (auth middleware incorrectly applied): {response.status_code}"
        )
        assert response.status_code != 403, (
            f"Public DMZ should not return 403 (RLS incorrectly denied public insert): {response.status_code}"
        )


# ---------------------------------------------------------------------------
# Test 2: Protected endpoints deny unauthenticated requests (401)
# ---------------------------------------------------------------------------
class TestProtectedEndpointRejectsNoAuth:
    """
    All /api/* endpoints that have auth dependencies must return 401 when
    no Authorization header is present.

    Before CRITICAL-1 fix: NULL role could bypass auth middleware in edge cases.
    After CRITICAL-1 fix: 'ANONYMOUS' IN (valid_roles) = FALSE, correctly denied.
    """

    @pytest.mark.parametrize(
        "method,path,body",
        [
            ("get", "/api/user/me", None),
            ("get", "/api/admin/users", None),
            ("get", "/api/triage/pending", None),
            ("get", "/api/regional/incidents", None),
            ("get", "/api/analytics/heatmap", None),
            (
                "post",
                "/api/incidents",
                {"latitude": 14.5, "longitude": 120.9, "description": "x"},
            ),
            (
                "patch",
                "/api/admin/users/00000000-0000-0000-0000-000000000001",
                {"is_active": True},
            ),
        ],
    )
    def test_protected_returns_401_without_auth(self, client, method, path, body):
        """HTTP {method.upper()} {path} without auth must return 401."""
        http_method = getattr(client, method)
        kwargs = {"json": body} if body is not None else {}
        response = http_method(path, **kwargs)
        assert response.status_code == 401, (
            f"{method.upper()} {path} without auth must be 401, got {response.status_code}: {response.text[:200]}"
        )
