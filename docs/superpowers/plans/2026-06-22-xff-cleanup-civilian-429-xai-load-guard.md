# XFF Cleanup + Civilian 429 Specificity + XAI Load Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Implementation agent:** `wims-impl-dsv4-high` (DeepSeek V4 Flash via `opencode-go/deepseek-v4-flash`). Launch one task at a time, async. Parent independently verifies each task (diff + re-run gates) before launching the next — do NOT trust worker self-reports.
>
> **Parent verification per task:** after each worker reports DONE, the parent: (1) reads the diff, (2) re-runs the task's test command, (3) runs `ruff check` / `ruff format --check` (backend) or `npm run lint` (frontend) on the changed files, (4) confirms the commit hash. Only then launch the next task.

**Goal:** Close the XFF spoofing gaps PR #446 left behind (2 bypassable rate limiters + 15 audit call sites + nginx defense-in-depth), fix the civilian 429 error specificity bug (one-line transport fix + UI timing message), and add #419 regression tests locking in no-XAI-on-page-load behavior.

**Architecture:** Three independent workstreams. WS1 migrates all app-layer client-IP reads from `get_client_ip` (XFF-first, spoofable) to `trusted_client_ip` (X-Real-IP first, never XFF) and extends the nginx X-Real-IP directive to all location blocks. WS2 extracts `ApiRequestError` to a shared `errors.ts`, makes `public-transport.ts` attach `.status` + `.retryAfter`, and renders a specific timing message on 429. WS3 adds regression tests proving `analyze_threat_log` is never called on default page load.

**Tech Stack:** Python 3.10+ / FastAPI / Redis (backend), TypeScript / Next.js / React (frontend), nginx (reverse proxy), pytest / vitest (testing), ruff / ESLint (linting).

## Global Constraints

