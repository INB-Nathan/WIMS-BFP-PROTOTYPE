"""Shared rate-limit constants — single source of truth.

PR #446 P1-4: extracted from inline literals across the civilian / public DMZ
routes so the threshold drop (5 → 3) and the Retry-After floor/ceiling cannot
drift between code, tests, and the locust docstring.

All values are pure constants (no I/O, no environment) so they can be safely
imported from any module — route handler, test, locust file, admin script.
"""

# ---------------------------------------------------------------------------
# Civilian reports (DB-backed rate limit; see civilian.py submit + followup)
# ---------------------------------------------------------------------------
# 3/hr is aligned with the public DMZ (PUBLIC_REPORT_HOURLY_CAP) so the two
# unauthenticated surfaces share a single abuse-detection profile (gap #14).
CIVILIAN_REPORT_HOURLY_CAP: int = 3
CIVILIAN_REPORT_RATE_LIMIT_WINDOW_SECONDS: int = 3600

# ---------------------------------------------------------------------------
# Public DMZ (Redis-backed sliding-window rate limit; see public_dmz.py)
# ---------------------------------------------------------------------------
PUBLIC_REPORT_HOURLY_CAP: int = 3
PUBLIC_REPORT_RATE_LIMIT_WINDOW_SECONDS: int = 3600

# ---------------------------------------------------------------------------
# Retry-After header bounds
# ---------------------------------------------------------------------------
# The Retry-After header is computed as
#   max(RETRY_AFTER_FLOOR_SECONDS, math.ceil((oldest + 1h - now).total_seconds()))
# The lower bound prevents 0/negative values (which the HTTP spec disallows).
# The upper bound prevents a clock-skewed or stale row from advising the
# client to wait longer than the actual rate-limit window (P1-6).
RETRY_AFTER_FLOOR_SECONDS: int = 1
RETRY_AFTER_CEILING_SECONDS: int = 3600

# ---------------------------------------------------------------------------
# Registered civilian reporter rate limit (DB-backed; see civilian.py submit_civilian_report)
# Registered CIVILIAN_REPORTER users get a higher cap (20/hr) than anonymous (3/hr).
REGISTERED_REPORT_HOURLY_CAP: int = 20

# ---------------------------------------------------------------------------
# Per-report follow-up cap (DB-backed; see civilian.py submit_civilian_followup)
# ---------------------------------------------------------------------------
# Follow-ups are intentionally tighter than new reports to limit spam on a
# single report thread. Kept here so the threshold and the test fixture can
# be updated in one place (P2-15 has a question about whether followups
# should also drop to 3/hr; track there).
CIVILIAN_FOLLOWUP_PER_REPORT_HOURLY_CAP: int = 5
CIVILIAN_FOLLOWUP_PER_IP_HOURLY_CAP: int = 10
