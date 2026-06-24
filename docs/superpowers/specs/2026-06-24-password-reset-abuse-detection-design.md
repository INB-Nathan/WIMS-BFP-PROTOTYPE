# Password Reset Abuse Detection — Design Spec v2

**Date:** 2026-06-24
**Status:** Design (v2.1 — v2.0 reviewed by 2 SOTA models; v2.1 applies 5 fixes: empty-key wording, `limit_conn` repeat, `limit_req_status 429`, proxy-pass smoke test, verification burst count)
**Supersedes:** v2.0 — the v2.0 analysis was correct (M2 soft-gate illusion, M1 POST-only requirement); v2.1 is editorial cleanup for M1-only approval.
**Implementation decision:** **Ship M1 only** as the first PR. Option B (backend-owned reset endpoint) deferred to a separate, more detailed spec.
**Pattern:** 1-layer edge defense — nginx per-IP POST-only rate limit (hard, enforceable, shippable). No backend changes.
**Scope:** Keycloak-native password reset flow only (path `/auth/realms/bfp/login-actions/reset-credentials`). Does **not** cover backend-driven emails (Celery tasks through `sender.py`), email verification flow (`/api/auth/verify-email` — already rate limited at 5/10min per user per PR #225), or FCM notification abuse.
**Related:** ASVS L2 V2.4.1 (3-layer rate limiting), PR #428 (public abuse controls), PR #452 (Brevo SMTP on port 2525), PR #453 (Keycloak email theme), security-baseline.md §Nginx Edge Rate Limiting for Keycloak.

---

## Background

### The attack surface

The password reset trigger at `https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials` is a **public, unauthenticated POST endpoint**. Anyone with an email address known to be in the bfp realm can trigger a password reset email — Keycloak does not disclose whether the email exists (neutral response), but the SMTP send is unconditional for valid users.

### What's at risk

| Risk | Impact | Expected frequency on a live BFP installation |
|---|---|---|
| **Email bombing** — attacker triggers 100+ resets for the same email in minutes | User's inbox flooded with `[WIMS-BFP] Reset your password`; user desensitized to legitimate reset emails | High — low effort, public endpoint |
| **SMTP daily budget exhaustion** — Brevo free tier caps at 300 emails/day | All transactional emails blocked for 24h (password resets, verify-email, backend notifications, FCM fallback) | Medium — 300 is not a high bar |
| **Denial of service** — attacker burns the shared nginx rate-limit budget with reset requests | Legitimate login traffic (`/auth/`) degraded because the `keycloak_api` zone (10r/s) is shared | Medium (single-IP), Low (distributed) |
| **Token replay harassment** — attacker triggers reset, user never completes it, token expires in 5 min | Low (token is single-use, short TTL), but the email itself is the harassment vector | Low |

### Current protections (before this spec)

| Layer | Protection | Covers password reset? | Specific to reset? |
|---|---|---|---|
| Nginx `/auth/` zone | 10r/s, burst=20, per-IP (shared with login + admin console) | ✅ (partial — generic, non-distributed attack) | ❌ |
| Nginx connection limit | 10 concurrent/IP (shared) | ✅ (partial) | ❌ |
| Keycloak brute force | `failureFactor=5`, `waitIncrementSeconds=300` — guards `LOGIN_ERROR` events only | ❌ (login attempts, not reset requests) | ❌ |
| Backend Redis sliding-window | 3–5 req/hr per-IP (public DMZ endpoints only) | ❌ (reset flow is Keycloak-native, bypasses backend) | ❌ |
| Action token TTL | 300s (5 min) — limits the window for replay | ✅ (token-level) | ✅ (but does not stop the SMTP trigger) |

### The asymmetry

The password reset flow is **entirely Keycloak-native** (nginx → Keycloak → Brevo SMTP). The backend Redis rate limiter never sees these requests. The nginx zone is shared with all other `/auth/` traffic. A single IP can submit 20 password reset POSTs in 2 seconds (burst=20 at 10r/s) before hitting the 429 limit — on a shared zone that also serves legitimate login and admin console traffic.

---

## Proposed Mitigations

Two layers, scoped honestly. M1 is the primary technical defense. M2 is an architect-choice: either a real enforcement point or a UI-optimization-only soft gate. M3 from v1 is deferred as partial telemetry.

### M1 — Nginx per-IP rate limit for reset-credentials POST (hard gate)

**Why separate from the shared `keycloak_api` zone:** An attacker burning the reset budget should not degrade login/admin console traffic. The reset path gets its own zone budget.

#### POST-only rate limiting via nginx `map`

Plain nginx `location` cannot select by HTTP method. To rate-limit only the form submission (POST) while leaving the form page (GET) unthrottled, use a conditional `map`:

```nginx
# In the http block, after existing limit_req_zone definitions:
map $request_method $reset_post_only {
    POST    $realip_remote_addr;
    default "";
}
limit_req_zone  $reset_post_only zone=reset_credentials:10m rate=1r/m;
```

**How this works:**
- For POST requests, `$reset_post_only` = the client IP. Each IP gets its own rate-limit bucket in the `reset_credentials` zone.
- For GET, PUT, DELETE, etc., `$reset_post_only` = empty string. Nginx does not account requests with an empty `limit_req_zone` key (see [nginx docs](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)), so GET requests bypass the `reset_credentials` limiter entirely.

#### Exact proxy block (copy of existing `/auth/` block)

The new location block **must** mirror the existing `/auth/` proxy behavior exactly — no invented proxy config. The current `/auth/` block is:

```nginx
location /auth/ {
    limit_req  zone=keycloak_api burst=20 nodelay;
    limit_conn addr 10;

    proxy_pass http://keycloak_servers/auth/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $realip_remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Port $server_port;
}
```

The reset-specific block repeats the `limit_conn addr 10` guard and adds the POST-only zone. `limit_conn` is repeated because nginx exact-match (`location =`) locations terminate the location search — the generic `/auth/` prefix location does not also apply (see [nginx location docs](https://nginx.org/en/docs/http/ngx_http_core_module.html)). The spec also adds `limit_req_status 429;` at the http/server level so the rejected response is 429 (the existing nginx.conf already has this at line 68; if it moves or is missing in any config variant, add it explicitly).

```nginx
# BEFORE the generic /auth/ location (nginx matches exact-location before prefix):
location = /auth/realms/bfp/login-actions/reset-credentials {
    limit_req  zone=reset_credentials burst=2 nodelay;
    limit_conn addr 10;

    proxy_pass http://keycloak_servers/auth/realms/bfp/login-actions/reset-credentials;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $realip_remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Port $server_port;
}
```

**Key constraints (from review):**
- `proxy_pass` with an exact-match `location =` and a full upstream path (`/auth/realms/bfp/login-actions/reset-credentials`) must be verified with a **before/after smoke test**: run `curl -v` on both GET and POST before and after the config change to confirm Keycloak still receives the expected path and returns the expected response. The implementer should not assume the exact-location `proxy_pass` behavior — verify it.
- After the exact-match reset block, the generic `/auth/` prefix location continues to match all other `/auth/*` paths normally. The `proxy_set_header` lines are repeated because nginx does NOT inherit `proxy_set_header` from prefix locations into exact-match locations.
- `limit_conn addr 10` is explicitly repeated in the reset block because the generic block's `limit_conn` does not apply (exact-match terminates location search).

#### Rate limit tuning justification

`rate=1r/m burst=2`:
- A legitimate user: submits the form once. Gets 1 token (burst consumed: 1/2). Never hits the limit.
- A legitimate user who accidentally submits twice: token refills in 60s. After 2 submissions within the same minute, they get 429. The form returns a 429 HTML page. UX impact: low (user refreshes and waits 30s).
- A single-IP attacker: 1 reset email per minute, bursts up to 2 in quick succession. At sustained throughput: 60 resets/hr max from one IP. Still reaches Brevo's 300/day limit in 5 hours, but this is a single IP — the effort-to-yield ratio is poor.
- Comparative analysis of proposed rates:

| Rate | Per-IP reset emails/hr | Time to exhaust Brevo 300/day (single IP) | Fraction of Brevo budget | UX impact |
|---|---|---|---|---|
| 10r/s (current shared zone) | 36,000 | 30 seconds | 100% in <1 minute | Catastrophic (shared zone degrades) |
| 2r/m burst=5 (v1 proposal) | 120 | 2.5 hours | 40% of budget in 1 hour (sustained) | Accidental double-click gets 429 |
| **1r/m burst=2 (v2)** | **60** | **5 hours** | **20% of budget in 1 hour** | **Double-click only** |

#### Files changed

- `src/nginx/nginx.conf` — add `map` block, `limit_req_zone`, and reset-specific `location =` block
- `src/nginx/nginx.ci.conf` — same changes (CI mirror)
- `src/nginx/nginx.local.conf` — same changes (local dev mirror)

#### Scope

nginx config only. No Python, no Keycloak, no frontend, no tests. Verify with `nginx -t` and a `curl` POST test.

---

### M2 — Per-email rate limiting (architect choice: hard enforcement or UI friction only)

**Why v2 changes M2:** v1's M2 proposed a backend endpoint called by login theme JS before submitting to Keycloak's native reset form. Both SOTA model reviews independently flagged this as a **false sense of security** — an attacker can POST directly to `https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials` and bypass the JS call entirely. M2 as a client-side soft gate does NOT provide per-email enforcement.

v2 offers two mutually exclusive paths. Choose one.

#### Option A — Defer per-email enforcement (recommended for v1 implementation)

Accept that M1 (nginx per-IP POST limit) is the only email-abuse defense for now. Per-email enforcement is deferred pending:

* A **custom Keycloak authenticator SPI** (most correct place — inside the Keycloak reset credential flow, before the SMTP send). This is the highest-complexity option but the only hard per-email enforcement that cannot be bypassed.
* **OpenResty / ngx_http_lua_module** in nginx to parse the POST body, extract the email, and check Redis before proxying to Keycloak. This avoids Keycloak customization but adds a Lua dependency to the nginx container.
* An **SMTP proxy or mail gateway** that sits between Keycloak and Brevo and enforces per-recipient rate limiting. This would also count Keycloak's SMTP sends (solving M3's blind spot).

**Deferred per-email enforcement does not block v1 implementation.** M1 is independently valuable and shippable.

#### Option B — Backend-owned reset endpoint (hard per-email enforcement)

Instead of the Keycloak-native reset flow, route password resets through the backend:

```text
POST /api/auth/request-password-reset
```

The backend:
1. Validates the email exists in Keycloak (via Admin API `GET /admin/realms/bfp/users?email=...`)
2. Checks Redis per-email rate limit: max 1 per 15 min (atomic `SET NX EX 900`)
3. If under limit: calls Keycloak Admin API to trigger the reset email (`PUT ADMIN /admin/realms/bfp/users/{id}/execute-actions-email`)
4. Returns neutral response: `{ "ok": true, "message": "If the account exists, a reset email may be sent shortly." }`

Then nginx must **block or severely limit public access** to Keycloak's native reset endpoint. The backend becomes the only intended reset trigger.

```nginx
# Block direct POST to Keycloak's native reset endpoint (backend is the gate):
location = /auth/realms/bfp/login-actions/reset-credentials {
    limit_except GET HEAD { deny all; }  # Allow GET/HEAD (form page), deny POST and all other methods
    proxy_pass http://keycloak_servers/auth/realms/bfp/login-actions/reset-credentials;
    proxy_set_header Host $host;
    # ... proxy headers as above
}
```

**Pros:** Hard per-email enforcement via Redis (backend's proven rate limiter). No Keycloak SPI. Counts all reset-triggered emails (solves half of M3's blind spot).

**Cons:** Adds a backend route + Keycloak Admin API call per reset request. Changes the trust boundary: Keycloak's admin credentials (`KEYCLOAK_ADMIN`/`KEYCLOAK_ADMIN_PASSWORD`) must be available to the backend runtime (they are — already in `.env.production`). The neutral response means the client cannot distinguish "rate limited" from "user not found" from "email sent" — correct for activity-leak prevention.

**Trade-offs compared to Option A:**

| Dimension | Option A (defer) | Option B (backend-owned) |
|---|---|---|
| Effort | 0 (M1 only ships) | ~1-2 days (backend route, Admin API calls, Redis enforcement, nginx block) |
| Hard per-email enforcement | ❌ | ✅ |
| Keycloak Admin API dependency | ❌ | ✅ (`GET users` + `execute-actions-email`) |
| API key exposure | None | Backend needs KEYCLOAK_ADMIN + password at runtime |
| Neutral response for activity leak | N/A (Keycloak's default is neutral) | Must be implemented explicitly |
| Smell for user enumeration | Keycloak's existing neutral response | Same (neutral on success/failure) |

#### M2 as UI-click friction only (not recommended, but documented for completeness)

If the requirement is only to prevent accidental double-clicks and inform the user that a reset email is en route, the v1 M2 approach can work — but it must be explicitly documented as **NOT a security boundary**. The technical issues from review must be fixed:

1. **Atomic rate-limit check:** Use `SET key value NX EX 900` (not `TTL` then `SETEX` — race condition)
2. **Neutral response:** Always return `200 { "ok": true, "message": "If the account exists..." }`. Do NOT return `429 { "error": "rate_limited" }` — that leaks activity timing.
3. **HMAC-SHA256 key, not plain SHA-256:** Plain SHA-256(email) is dictionary-reversible for public-sector email addresses.
   ```python
   import hmac
   key = settings.RATE_LIMIT_HMAC_SECRET
   email_hash = hmac.new(key, normalized_email.encode(), hashlib.sha256).hexdigest()
   ```
4. **Email normalization:** `body.email.strip().lower()` at minimum.
5. **Fail-open logging:** When Redis is down and the gate opens, log a `SECURITY WARNING` and increment a metric.
6. **Frontend does not reveal limit status:** The JS shows only a generic message regardless of the backend's actual decision.

**If Option A is chosen, this UI friction is also deferred** (no value without per-email enforcement).

---

### M3 — Backend SMTP daily-budget telemetry (advisory only, deferred)

**Renamed from v1's "SMTP daily-budget guard":** The v1 name overstated the protection. M3 is a read-only monitoring signal, not a guard.

**What it measures:** Backend SMTP sends only (via `sender.py`). Keycloak's SMTP sends (the reset attack surface) are invisible to this counter. As a partial view of the Brevo daily budget, M3 provides incomplete information.

**Design sketch (deferred):**

```python
# In sender.py, after each successful SMTP send:
smtp_daily_key = f"smtp:daily_count:{datetime.utcnow().strftime('%Y-%m-%d')}"
count = await redis.incr(smtp_daily_key)
if count == 1:
    await redis.expire(smtp_daily_key, 86400)
if count >= 290:  # 90% of Brevo free tier
    logger.warning(f"SMTP daily count at {count}/300 — approaching Brevo free tier limit")
```

**Does NOT block sends** — no hard enforcement. Full budget visibility would require the Keycloak SMTP path to also report to this counter (via a Keycloak event listener SPI or SMTP proxy — both deferred).

**Decision:** Defer M3 entirely. Not blocking for M1 implementation.

---

## Implementation Order

| Phase | Mitigation | Effort | What it stops | Dependencies |
|---|---|---|---|---|
| **Phase 1 (ship now)** | **M1:** nginx POST-only per-IP zone `1r/m burst=2` | ~30 min | Single-IP flood, protects shared zone; 60/hr max per IP | nginx config only |
| Phase 2 (deferred) | Option A (no per-email enforcement — explicit acceptance) | 0 | — | Phase 1 shipped |
| Phase 3 (separate spec) | Option B (backend-owned reset endpoint) | ~1-2 days | Hard per-email enforcement, requires Admin API design | Separate spec, not blocking |
| Phase 4 (deferred) | M3 telemetry + any remaining work | — | — | — |

---

## Verification (after M1 implementation)

These tests must pass before the PR merges:

1. **`nginx -t`** — configuration is valid
2. **`POST` is rate limited** — `curl -X POST https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials -d 'username=test@example.com' -v` repeated 4+ times rapidly → with `1r/m burst=2 nodelay`, up to 3 requests may pass (base rate + 2 burst), the 4th should return 429 (`Too Many Requests`)
3. **`GET` is NOT rate limited** — `curl https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials` repeated 10 times → all 200 (never hits the zone budget because `$reset_post_only` is empty for GET)
4. **Legitimate reset still works** — a real user (operator on a known account) triggers password reset via the form → email arrives at the test inbox with WIMS-BFP-branded template (subject `[WIMS-BFP] Reset your password`, maroon header, BFP logo)
5. **Direct POST bypass test** — if M2 Option B (backend-owned) is chosen: `POST /auth/realms/bfp/login-actions/reset-credentials` returns 403 (blocked by `limit_except`), while `POST /api/auth/request-password-reset` with a valid email returns 200
6. **No regressions** — existing login flow, admin console, and other `/auth/*` paths are unaffected (verified by `docker logs wims-keycloak` showing no new errors, and the operator logging into the Admin Console)

---

## Out of Scope

- **CAPTCHA / reCAPTCHA** on the reset form — not proposed for this iteration (requires external service, Keycloak authenticator, domain verification)
- **Custom Keycloak authenticator SPI** for per-email rate limiting — deferred; Option A explicitly marks this as a future path
- **OpenResty / Lua in nginx** — too complex for the gain; Option B backend-owned route is simpler
- **Hard SMTP send block** — cannot enforce without a Keycloak SPI or SMTP proxy; M1 + Option B are the envelope
- **Rate limiting for email verification flow** (`POST /api/auth/verify-email`) — already rate limited at 5/10min per user per PR #225
- **Rate limiting for backend Celery-triggered emails** — these are internal, not publicly triggerable
- **Brevo HTTP API upgrade** (to increase daily budget) — existing SMTP works, separate decision
- **Login page rate limiting** (CAPTCHA on the login form itself) — separate issue
- **M3 SMTP telemetry** — deferred; not blocking
- **Modifying Keycloak login theme JS** — only relevant if M2 Option B or UI-friction is chosen; not in scope for M1-only

---

## Ratings (per SOTA model review, cited for reference)

*This subsection is informational — it captures the review verdicts that drove the v2 revision.*

| Dimension | Rating (1-10) | Source model |
|---|---|---|
| Threat model | 8/10 — correctly identifies the asymmetry | Model A |
| M1 (after POST-only + proxy fix) | 8/10 — clean, simple, enforceable | Model A |
| M2 (as security control in v1) | 3/10 — bypassable soft gate → false sense of security | Model A |
| M2 (as UI friction only in v2) | 6/10 — useful for double-click prevention, not abuse | Model A |
| M2 (Option B backend-owned in v2) | 8/10 — real enforcement, appropriate complexity | Model A + Model B |
| M3 (v1 — as "guard") | 5/10 — misleading name, partial visibility | Model A |
| v2 overall structure | **Approved for implementation** (per Model B), subject to POST-only M1 fix | Model B |

---

## Cross-References

| Resource | Relevance |
|---|---|
| `src/nginx/nginx.conf` lines 61–64, 195–205 | Existing `limit_req_zone` definitions and `/auth/` location block (source-truthed proxy config for M1) |
| `src/nginx/nginx.ci.conf`, `src/nginx/nginx.local.conf` | Mirror configs for CI and local dev — must also be updated |
| `src/backend/utils/public_abuse.py` | `rate_limit_public()` helper — pattern for M2 Option B's per-email rate limit |
| `src/backend/api/routes/auth.py:401` | Existing `POST /api/auth/forgot-password` hint (post-login-failure, not the Keycloak-native reset) |
| `src/keycloak/themes/wims-bfp/login/login.ftl` | Custom login theme — only relevant if M2 UI-friction JS is implemented |
| `system-wiki/security/security-baseline.md` §Nginx Edge Rate Limiting for Keycloak | Existing nginx keycloak rate limit documentation — update after M1 deploy |
| `system-wiki/security/security-baseline.md` §Public Abuse Controls | Existing Redis sliding-window rate limiter patterns |
| `src/backend/tests/test_rate_limiting.py` | Existing rate limit test patterns |
| Brevo pricing page | 300 emails/day free tier; 9,000/month |

---

*This is a design spec (v2). The implementation plan will be at `docs/superpowers/plans/2026-06-24-password-reset-abuse-detection.md`. v2 was driven by two independent SOTA model reviews that identified the same structural issues in v1: M2's soft-gate illusion, M1's GET/POST method blindness, and the proxy block copy-vs-invent risk. v2 resolves all three.*