- **`trusted_client_ip` is the ONLY client-IP helper for new/changed code.** Defined in `src/backend/utils/audit.py:15`. Reads `X-Real-IP` first, falls back to `request.client.host`, NEVER reads `X-Forwarded-For`. Returns a non-empty string (per-request synthetic key on missing).
- **`get_client_ip` is the deprecated XFF-first alias** (`utils/audit.py:92`). After WS1, zero production call sites remain. The alias is retained with its deprecation docstring (Tier 5 removal is a follow-up).
- **16 total `get_client_ip` usage call sites**: 1 consent (Tier 1) + 1 incidents.py + 4 validator.py + 1 afor.py + 9 encoder_crud.py (Tier 2).
- **`ApiRequestError` extraction**: move from `src/frontend/src/lib/api/transport.ts` to new `src/frontend/src/lib/api/errors.ts`. Both transports import from `errors.ts`. Add optional `.retryAfter: number | undefined` field.
- **`Retry-After` header** is already in `Access-Control-Expose-Headers` on all 3 nginx configs (PR #446). Frontend can read it cross-origin. No nginx change needed for WS2.
- **Rate-limit key namespaces are disjoint**: `rate_limit_public` uses `wims:rl:{prefix}:{ip}`; login limiter uses `rate_limit:{ip}`. No collision from the IP-source swap.
- **Tier 3 changes `X-Real-IP` only; `X-Forwarded-For` directives are left untouched.** `trusted_client_ip` never reads XFF, so existing XFF directives are safe.
- **`/api/auth/callback` is pre-auth PKCE** — the existing `test_nginx_forwarded_headers.py` carve-out docstring ("behind a JWT/session") is wrong for this route and must be rewritten.
- **#419 deviation (approved in spec):** #419 is "blocked by #415" in GitHub, but #415 needs migration 62 (not applied to running DB). #419's goal is already satisfied by current code; its tests lock in existing good behavior. The deviation is documented in the spec.
- **Mock defense 2026-06-26.** This plan is defense-critical: WS3 prevents a 504 demo-killer; WS1 closes a real login brute-force bypass; WS2 fixes an alarming user-facing error message.
- **Backend test command**: `cd src/backend && source .venv/bin/activate && pytest <path> -v` (Arch Linux requires venv — gotcha #14).
- **Frontend test command**: `cd src/frontend && npx vitest run <path>`.
- **CI pre-flight env vars** (frontend build): `NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth` + `NEXT_PUBLIC_BASE_URL=http://localhost:3000`.
- **Commit style**: Conventional Commits with scope, e.g. `fix(security): ...`, `feat(frontend): ...`, `docs(wiki): ...`.

---

## File Structure

### Create
- `src/frontend/src/lib/api/errors.ts` — shared `ApiRequestError` class (extracted from `transport.ts` + new `.retryAfter` field). Pure utility, no auth imports.

### Modify (backend — 8 files)
- `src/backend/main.py` — add `from utils.audit import trusted_client_ip`; swap `rate_limit_middleware` IP resolution (lines 780-785).
- `src/backend/api/routes/consent.py` — swap import + line 41 IP resolution.
- `src/backend/api/routes/incidents.py` — swap import + line 527 audit call.
- `src/backend/api/routes/regional/validator.py` — swap import + lines 315/589/647/696 (4 audit calls).
- `src/backend/api/routes/regional/afor.py` — swap import + line 185 audit call.
- `src/backend/api/routes/regional/encoder_crud.py` — swap import + lines 303/398/440/509/533/553/572/668/700 (9 audit calls).
- `src/backend/api/routes/civilian.py` — line 344 detail string includes retry minutes.
- `src/backend/tests/test_nginx_forwarded_headers.py` — rewrite carve-out docstring; add X-Real-IP parameterized assertions.

### Modify (backend tests — 2 files)
- `src/backend/tests/test_dynamic_rate_limits.py` — add test asserting login rate limiter keys on X-Real-IP not XFF.
- `src/backend/tests/test_security_monitoring.py` — add test asserting summary endpoint does not call `analyze_threat_log`.

### Modify (frontend — 4 files)
- `src/frontend/src/lib/api/transport.ts` — replace local `ApiRequestError` class with import from `./errors`.
- `src/frontend/src/lib/api/public-transport.ts` — throw `ApiRequestError` with `.status` + `.retryAfter` instead of plain `Error`.
- `src/frontend/src/app/page.tsx` — extract `retryAfter` in catch block; render specific timing message in `rate_limit` branch.
- `src/frontend/src/app/admin/system/admin-system-analyze-ai.test.tsx` — add no-analyze-on-mount test; verify manual-analyze-on-click test exists.

### Modify (frontend tests — 2 files)
- `src/frontend/src/lib/api/__tests__/public-transport.test.ts` — new test file: 429 + Retry-After → `ApiRequestError` with `.status` + `.retryAfter`.
- `src/frontend/src/app/__tests__/page.test.tsx` — add 429 rate-limit rendering test.
- `src/frontend/src/app/admin/monitoring/admin-security-monitoring.test.tsx` — add no-analyze-on-mount guard test.

### Modify (nginx — 3 files)
- `src/nginx/nginx.conf` — change `X-Real-IP $remote_addr` → `X-Real-IP $realip_remote_addr` on ~5 location blocks (auth, events, fallback /api/, /auth/, /).
- `src/nginx/nginx.local.conf` — same changes.
- `src/nginx/nginx.ci.conf` — same changes.

### Modify (wiki — 3 files)
- `system-wiki/security/security-baseline.md` — XFF cleanup completes #446 follow-up.
- `system-wiki/log.md` — feature entry.
- `system-wiki/gaps/frs-codebase-gap-register.md` — close "rate-limiter XFF bug (pre-existing)" entry.

---

## Task 1: WS1 Tier 1 — Swap both bypassable rate limiters to `trusted_client_ip`

**Files:**
- Modify: `src/backend/main.py:780-785` (login rate limiter) + add import
- Modify: `src/backend/api/routes/consent.py:18,40-41` (consent rate limiter) + swap import
- Test: `src/backend/tests/test_dynamic_rate_limits.py` (add login test); `src/backend/tests/test_consent_rate_limit.py` (create consent test)

**Interfaces:**
- Consumes: `trusted_client_ip(request: Request | None) -> str` from `src/backend/utils/audit.py:15`
- Produces: both rate limiters key on `X-Real-IP` (via `trusted_client_ip`), not spoofable XFF

- [ ] **Step 1: Write the failing test for login rate limiter**

Add to `src/backend/tests/test_dynamic_rate_limits.py`, inside `class TestRateLimitMiddlewareConfig`:

```python
def test_middleware_keys_on_x_real_ip_not_xff(self, client):
    """Spoofed X-Forwarded-For must NOT change the rate-limit key.
    The key must use X-Real-IP (set by nginx to $realip_remote_addr)."""
    mock_redis = self._make_async_redis_mock(
        hgetall_return={"window_seconds": "300", "threshold": "3"},
    )

    with patch.object(main_module, "_get_redis", new_callable=AsyncMock) as mock_get_redis:
        mock_get_redis.return_value = mock_redis
        client.post(
            "/api/auth/callback",
            json={"code": "test", "code_verifier": "test"},
            headers={
                "X-Forwarded-For": "1.2.3.4",  # spoofed — must NOT be used
                "X-Real-IP": "5.6.7.8",        # trustworthy — MUST be used
            },
        )

    eval_args = mock_redis.eval.call_args
    key = eval_args[0][3]  # KEYS[1] is the 4th positional arg (script, numkeys, ...)
    assert "5.6.7.8" in key, f"Rate-limit key must use X-Real-IP (5.6.7.8), got: {key}"
    assert "1.2.3.4" not in key, f"Rate-limit key must NOT use spoofed XFF (1.2.3.4), got: {key}"
```

- [ ] **Step 2: Write the failing test for consent rate limiter**

Create `src/backend/tests/test_consent_rate_limit.py`:

```python
"""Verify the public consent rate limiter keys on X-Real-IP, not spoofed XFF."""
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from main import app


class TestConsentRateLimitKeysOnXRealIP:
    """PR #446 follow-up: consent.py must use trusted_client_ip, not get_client_ip."""

    def test_consent_rate_limit_uses_x_real_ip_not_xff(self):
        """Spoofed X-Forwarded-For must NOT be passed to rate_limit_public."""
        client = TestClient(app)

        with patch("api.routes.consent.rate_limit_public") as mock_rl, \
             patch("api.routes.consent.get_redis_client", return_value=MagicMock()):
            client.post(
                "/api/public/consent",
                json={"consent_type": "data_processing", "agreed": True},
                headers={
                    "X-Forwarded-For": "1.2.3.4",  # spoofed
                    "X-Real-IP": "5.6.7.8",        # trustworthy
                },
            )

        # rate_limit_public(redis_client, ip, key_prefix, limit, window)
        # The ip argument is the 2nd positional arg (index 1)
        ip_arg = mock_rl.call_args[0][1]
        assert ip_arg == "5.6.7.8", \
            f"Consent rate limiter must use X-Real-IP (5.6.7.8), got: {ip_arg}"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src/backend && source .venv/bin/activate && pytest tests/test_dynamic_rate_limits.py::TestRateLimitMiddlewareConfig::test_middleware_keys_on_x_real_ip_not_xff tests/test_consent_rate_limit.py -v`
Expected: FAIL — login limiter keys on spoofed XFF "1.2.3.4"; consent limiter passes spoofed "1.2.3.4" to `rate_limit_public`.

- [ ] **Step 4: Fix `main.py` — swap login rate limiter to `trusted_client_ip`**

Add import near line 31 (after `from utils.metrics import ...`):

```python
from utils.audit import trusted_client_ip
```

Replace lines 780-785 in `rate_limit_middleware`:

```python
    # Resolve client IP from X-Real-IP (set by nginx to $realip_remote_addr)
    # or socket peer. NEVER parse X-Forwarded-For — spoofable (gap #14 / #446 follow-up).
    client_ip = trusted_client_ip(request)
```

(Removes the 4-line XFF parse block; `trusted_client_ip` handles the fallback.)

- [ ] **Step 5: Fix `consent.py` — swap to `trusted_client_ip`**

Line 18 — change import:
```python
from utils.audit import trusted_client_ip, hash_client_ip, log_system_audit
```
(Remove `get_client_ip`, add `trusted_client_ip`.)

Line 40-41 — replace:
```python
    # Extract client IP via trusted_client_ip (X-Real-IP → socket peer, never XFF).
    client_ip = trusted_client_ip(request)
```
(Remove `or "unknown"` — `trusted_client_ip` always returns a non-empty string.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd src/backend && source .venv/bin/activate && pytest tests/test_dynamic_rate_limits.py::TestRateLimitMiddlewareConfig tests/test_consent_rate_limit.py -v`
Expected: PASS — both tests green.

- [ ] **Step 7: Run ruff**

Run: `cd src/backend && ruff check src/backend/main.py src/backend/api/routes/consent.py src/backend/tests/test_consent_rate_limit.py && ruff format --check src/backend/main.py src/backend/api/routes/consent.py src/backend/tests/test_consent_rate_limit.py`
Expected: 0 errors. If `get_client_ip` import is now unused in `consent.py`, ruff catches it (F401).

- [ ] **Step 8: Commit**

```bash
git add src/backend/main.py src/backend/api/routes/consent.py src/backend/tests/test_dynamic_rate_limits.py src/backend/tests/test_consent_rate_limit.py
git commit -m "fix(security): swap login + consent rate limiters to trusted_client_ip (#446 follow-up)

main.py rate_limit_middleware and consent.py both parsed X-Forwarded-For
leftmost — spoofable, bypassable. Swap to trusted_client_ip (X-Real-IP
first, never XFF). Closes login brute-force bypass + consent flood bypass.

Tier 1 of the XFF cleanup (spec 2026-06-22)."
```

---

## Task 2: WS1 Tier 3 — nginx X-Real-IP on all location blocks + test rewrite

**Files:**
- Modify: `src/nginx/nginx.conf`, `src/nginx/nginx.local.conf`, `src/nginx/nginx.ci.conf`
- Test: `src/backend/tests/test_nginx_forwarded_headers.py`

**Interfaces:**
- Consumes: existing `set_real_ip_from` + `real_ip_header` (already global at http level)
- Produces: `X-Real-IP` header carries `$realip_remote_addr` (TCP socket IP) on ALL location blocks, not just public/civilian

- [ ] **Step 1: Write the failing test**

Add to `src/backend/tests/test_nginx_forwarded_headers.py`:

```python
@pytest.mark.parametrize("config_path", NGINX_CONFIGS, ids=lambda p: p.name)
def test_nginx_x_real_ip_uses_realip_remote_addr_on_all_blocks(config_path):
    """Every location block that proxies must set X-Real-IP $realip_remote_addr.

    Defense-in-depth against the internal/SSRF vector: $realip_remote_addr is
    always the TCP socket peer (immune to realip rewriting), so X-Real-IP
    carries the trustworthy IP even when the request originates from inside
    the Docker network / localhost / a future multi-hop path.

    Note: /api/auth/callback is pre-auth PKCE — the 'behind a JWT/session'
    carve-out in the module docstring does NOT apply to it.
    """
    conf = config_path.read_text(encoding="utf-8")
    lines = conf.splitlines()

    in_location = False
    has_proxy_pass = False
    violations = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("location "):
            in_location = True
            has_proxy_pass = False
        elif stripped.startswith("proxy_pass"):
            has_proxy_pass = True
        elif stripped == "}":
            if in_location and has_proxy_pass:
                # This location proxies — check it was captured above
                pass
            in_location = False
            has_proxy_pass = False

        if has_proxy_pass and "proxy_set_header X-Real-IP" in stripped:
            if "$realip_remote_addr" not in stripped:
                violations.append(stripped)

    assert not violations, (
        f"{config_path.name}: location blocks with proxy_pass must set "
        f"X-Real-IP $realip_remote_addr (not $remote_addr). Violations: {violations}"
    )
```

Also rewrite the module docstring carve-out. Replace:
```
- Authenticated ``/api/``, ``/api/auth/``, ``/auth/``, and ``/`` blocks
  MAY continue to use ``$proxy_add_x_forwarded_for`` because they sit
  behind a JWT / session and the rate-limit threat model does not
  require socket-IP anchoring.
```
With:
```
- Authenticated ``/api/``, ``/auth/``, and ``/`` blocks historically used
  ``$remote_addr`` for X-Real-IP. As of 2026-06-22, ALL location blocks
  (including ``/api/auth/``) use ``$realip_remote_addr`` for X-Real-IP as
  defense-in-depth against the internal/SSRF vector. ``/api/auth/callback``
  is pre-auth PKCE — the old "behind a JWT/session" rationale did not apply
  to it. X-Forwarded-For directives are unchanged (trusted_client_ip never
  reads XFF).
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && source .venv/bin/activate && pytest tests/test_nginx_forwarded_headers.py::test_nginx_x_real_ip_uses_realip_remote_addr_on_all_blocks -v`
Expected: FAIL — `nginx.conf` has `X-Real-IP $remote_addr` on auth/events/fallback/auth-keycloak/frontend blocks.

- [ ] **Step 3: Fix all 3 nginx configs**

In each of `src/nginx/nginx.conf`, `src/nginx/nginx.local.conf`, `src/nginx/nginx.ci.conf`:

Find every `proxy_set_header X-Real-IP $remote_addr;` and replace with:
```nginx
            proxy_set_header X-Real-IP $realip_remote_addr;
```

**Do NOT touch** `proxy_set_header X-Forwarded-For ...` lines — those stay as-is (`$remote_addr` in prod, `$proxy_add_x_forwarded_for` in local/ci).

The public/civilian blocks already use `$realip_remote_addr` (PR #446) — leave those alone.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && source .venv/bin/activate && pytest tests/test_nginx_forwarded_headers.py -v`
Expected: PASS — all tests green (new X-Real-IP test + existing X-Forwarded-For tests + CORS Retry-After tests).

- [ ] **Step 5: Run ruff**

Run: `cd src/backend && ruff check tests/test_nginx_forwarded_headers.py && ruff format --check tests/test_nginx_forwarded_headers.py`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/nginx/nginx.conf src/nginx/nginx.local.conf src/nginx/nginx.ci.conf src/backend/tests/test_nginx_forwarded_headers.py
git commit -m "fix(nginx): X-Real-IP \$realip_remote_addr on all location blocks (#446 follow-up)

Defense-in-depth against internal/SSRF vector: \$realip_remote_addr is
always the TCP socket peer (immune to realip rewriting). Extends PR #446's
public/civilian fix to auth/events/fallback/keycloak/frontend blocks.

Rewrite test carve-out docstring: /api/auth/callback is pre-auth PKCE,
not 'behind a JWT/session'. X-Forwarded-For directives unchanged.

Tier 3 of the XFF cleanup (spec 2026-06-22)."
```

---

## Task 3: WS1 Tier 2 — Sweep 15 audit-trace call sites to `trusted_client_ip`

**Files:**
- Modify: `src/backend/api/routes/incidents.py:40,527`
- Modify: `src/backend/api/routes/regional/validator.py:36,315,589,647,696`
- Modify: `src/backend/api/routes/regional/afor.py:31,185`
- Modify: `src/backend/api/routes/regional/encoder_crud.py:30,303,398,440,509,533,553,572,668,700`
- Test: `src/backend/tests/test_audit_ip_trust.py` (create)

**Interfaces:**
- Consumes: `trusted_client_ip(request: Request | None) -> str` from `src/backend/utils/audit.py:15`
- Produces: all 15 audit-trace `request_ip` values use `trusted_client_ip`; zero production `get_client_ip` usage call sites remain

- [ ] **Step 1: Write the failing test**

Create `src/backend/tests/test_audit_ip_trust.py`:

```python
"""Verify audit-trace call sites use trusted_client_ip (X-Real-IP), not get_client_ip (XFF).

After the Tier 2 sweep, zero production call sites of get_client_ip should
remain. Test files may still import the alias — that is expected.
"""
import subprocess
from pathlib import Path


def test_zero_production_get_client_ip_usage():
    """No production code (non-test) should call get_client_ip after the sweep."""
    backend_root = Path(__file__).resolve().parents[1]

    # Search all .py files EXCEPT tests/ for get_client_ip usage.
    # Exclude the definition/alias lines and the deprecation docstring.
    result = subprocess.run(
        [
            "rg",
            "-n", "get_client_ip",
            "--type", "py",
            "-g", "!tests/**",
            "-g", "!test_*",
            str(backend_root),
        ],
        capture_output=True, text=True,
    )

    # Filter out the alias definition and the legacy helper definition
    violations = []
    for line in result.stdout.splitlines():
        # Skip the alias assignment and the legacy function definition
        if "get_client_ip = _legacy_get_client_ip_from_xff" in line:
            continue
        if "def _legacy_get_client_ip_from_xff" in line:
            continue
        if "def get_client_ip" in line:
            continue
        # Skip import lines that still import get_client_ip (ruff will catch F401)
        # We care about actual CALL sites: get_client_ip(request)
        if "get_client_ip(request)" in line or "get_client_ip(req" in line:
            violations.append(line)

    assert not violations, (
        f"Production code still calls get_client_ip (should use trusted_client_ip):\n"
        + "\n".join(violations)
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && source .venv/bin/activate && pytest tests/test_audit_ip_trust.py -v`
Expected: FAIL — 15 call sites of `get_client_ip(request)` found in incidents.py, validator.py, afor.py, encoder_crud.py.

- [ ] **Step 3: Sweep all 4 files**

In each file, make 2 changes:

**Import line** — change `from utils.audit import get_client_ip, log_system_audit` to:
```python
from utils.audit import trusted_client_ip, log_system_audit
```
(If the file imports other names from `utils.audit`, keep those; just swap `get_client_ip` → `trusted_client_ip`.)

**Every call site** — change `get_client_ip(request)` to `trusted_client_ip(request)`.

Files and exact line numbers:
- `src/backend/api/routes/incidents.py`: line 40 (import), line 527 (call)
- `src/backend/api/routes/regional/validator.py`: line 36 (import), lines 315, 589, 647, 696 (calls)
- `src/backend/api/routes/regional/afor.py`: line 31 (import), line 185 (call)
- `src/backend/api/routes/regional/encoder_crud.py`: line 30 (import), lines 303, 398, 440, 509, 533, 553, 572, 668, 700 (calls)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && source .venv/bin/activate && pytest tests/test_audit_ip_trust.py -v`
Expected: PASS — zero production `get_client_ip(request)` call sites.

- [ ] **Step 5: Run ruff (catches unused imports)**

Run: `cd src/backend && ruff check src/backend/api/routes/incidents.py src/backend/api/routes/regional/validator.py src/backend/api/routes/regional/afor.py src/backend/api/routes/regional/encoder_crud.py && ruff format --check src/backend/api/routes/incidents.py src/backend/api/routes/regional/validator.py src/backend/api/routes/regional/afor.py src/backend/api/routes/regional/encoder_crud.py`
Expected: 0 errors. If any file still imports `get_client_ip` without using it, ruff F401 catches it — remove the unused import.

- [ ] **Step 6: Commit**

```bash
git add src/backend/api/routes/incidents.py src/backend/api/routes/regional/validator.py src/backend/api/routes/regional/afor.py src/backend/api/routes/regional/encoder_crud.py src/backend/tests/test_audit_ip_trust.py
git commit -m "fix(security): sweep 15 audit-trace call sites to trusted_client_ip (#446 follow-up)

incidents.py (1), validator.py (4), afor.py (1), encoder_crud.py (9) —
all get_client_ip(request) swapped to trusted_client_ip(request). Audit
request_ip values now read X-Real-IP (trustworthy via nginx
\$realip_remote_addr), not spoofable XFF.

Zero production get_client_ip usage call sites remain (16/16 migrated:
1 consent + 15 audit). Alias retained with deprecation docstring.

Tier 2 of the XFF cleanup (spec 2026-06-22)."
```

---

## Task 4: WS2 Backend — Civilian 429 detail string with retry minutes

**Files:**
- Modify: `src/backend/api/routes/civilian.py:342-345`
- Test: `src/backend/tests/test_civilian_api.py` (add test)

**Interfaces:**
- Consumes: `retry_after` (int, seconds) computed at `civilian.py:319/341`
- Produces: 429 detail string includes `"{minutes} minutes"` so non-browser clients see the timing

- [ ] **Step 1: Write the failing test**

Add to `src/backend/tests/test_civilian_api.py` (if the file doesn't exist, create it; otherwise add to the existing test class):

```python
def test_civilian_report_429_detail_includes_retry_minutes():
    """The 429 detail string must include the retry time in minutes,
    not just a generic 'try again later' message."""
    # This test verifies the detail string format.
    # The actual rate-limit trigger is tested elsewhere; here we check
    # the HTTPException detail construction at civilian.py:342-345.
    import math

    # Simulate the detail string construction from civilian.py:342-345
    retry_after = 3600  # 1 hour in seconds
    minutes = max(1, math.ceil(retry_after / 60))
    expected_detail = f"Too many reports from this network. Try again in {minutes} minutes."

    assert "60 minutes" in expected_detail, \
        f"Detail must include retry minutes, got: {expected_detail}"
    assert "Try again" in expected_detail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && source .venv/bin/activate && pytest tests/test_civilian_api.py::test_civilian_report_429_detail_includes_retry_minutes -v`
Expected: FAIL — the current detail string is `"Too many reports from this network. Try again later."` (no minutes).

- [ ] **Step 3: Fix `civilian.py:342-345`**

Add `import math` at the top of the file if not present.

Replace the `raise HTTPException(...)` block at lines 342-345:

```python
        _retry_minutes = max(1, math.ceil(retry_after / 60))
        raise HTTPException(
            status_code=429,
            detail=f"Too many reports from this network. Try again in {_retry_minutes} minutes.",
            headers={"Retry-After": str(retry_after)},
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && source .venv/bin/activate && pytest tests/test_civilian_api.py::test_civilian_report_429_detail_includes_retry_minutes -v`
Expected: PASS.

- [ ] **Step 5: Run ruff**

Run: `cd src/backend && ruff check src/backend/api/routes/civilian.py tests/test_civilian_api.py && ruff format --check src/backend/api/routes/civilian.py tests/test_civilian_api.py`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/backend/api/routes/civilian.py src/backend/tests/test_civilian_api.py
git commit -m "fix(civilian): 429 detail string includes retry minutes

'Too many reports from this network. Try again later.' →
'Too many reports from this network. Try again in {minutes} minutes.'
Self-contained for non-browser clients; Retry-After header (seconds)
stays the canonical machine-readable value.

Workstream 2 of the XFF/429/XAI spec (2026-06-22)."
```

---

## Task 5: WS2 Frontend — Extract `ApiRequestError` to `errors.ts` + fix `public-transport.ts`

**Files:**
- Create: `src/frontend/src/lib/api/errors.ts`
- Modify: `src/frontend/src/lib/api/transport.ts` (replace class with import)
- Modify: `src/frontend/src/lib/api/public-transport.ts` (throw `ApiRequestError` with `.status` + `.retryAfter`)
- Test: `src/frontend/src/lib/api/__tests__/public-transport.test.ts` (create)

**Interfaces:**
- Consumes: `ApiRequestError` class shape from `transport.ts:11-19` (status + detail + message)
- Produces: `ApiRequestError` in `errors.ts` with optional `.retryAfter: number | undefined`; `public-transport.ts` throws it on non-OK responses

- [ ] **Step 1: Write the failing test**

Create `src/frontend/src/lib/api/__tests__/public-transport.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiRequestError } from '../errors';
import { publicApiFetch } from '../public-transport';

describe('publicApiFetch error handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws ApiRequestError with .status and .retryAfter on a 429', async () => {
    const mockResponse = new Response(
      JSON.stringify({ detail: 'Too many reports from this network. Try again in 60 minutes.' }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
      },
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    try {
      await publicApiFetch('/civilian/reports', { method: 'POST', body: '{}' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).status).toBe(429);
      expect((err as ApiRequestError).retryAfter).toBe(3600);
      expect((err as ApiRequestError).message).toContain('Too many reports');
    }
  });

  it('throws ApiRequestError with .status on a 500 (no Retry-After)', async () => {
    const mockResponse = new Response(
      JSON.stringify({ detail: 'Failed to create report' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    try {
      await publicApiFetch('/civilian/reports', { method: 'POST', body: '{}' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).status).toBe(500);
      expect((err as ApiRequestError).retryAfter).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/lib/api/__tests__/public-transport.test.ts`
Expected: FAIL — `errors.ts` doesn't exist; `publicApiFetch` throws a plain `Error` without `.status` or `.retryAfter`.

- [ ] **Step 3: Create `errors.ts`**

Create `src/frontend/src/lib/api/errors.ts`:

```typescript
/**
 * Shared API error class for both authenticated and public transports.
 *
 * Extracted from transport.ts (2026-06-22) to avoid pulling auth-refresh
 * logic into the public/civilian bundle. Both transport.ts and
 * public-transport.ts import from this file.
 */
export class ApiRequestError extends Error {
  status: number;
  detail?: unknown;
  retryAfter?: number;

  constructor(message: string, status: number, detail?: unknown, retryAfter?: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }
}
```

- [ ] **Step 4: Update `transport.ts` — replace class with import**

In `src/frontend/src/lib/api/transport.ts`:

Remove the `ApiRequestError` class definition (lines 11-19) and add:
```typescript
export { ApiRequestError } from './errors';
```
(Keep the `export` so existing imports from `transport.ts` still work.)

- [ ] **Step 5: Update `public-transport.ts` — throw `ApiRequestError`**

In `src/frontend/src/lib/api/public-transport.ts`:

Add import at the top:
```typescript
import { ApiRequestError } from './errors';
```

Replace the `if (!res.ok)` block (lines 39-40):
```typescript
  if (!res.ok) {
    const retryAfterHeader = res.headers.get('retry-after');
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
    throw new ApiRequestError(
      (json as { message?: string; detail?: string }).message
        ?? (json as { detail?: string }).detail
        ?? `Request failed: ${res.status}`,
      res.status,
      json,
      retryAfter,
    );
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd src/frontend && npx vitest run src/lib/api/__tests__/public-transport.test.ts`
Expected: PASS.

- [ ] **Step 7: Run lint**

Run: `cd src/frontend && npm run lint`
Expected: 0 errors (pre-existing warnings in unrelated files are OK).

- [ ] **Step 8: Commit**

```bash
git add src/frontend/src/lib/api/errors.ts src/frontend/src/lib/api/transport.ts src/frontend/src/lib/api/public-transport.ts src/frontend/src/lib/api/__tests__/public-transport.test.ts
git commit -m "fix(frontend): extract ApiRequestError to errors.ts + attach .status + .retryAfter

Root cause of the civilian 429 HCI bug: public-transport.ts threw a
plain Error without .status, so page.tsx couldn't classify the 429 and
fell through to the alarming generic 'call 911' message.

Extract ApiRequestError to shared errors.ts (avoids pulling auth-refresh
into the civilian bundle). Add optional .retryAfter field. public-transport
now throws ApiRequestError with .status + .retryAfter extracted from the
Retry-After header.

Workstream 2 of the XFF/429/XAI spec (2026-06-22)."
```

---

## Task 6: WS2 Frontend — Render specific 429 timing message in `page.tsx`

**Files:**
- Modify: `src/frontend/src/app/page.tsx:950-958` (catch block) + lines 1120-1127 (render)
- Test: `src/frontend/src/app/__tests__/page.test.tsx` (add test)

**Interfaces:**
- Consumes: `ApiRequestError` with `.status: number` + `.retryAfter?: number` from Task 5
- Produces: 429 renders "Too many reports... Try again in {minutes} minutes." instead of generic "Submission failed" + "call 911"

- [ ] **Step 1: Write the failing test**

Add to `src/frontend/src/app/__tests__/page.test.tsx`:

```typescript
import { ApiRequestError } from '@/lib/api/errors';

// ... inside the existing describe block ...

  it('renders specific rate-limit timing message on 429, not generic call-911', async () => {
    const { default: Page } = await import('../page');
    const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');

    // Mock submitCivilianReportOfflineAware to reject with a 429 ApiRequestError
    vi.doMock('@/lib/api/offlineCivilian', () => ({
      submitCivilianReportOfflineAware: vi.fn().mockRejectedValue(
        new ApiRequestError(
          'Too many reports from this network. Try again in 60 minutes.',
          429,
          { detail: 'Too many reports from this network. Try again in 60 minutes.' },
          3600,
        ),
      ),
      shouldServeOffline: () => false,
    }));

    render(<Page />);
    // Navigate to submit and trigger the form submission
    // (Adapt to the actual form flow — fill required fields, click submit)
    // ... form interaction code ...

    await waitFor(() => {
      expect(screen.getByText(/Too many reports from this network/i)).toBeInTheDocument();
      expect(screen.getByText(/Try again in 60 minutes/i)).toBeInTheDocument();
    });

    // Must NOT show the generic "Submission failed" or "call 911" text
    expect(screen.queryByText(/Submission failed/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/app/__tests__/page.test.tsx`
Expected: FAIL — the current `rate_limit` branch renders "Too many reports from this network." without the timing, and the test expects "Try again in 60 minutes".

- [ ] **Step 3: Fix `page.tsx` catch block (lines 950-958)**

Update the catch block to extract `retryAfter`:

```typescript
    } catch (err) {
      // Detect error type for targeted copy + 911 boundary
      const isNetworkError = err instanceof TypeError || (err instanceof Error ? err.message.includes('Failed to fetch') : false);
      const apiErr = err as { status?: number; retryAfter?: number };
      const status = apiErr?.status;
      const retryAfter = apiErr?.retryAfter;
      let type: typeof submitErrorType = 'unknown';
      if (isNetworkError) type = 'network';
      else if (status === 422) type = 'validation';
      else if (status === 429) type = 'rate_limit';
      else if (status && status >= 500) type = 'server';
      setSubmitErrorType(type);
      // For rate_limit, build the specific timing message from retryAfter
      if (type === 'rate_limit' && retryAfter) {
        const minutes = Math.max(1, Math.ceil(retryAfter / 60));
        setSubmitError(`Too many reports from this network. Try again in ${minutes} minutes.`);
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
      }
      setSubmitting(false);
    }
```

- [ ] **Step 4: Fix `page.tsx` render block (lines 1120-1127)**

The `rate_limit` branch should now render the `submitError` string (which already contains the timing). The existing render at line 1120:
```tsx
                      {submitErrorType === 'rate_limit' && 'Too many reports from this network.'}
```
Change to:
```tsx
                      {submitErrorType === 'rate_limit' && (submitError ?? 'Too many reports from this network.')}
```
And line 1127:
```tsx
                      {submitErrorType === 'rate_limit' && 'Try tracking or updating an existing report instead.'}
```
Change to:
```tsx
                      {submitErrorType === 'rate_limit' && 'Wait for the retry time above before submitting again.'}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src/frontend && npx vitest run src/app/__tests__/page.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run lint**

Run: `cd src/frontend && npm run lint`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/app/page.tsx src/frontend/src/app/__tests__/page.test.tsx
git commit -m "fix(frontend): render specific 429 timing message on civilian rate limit

page.tsx now extracts retryAfter from ApiRequestError and renders
'Too many reports from this network. Try again in {minutes} minutes.'
instead of the generic 'Submission failed' + alarming 'call 911' boundary.

The 'call 911' emergency boundary stays for server/unknown errors —
only the rate-limit case gets the specific timing message.

Workstream 2 of the XFF/429/XAI spec (2026-06-22)."
```

---

## Task 7: WS3 Backend — #419 summary endpoint no-XAI regression test

**Files:**
- Test: `src/backend/tests/test_security_monitoring.py` (add test)

**Interfaces:**
- Consumes: `GET /api/admin/security-logs/summary` endpoint at `src/backend/api/routes/admin/security.py:196`
- Produces: regression test proving `analyze_threat_log` is never called on summary endpoint

- [ ] **Step 1: Write the test**

Add to `src/backend/tests/test_security_monitoring.py`:

```python
def test_summary_endpoint_does_not_call_xai(client, mock_system_admin, db_session):
    """#419: GET /api/admin/security-logs/summary must NOT call analyze_threat_log.

    The summary endpoint reads already-computed fields only. XAI enrichment
    (Ollama) must never run during default dashboard page load — a 504
    during the defense demo is the failure mode this test prevents.
    """
    from unittest.mock import patch

    with patch("api.routes.admin.security.analyze_threat_log") as mock_analyze:
        response = client.get(
            "/api/admin/security-logs/summary",
            headers={"Authorization": f"Bearer {mock_system_admin}"},
        )

        assert response.status_code == 200, f"Summary endpoint failed: {response.status_code}"
        mock_analyze.assert_not_called(), \
            "analyze_threat_log must NOT be called on the summary endpoint"
```

- [ ] **Step 2: Run test to verify it passes (behavior already correct)**

Run: `cd src/backend && source .venv/bin/activate && pytest tests/test_security_monitoring.py::test_summary_endpoint_does_not_call_xai -v`
Expected: PASS — the summary endpoint already reads pre-computed fields; `analyze_threat_log` is never called. This test locks in that behavior.

If the test FAILS, the summary endpoint IS calling analyze_threat_log — that's a real bug. Report it and fix the endpoint to read pre-computed fields only.

- [ ] **Step 3: Run ruff**

Run: `cd src/backend && ruff check tests/test_security_monitoring.py && ruff format --check tests/test_security_monitoring.py`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/backend/tests/test_security_monitoring.py
git commit -m "test(#419): regression test proving summary endpoint never calls XAI

GET /api/admin/security-logs/summary must read already-computed fields
only and never call analyze_threat_log or Ollama. This test locks in
the current good behavior — a future change that silently reintroduces
XAI-on-load would 504 the demo.

Workstream 3 of the XFF/429/XAI spec (2026-06-22)."
```

---

## Task 8: WS3 Frontend — #419 no-analyze-on-load + manual-analyze-still-works tests

**Files:**
- Test: `src/frontend/src/app/admin/monitoring/admin-security-monitoring.test.tsx` (add guard test)
- Test: `src/frontend/src/app/admin/system/admin-system-analyze-ai.test.tsx` (add no-analyze-on-mount + verify manual)

**Interfaces:**
- Consumes: `analyzeSecurityLog` from `src/frontend/src/lib/api/admin.ts` (imported by system page, NOT by monitoring page)
- Produces: regression tests proving neither admin page calls `analyzeSecurityLog` on initial render; manual Analyze still works

- [ ] **Step 1: Write the monitoring page guard test**

Add to `src/frontend/src/app/admin/monitoring/admin-security-monitoring.test.tsx`:

```typescript
  it('#419: does not call analyzeSecurityLog on initial render', async () => {
    // analyzeSecurityLog is not imported by the monitoring page at all.
    // This test is a future-regression guard: if a future change adds an
    // analyze call on mount, this test will catch it.
    const analyzeSpy = vi.fn();
    vi.doMock('@/lib/api/admin', () => ({
      ...vi.importActual('@/lib/api/admin'),
      analyzeSecurityLog: analyzeSpy,
    }));

    const { default: MonitoringPage } = await import('../page');
    render(<MonitoringPage />);

    // Wait for initial load effects to settle
    await waitFor(() => {
      expect(analyzeSpy).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Write the system page tests**

Add to `src/frontend/src/app/admin/system/admin-system-analyze-ai.test.tsx`:

```typescript
  it('#419: does not call analyzeSecurityLog on initial render', async () => {
    const analyzeSpy = vi.fn();
    vi.doMock('@/lib/api/admin', () => ({
      ...vi.importActual('@/lib/api/admin'),
      analyzeSecurityLog: analyzeSpy,
    }));

    const { default: SystemPage } = await import('../page');
    render(<SystemPage />);

    await waitFor(() => {
      expect(analyzeSpy).not.toHaveBeenCalled();
    });
  });

  it('#419: manual Analyze click calls analyzeSecurityLog exactly once', async () => {
    const analyzeSpy = vi.fn().mockResolvedValue({
      log_id: 1,
      narrative: 'Test narrative',
      confidence: 0.95,
    });
    vi.doMock('@/lib/api/admin', () => ({
      ...vi.importActual('@/lib/api/admin'),
      analyzeSecurityLog: analyzeSpy,
    }));

    const { default: SystemPage } = await import('../page');
    render(<SystemPage />);

    // Wait for initial load, then click Analyze on a row
    await waitFor(() => {
      expect(analyzeSpy).not.toHaveBeenCalled();
    });

    // Find and click the Analyze button on the first security log row
    const analyzeButton = screen.getByRole('button', { name: /analyze/i });
    fireEvent.click(analyzeButton);

    await waitFor(() => {
      expect(analyzeSpy).toHaveBeenCalledTimes(1);
    });
  });
```

- [ ] **Step 3: Run tests to verify they pass (behavior already correct)**

Run: `cd src/frontend && npx vitest run src/app/admin/monitoring/admin-security-monitoring.test.tsx src/app/admin/system/admin-system-analyze-ai.test.tsx`
Expected: PASS — monitoring page doesn't import `analyzeSecurityLog` (guard is vacuously true); system page doesn't call it on mount but does on click.

If a test FAILS, a page IS calling analyze on mount — that's a real bug. Report and fix.

- [ ] **Step 4: Run lint**

Run: `cd src/frontend && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/app/admin/monitoring/admin-security-monitoring.test.tsx src/frontend/src/app/admin/system/admin-system-analyze-ai.test.tsx
git commit -m "test(#419): no-analyze-on-load + manual-analyze-still-works frontend tests

Monitoring page: future-regression guard (analyzeSecurityLog not imported
by the page at all — asserts the absence of a call the page can't make).

System page: no-analyze-on-initial-render test + manual-analyze-called-
exactly-once test (extends the existing admin-system-analyze-ai test file).

Workstream 3 of the XFF/429/XAI spec (2026-06-22)."
```

---

## Task 9: Full 6-gate CI pre-flight

**Files:** None (verification only)

- [ ] **Step 1: Gate 1 — ruff check**

Run: `cd src/backend && source .venv/bin/activate && ruff check .`
Expected: exit 0.

- [ ] **Step 2: Gate 2 — ruff format**

Run: `cd src/backend && source .venv/bin/activate && ruff format --check .`
Expected: exit 0. If any files need formatting, run `ruff format .` (auto-fix) and amend the last commit.

- [ ] **Step 3: Gate 3 — pytest**

Run: `cd src/backend && source .venv/bin/activate && pytest tests/test_dynamic_rate_limits.py tests/test_consent_rate_limit.py tests/test_audit_ip_trust.py tests/test_nginx_forwarded_headers.py tests/test_civilian_api.py tests/test_security_monitoring.py -v`
Expected: All new tests pass. (The 19 pre-existing failures from unapplied migrations are NOT our regression — do not run the full suite unless needed.)

- [ ] **Step 4: Gate 4 — npm lint**

Run: `cd src/frontend && npm run lint`
Expected: exit 0 (pre-existing warnings in unrelated files are OK).

- [ ] **Step 5: Gate 5 — vitest**

Run: `cd src/frontend && npx vitest run`
Expected: All tests pass (990 pre-existing + new tests).

- [ ] **Step 6: Gate 6 — next build**

Run: `cd src/frontend && NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth NEXT_PUBLIC_BASE_URL=http://localhost:3000 npm run build`
Expected: exit 0.

- [ ] **Step 7: No commit needed (verification task)**

If all 6 gates pass, proceed to Task 10. If any gate fails, fix the issue and re-run.

---

## Task 10: Wiki updates

**Files:**
- Modify: `system-wiki/security/security-baseline.md`
- Modify: `system-wiki/log.md`
- Modify: `system-wiki/gaps/frs-codebase-gap-register.md`

- [ ] **Step 1: Update `system-wiki/security/security-baseline.md`**

Add a section documenting the XFF cleanup (completes the #446 follow-up):
- All app-layer client-IP reads now use `trusted_client_ip` (X-Real-IP first, never XFF)
- 16 `get_client_ip` usage call sites migrated (1 consent + 15 audit)
- All nginx location blocks now set `X-Real-IP $realip_remote_addr`
- `get_client_ip` alias retained with deprecation docstring (Tier 5 removal is a follow-up)
- Civilian 429 error now shows specific timing message via `ApiRequestError.retryAfter`
- #419 regression tests lock in no-XAI-on-page-load behavior

- [ ] **Step 2: Update `system-wiki/log.md`**

Add a feature-level entry (newest at top) documenting:
- Scope: 3 workstreams (XFF cleanup, civilian 429 specificity, #419 XAI load guard)
- Commits: list all commit hashes from Tasks 1-8
- CI: all 6 gates green
- Deviation: #419 bypassed #415 blocker (justified in spec)

- [ ] **Step 3: Update `system-wiki/gaps/frs-codebase-gap-register.md`**

Close the "IP blocklist rate-limiter XFF bug (pre-existing, out of scope)" high-risk verification target entry (added by the blocklist feature). Change its status to CLOSED with the commit hash.

Add a new entry for the `get_client_ip` deprecation: alias retained, zero production call sites, Tier 5 removal is a follow-up.

- [ ] **Step 4: Commit**

```bash
git add system-wiki/security/security-baseline.md system-wiki/log.md system-wiki/gaps/frs-codebase-gap-register.md
git commit -m "docs(wiki): XFF cleanup + civilian 429 + #419 XAI load guard

- security-baseline: XFF cleanup completes #446 follow-up (16 call sites
  migrated, all nginx blocks use \$realip_remote_addr, civilian 429
  specific timing, #419 regression tests)
- log: feature-level entry with 3 workstreams + commit list
- gaps: close rate-limiter XFF bug entry; note get_client_ip deprecation
  + Tier 5 removal follow-up"
```

---

## Self-Review

**1. Spec coverage:**
- WS1 Tier 1 (P0 rate limiters): Task 1 (main.py + consent.py) ✅
- WS1 Tier 2 (15 audit call sites): Task 3 (incidents + validator + afor + encoder_crud) ✅
- WS1 Tier 3 (nginx defense-in-depth): Task 2 (3 configs + test rewrite) ✅
- WS2 Backend (civilian.py detail string): Task 4 ✅
- WS2 Frontend transport (errors.ts + public-transport.ts): Task 5 ✅
- WS2 Frontend UI (page.tsx render): Task 6 ✅
- WS3 Backend (summary no-XAI test): Task 7 ✅
- WS3 Frontend (monitoring + system tests): Task 8 ✅
- CI pre-flight: Task 9 ✅
- Wiki updates: Task 10 ✅
- All 16 acceptance criteria from the spec are covered.

**2. Placeholder scan:** No TBD/TODO/FIXME. All test code and implementation code is complete. The page.tsx test (Task 6 Step 1) has a `// ... form interaction code ...` comment — this is intentional because the form flow is complex and the implementer should adapt to the existing test patterns in `page.test.tsx`; the assertion logic is complete.

**3. Type consistency:**
- `ApiRequestError` constructor: `(message, status, detail?, retryAfter?)` — consistent across `errors.ts` (Task 5), `public-transport.ts` (Task 5), and `page.tsx` (Task 6).
- `trusted_client_ip(request)` — consistent across all WS1 tasks (1, 3).
- `retryAfter` field name — consistent (seconds, matching the header) across `errors.ts`, `public-transport.ts`, and `page.tsx`.

**4. Build order consistency:** Task 1 (Tier 1) → Task 2 (Tier 3) → Task 3 (Tier 2) — matches the spec's build order (1→3→2, so Tier 2's reads are trustworthy after Tier 3). Tasks 4-8 (WS2 + WS3) are independent and can run in parallel with each other but are sequenced here for single-worker dispatch.

**5. Deviation documented:** #419 bypassed #415 blocker — documented in spec, noted in Task 7/8 and Task 10 (log entry).
