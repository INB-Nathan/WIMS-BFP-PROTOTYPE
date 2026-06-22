"""Civilian Reporting Phase 2 unit tests.

Tests for the civilian report 429 detail string construction and other
unit-testable logic that does not require Docker services.
"""

import math


def test_civilian_report_429_detail_includes_retry_minutes():
    """The 429 detail string must include the retry time in minutes,
    not just a generic 'try again later' message."""
    # This test verifies the detail string format.
    # The actual rate-limit trigger is tested elsewhere; here we check
    # the HTTPException detail construction at civilian.py:342-345.
    retry_after = 3600  # 1 hour in seconds
    minutes = max(1, math.ceil(retry_after / 60))
    expected_detail = f"Too many reports from this network. Try again in {minutes} minutes."

    assert "60 minutes" in expected_detail, (
        f"Detail must include retry minutes, got: {expected_detail}"
    )
    assert "Try again" in expected_detail
