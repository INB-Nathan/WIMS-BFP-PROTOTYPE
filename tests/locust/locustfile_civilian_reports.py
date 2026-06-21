"""
TC-DS-02: Flood the civilian report endpoint.

Usage (Docker Compose must be running):
    locust -f tests/locust/locustfile_civilian_reports.py \\
           --host http://localhost \\
           --headless -u 50 -r 10 --run-time 60s \\
           --csv tests/locust/results/tc_ds_02

Expected outcome after DoS hardening is in place:
  - Nginx layer (civilian_api zone): >5 r/s sustained from same IP → 429
  - DB layer: >5 reports from same IP within 1 hour → 429 with Retry-After header
  - No 500 errors at any volume

Install locust:
    pip install locust
"""

import random

from locust import HttpUser, between, task

_LAT_MIN, _LAT_MAX = 5.0, 20.0
_LON_MIN, _LON_MAX = 117.0, 126.0
_CATEGORIES = ["STRUCTURAL", "NON_STRUCTURAL", "TRANSPORTATION", "UNSURE"]


class CivilianReportFlood(HttpUser):
    """Simulates many concurrent anonymous reporters hitting the civilian intake endpoint."""

    wait_time = between(0.05, 0.3)

    @task
    def flood_civilian_report(self):
        payload = {
            "latitude": round(random.uniform(_LAT_MIN, _LAT_MAX), 6),
            "longitude": round(random.uniform(_LON_MIN, _LON_MAX), 6),
            "category": random.choice(_CATEGORIES),
        }
        with self.client.post(
            "/api/civilian/reports",
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Origin": "https://wimsbfp.tech",
            },
            catch_response=True,
            name="/api/civilian/reports [flood]",
        ) as resp:
            if resp.status_code in (201, 429):
                resp.success()
            else:
                resp.failure(f"Unexpected status {resp.status_code}: {resp.text[:200]}")


class LegitimateReporter(HttpUser):
    """
    Simulates a low-rate legitimate reporter mixed into the flood.
    Requests from this class should still return 201 if the per-IP 5/hr DB
    limit hasn't been exceeded — used to verify availability under load.
    """

    wait_time = between(5, 15)
    weight = 1

    @task
    def single_report(self):
        payload = {
            "latitude": round(random.uniform(_LAT_MIN, _LAT_MAX), 6),
            "longitude": round(random.uniform(_LON_MIN, _LON_MAX), 6),
            "category": "STRUCTURAL",
        }
        with self.client.post(
            "/api/civilian/reports",
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Origin": "https://wimsbfp.tech",
                "X-Test-Class": "legitimate",
            },
            catch_response=True,
            name="/api/civilian/reports [legitimate]",
        ) as resp:
            if resp.status_code == 201:
                resp.success()
            elif resp.status_code == 429:
                resp.failure(f"Legitimate reporter rate-limited: {resp.text[:200]}")
            else:
                resp.failure(f"Unexpected status {resp.status_code}: {resp.text[:200]}")
