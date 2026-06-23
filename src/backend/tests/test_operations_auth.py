"""Regression test for EP-29: GET /api/operations must require authentication.

Before the elevation-of-privilege hardening, list_operations had no auth
dependency and returned the full operational dataset to anonymous callers.
It is now gated by get_incident_viewer. This test guards against the gate
being removed again.

Runs in CI (TestClient triggers the app startup DB patches).
"""

from fastapi.testclient import TestClient

from main import app


def test_operations_list_rejects_unauthenticated():
    """An unauthenticated GET /api/operations must NOT return 200 with data."""
    client = TestClient(app)
    resp = client.get("/api/operations")
    assert resp.status_code in (401, 403), (
        f"Expected auth challenge, got {resp.status_code}: anonymous operational "
        "data disclosure regression (EP-29)"
    )
