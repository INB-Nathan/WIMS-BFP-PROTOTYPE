"""
Zero-Trust Civilian Reporting Portal — Integration Tests (RED State).

Test 1: Public can submit report with no auth. Assert 201, trust_score=0, status=PENDING.
Test 2: Invalid coordinates (lat 150.0) rejected with 422.

Run: pytest backend/tests/integration/test_civilian_api.py -v
With DB: cd src && docker compose run --rm backend pytest backend/tests/integration/test_civilian_api.py -v
"""

from __future__ import annotations

import sys
import os

# Ensure backend is on path when running from src/
sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


class TestCivilianReportPublicSubmission:
    """POST /api/civilian/reports — no auth required."""

    def test_public_can_submit_report(self):
        """
        POST /api/civilian/reports with no auth header.
        Payload: valid lat/lng and description.
        Assert 201 Created, trust_score is exactly 0, status is 'PENDING'.
        """
        payload = {
            "latitude": 14.5995,
            "longitude": 120.9842,
            "description": "Smoke visible from rooftop, possible fire.",
        }
        response = client.post(
            "/api/civilian/reports",
            json=payload,
            headers={},  # No Authorization
        )
        assert response.status_code == 201, (
            f"Expected 201 Created, got {response.status_code}: {response.text}"
        )
        data = response.json()
        assert data.get("trust_score") == 0, (
            f"Zero-trust: trust_score must be 0 for unauthenticated submission, got {data.get('trust_score')}"
        )
        assert data.get("status") == "PENDING", (
            f"New reports must be PENDING, got {data.get('status')}"
        )
        assert "report_id" in data
        assert "latitude" in data
        assert "longitude" in data

    def test_invalid_coordinates_rejected(self):
        """
        POST /api/civilian/reports with latitude 150.0 (out of range -90..90).
        Assert 422 Unprocessable Entity (Pydantic validation).
        """
        payload = {
            "latitude": 150.0,  # Invalid: must be -90 to 90
            "longitude": 120.9842,
            "description": "Test report.",
        }
        response = client.post(
            "/api/civilian/reports",
            json=payload,
            headers={},
        )
        assert response.status_code == 422, (
            f"Expected 422 for invalid coordinates, got {response.status_code}: {response.text}"
        )
