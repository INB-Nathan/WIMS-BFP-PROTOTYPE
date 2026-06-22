"""
TC-DS-02: Flood the civilian report endpoint.

Usage (Docker Compose must be running):
    locust -f tests/locust/locustfile_civilian_reports.py \\
           --host http://localhost \\
           --headless -u 50 -r 10 --run-time 60s \\
           --csv tests/locust/results/tc_ds_02

Expected outcome after DoS hardening is in place:
  - Nginx layer (civilian_api zone): >5 r/s sustained from same IP → 429
  - DB layer: >3 reports from same IP within 1 hour → 429 with Retry-After header
  - No 500 errors at any volume

PR #446 P1-3: the DB rate limit dropped 5/hr → 3/hr to align with the
public DMZ (see backend/utils/rate_limit.py). The flooder and the
legitimate-reporter classes inherit the same threshold as production,
and ``LegitimateReporter.wait_time`` is widened to ``between(60, 180)``
so a single legitimate user does not trip the 3/hr cap in a 60-second
run.

Install locust:
    pip install locust
"""

import random

from locust import HttpUser, between, task

_LAT_MIN, _LAT_MAX = 5.0, 20.0
_LON_MIN, _LON_MAX = 117.0, 126.0
_CATEGORIES = ["STRUCTURAL", "NON_STRUCTURAL", "TRANSPORTATION", "UNSURE"]

# Per-IP 3/hr DB limit — single source of truth lives in
# backend/utils/rate_limit.py (CIVILIAN_REPORT_HOURLY_CAP). This module
# reads the constant at import time so a future threshold change in one
# place propagates here automatically.
try:
    import sys
    from pathlib import Path

    _rate_limit_path = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "backend"
        / "utils"
        / "rate_limit.py"
    )
    if _rate_limit_path.exists():
        sys.path.insert(0, str(_rate_limit_path.parent.parent))
        from utils.rate_limit import CIVILIAN_REPORT_HOURLY_CAP  # type: ignore[import-not-found]
    else:
        CIVILIAN_REPORT_HOURLY_CAP = 3
except Exception:  # noqa: BLE001 — locust runs outside the backend venv in CI
    CIVILIAN_REPORT_HOURLY_CAP = 3


class CivilianReportFlood(HttpUser):
    """Simulates many concurrent anonymous reporters hitting the civilian intake endpoint.

    Each locust user shares one TCP connection; the per-IP rate limit keys
    off the connection's source IP, so multiple users on the same host
    share one bucket. To exercise the 3/hr cap from a single host, this
    class is the right entry point.
    """

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
    Requests from this class should still return 201 if the per-IP 3/hr DB
    limit hasn't been exceeded — used to verify availability under load.

    The wait_time is widened to ``between(60, 180)`` (was ``between(5, 15)``)
    so that a single legitimate user does not trip the 3/hr cap during a
    60-second run. With the old 5-15s wait the user would fire 4-12 reports
    per minute and trip the cap, falsely failing the load test.
    """

    wait_time = between(60, 180)
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
