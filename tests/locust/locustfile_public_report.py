"""
TC-DS-01: Flood the public report endpoint.

Usage (Docker Compose must be running):
    locust -f tests/locust/locustfile_public_report.py \\
           --host http://localhost \\
           --headless -u 50 -r 10 --run-time 60s \\
           --csv tests/locust/results/tc_ds_01

Expected outcome after DoS hardening is in place:
  - 1st–3rd request per IP within 1 hour → 201 Created
  - 4th+ request per IP within 1 hour    → 429 Too Many Requests
  - Nginx burst (>10 r/s from same IP)   → 429 (Nginx layer, before app)
  - No 500 errors at any volume

Install locust:
    pip install locust
"""

import random

from locust import HttpUser, between, task


class PublicReportFlood(HttpUser):
    """Simulates many concurrent anonymous reporters hitting the public intake endpoint."""

    wait_time = between(0.05, 0.3)

    @task
    def flood_public_report(self):
        payload = {
            "latitude": round(random.uniform(5.0, 20.0), 6),
            "longitude": round(random.uniform(117.0, 126.0), 6),
            "description": "Automated DoS penetration test — flood scenario TC-DS-01.",
        }
        with self.client.post(
            "/api/v1/public/report",
            json=payload,
            headers={"Content-Type": "application/json"},
            catch_response=True,
            name="/api/v1/public/report [flood]",
        ) as resp:
            if resp.status_code in (201, 429):
                resp.success()
            else:
                resp.failure(f"Unexpected status {resp.status_code}: {resp.text[:200]}")


class LegitimateReporter(HttpUser):
    """
    Simulates a low-rate legitimate reporter mixed into the flood.
    Requests from this class should still get 201 if the per-IP limit
    hasn't been exceeded — used to verify service availability under load.
    """

    wait_time = between(5, 15)
    weight = 1

    @task
    def single_report(self):
        payload = {
            "latitude": round(random.uniform(5.0, 20.0), 6),
            "longitude": round(random.uniform(117.0, 126.0), 6),
            "description": "Legitimate report submitted during flood test.",
        }
        with self.client.post(
            "/api/v1/public/report",
            json=payload,
            headers={"Content-Type": "application/json", "X-Test-Class": "legitimate"},
            catch_response=True,
            name="/api/v1/public/report [legitimate]",
        ) as resp:
            if resp.status_code == 201:
                resp.success()
            elif resp.status_code == 429:
                resp.failure(f"Legitimate reporter rate-limited: {resp.text[:200]}")
            else:
                resp.failure(f"Unexpected status {resp.status_code}: {resp.text[:200]}")
