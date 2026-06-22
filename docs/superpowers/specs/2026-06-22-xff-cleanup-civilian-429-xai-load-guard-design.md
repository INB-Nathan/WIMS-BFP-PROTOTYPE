# Design: XFF→trusted_client_ip cleanup, civilian 429 error specificity, XAI load guard

- **Date:** 2026-06-22
- **Status:** Draft (awaiting user review)
- **Owner:** Natekatsu
- **Related:** PR #446 (Gwen — rate limiter anchored to TCP socket IP), issue #419 (XAI never runs on default page load), issue #415 (summary rollup — deferred), the 2026-06-22 IP blocklist feature (commits `b77218b7`..`f085b305`)
- **Time pressure:** Mock defense on 2026-06-26. This spec covers only work that is (a) low-risk, (b) directly demo-protective, or (c) closes a real security bypass. #444 (eval dataset) is parked until after this lands.

## Motivation

Three independent gaps survived the IP-blocklist feature merge and PR #446. All three are small, independent, and share a theme: **close the gaps #446 left + the civilian HCI gap it did not address + lock in the no-XAI-on-load behavior that protects the demo from a 504.**

1. **XFF spoofing still bypasses two app-layer rate limiters.** PR #446 anchored the *civilian report DB rate limiter* to `trusted_client_ip` and extracted the helper into `utils/audit.py`, but explicitly left a P2 follow-up list. The `/api/auth/callback` POST login rate limiter (`main.py:780-785`) and the public consent rate limiter (`consent.py:41`) still parse `X-Forwarded-For` leftmost — spoofable, bypassable. Fifteen more `get_client_ip` (deprecated XFF alias) call sites across 4 files (`incidents.py`, `validator.py`, `afor.py`, `encoder_crud.py`) record audit-trace IPs through the same spoofable path. The nginx blocks in front of those 15 call sites still set `X-Real-IP $remote_addr` (post-realip XFF-derived), so even reading `X-Real-IP` is spoofable there until the nginx blocks are fixed too.
2. **Civilian 429 error is not specific.** When a civilian hits the 3-submission rate limit, the frontend shows a generic alarming "Submission failed. Please try again." + the "call 911 for immediate danger" boundary — because `public-transport.ts:40` throws a plain `Error` without attaching `.status`, so `page.tsx:950-956` cannot classify the 429 and falls through to the `'unknown'` branch. The backend already returns a specific 429 with `Retry-After` (`civilian.py:342-345`); the frontend just can't see the status code. Gwen even pre-added `Retry-After` to the CORS exposed headers in all 3 nginx configs — the frontend can already read the header; it just doesn't.
3. **#419 — XAI enrichment must never run on default page load.** A defense demo that 504s when the panel opens `/admin/monitoring` is a demo-killer. The current code already satisfies this (verified: `analyze_threat_log` has only 2 production call sites — the manual `POST /analyze` endpoint and the Celery background queue; neither the summary endpoint nor any page-load effect calls it). But there is no regression test locking that behavior in. A future change could silently reintroduce XAI-on-load and 504 the demo. #419 adds the regression coverage.

## Goals

### Workstream 1 — XFF → `trusted_client_ip` migration (Scope B: Tiers 1-3)

- **Tier 1 (P0 — bypassable rate limiters):**
  - `main.py:780-785`: replace the 4-line XFF parse in `rate_limit_middleware` with `client_ip = trusted_client_ip(request)`. Import from `utils.audit`. Closes login brute-force bypass on `/api/auth/callback`.
  - `consent.py:41`: swap `get_client_ip(request)` → `trusted_client_ip(request)` (import change). Closes public-consent flood bypass (5/hr).
- **Tier 2 (audit-trace call sites — 15):**
  - `incidents.py:527`, `regional/validator.py:315/589/647/696` (4), `regional/afor.py:185`, `regional/encoder_crud.py:303/398/440/509/533/553/572/668/700` (9): swap `get_client_ip(request)` → `trusted_client_ip(request)`. Import changes in 4 files. These record `request_ip` for audit/lifecycle — integrity fix, fully trustworthy only after Tier 3. **Total `get_client_ip` usage call sites: 16** (1 consent Tier 1 + 15 audit Tier 2), matching the "16 existing call sites" count in the `_legacy_get_client_ip_from_xff` docstring.
- **Tier 3 (nginx defense-in-depth):**
  - `nginx.conf`, `nginx.local.conf`, `nginx.ci.conf`: change `X-Real-IP $remote_addr` → `X-Real-IP $realip_remote_addr` on the ~5-6 remaining location blocks (auth, admin, frontend, etc.) that Gwen did not touch. This makes `X-Real-IP` carry the TCP socket IP everywhere, making Tier 2's reads trustworthy. Extend `test_nginx_forwarded_headers.py` to parameterize over ALL location blocks (currently only covers the 2 public/civilian blocks Gwen fixed).

### Workstream 2 — Civilian 429 error specificity (Option B: classify + timing)

- **Backend (1 line):** `civilian.py:342-345` detail string becomes `"Too many reports from this network. Try again in {minutes} minutes."` where `minutes` is derived from `retry_after` (ceiling, min 1). Self-contained for non-browser clients; the `Retry-After` header (seconds) stays the canonical machine-readable value.
- **Frontend transport (the root cause):** `public-transport.ts:39-40` — throw `ApiRequestError` (reused from `transport.ts`) with `.status` + extract `Retry-After` response header → new optional `.retryAfter` field on `ApiRequestError`. This is the one-line bug that makes the 429 classifiable.
- **Frontend UI:** `page.tsx:950-958` — status extraction already works once transport attaches `.status` (the `rate_limit` branch at line 955 fires). Add `retryAfter` extraction and render "Too many reports from this network. Try again in {minutes} minutes." in the `rate_limit` branch (replacing the current generic "Too many reports from this network." / "Try tracking or updating an existing report instead."). The "call 911" emergency boundary stays for `'server'`/`'unknown'` — only the rate-limit case gets the specific timing message.

### Workstream 3 — #419 XAI load guard (regression tests + guardrails)

- **Backend regression test:** patch `services.ai_service.analyze_threat_log` and invoke `GET /api/admin/security-logs/summary`; assert the analyze function is never called. Locks in that the summary endpoint reads already-computed fields only.
- **Frontend regression tests:**
  - `/admin/monitoring` initial render does not call `analyzeSecurityLog` (mock the API client, assert no analyze call on mount).
  - `/admin/system` initial render does not call `analyzeSecurityLog` on mount.
  - Clicking the manual Analyze button still calls the analyze helper exactly once for the selected row (proves we didn't break manual analysis).
- **Guardrails (only if a load path is found that currently calls analyze):** move any implicit analysis behind an explicit action name. Per the code investigation, no such path exists today — this is expected to be a no-op, but the task includes a verification pass.
- **Background queue:** `process_ai_queue` remains gated by `auto_ai_analysis_enabled`. No change to the Celery path.

## Non-goals

- **Tier 4 (test fidelity sweep):** other backend tests that send `X-Forwarded-For` headers (`test_privacy.py`, `test_rate_limiting.py`, `test_breach_notifications.py`, `test_system_monitoring.py`). Deferred — hygiene, no security impact once the app layer reads `X-Real-IP`.
- **Tier 5 (legacy alias removal):** removing the deprecated `get_client_ip` / `_legacy_get_client_ip_from_xff` alias. Deferred — dead-code hygiene. The alias stays with its deprecation docstring until all call sites are migrated; after Workstream 1 (Tier 1 + Tier 2), all 16 production usage call sites are migrated to `trusted_client_ip`, and the alias can be removed in a follow-up.
- **Option C (submission count in message):** embedding "maximum of 3 reports per hour" into the message. Couples the string to the config value; the `Retry-After` header already carries the actionable timing without that coupling.
- **Secondary 429s in `civilian.py`:** the append/followup/notification rate-limit responses at `civilian.py:506/621-628/804-806`. Same pattern, different user flow. Flagged as a follow-up; not in this spec.
- **#415 (summary rollup fields):** `by_classification`, `collapsed_background_noise`, `top_sources`, `top_sids`, `recent_high_signal`. Blocked by migration 62 (`classification` column not applied to the running DB) and out of the defense window. See "Deviations" below.
- **#444 (eval dataset):** parked. Will be planned separately after this spec lands.
- **The other 16 open GitHub issues:** out of scope for the defense window. See the triage note in the final response.

## Deviations from issue specs

### #419 — blocked by #415 (bypassed, justified)

Issue #419 states "Blocked by: #415." #415 (extend summary API with rollup-backed intelligence) is OPEN, `ready-for-agent`, and itself depends on the `classification` column from migration `62_security_threat_classification.sql` — which has never been applied to the running DB (the same first-boot-only `postgres-init/` problem documented in the blocklist wiki). #415 is therefore out of the defense window.

The blocker relationship is logical: #415 changes the summary endpoint shape, so #419's regression tests on that endpoint would need rewriting after #415 lands. But:

1. #419's goal (no XAI on page load) is **already satisfied by the current code** — verified by tracing every `analyze_threat_log` call site (only `security.py:358` manual endpoint + `ai_forwarding.py:123` Celery queue) and every page-load `useEffect` (monitoring and system pages call summary/logs/health/metrics, never analyze).
2. #419 is therefore a **regression-test task that locks in existing good behavior**, not a behavior change that #415 would invalidate.
3. The defense needs the 504 guardrail more than it needs the #415 rollup fields.

**Decision:** proceed with #419 now. The regression tests assert behavior (no analyze call on load), not response shape, so they survive a future #415 landing with at most minor fixture updates. This deviation is stated here per AGENTS.md gotcha #16; the user can reject it during spec review.

## Architecture

### Workstream 1 — trust chain

```
nginx (realip module)          app layer
─────────────────────          ────────────────────────────────
$realip_remote_addr  ───────►  X-Real-IP header
(TCP socket IP)                  │
                                 ▼
                               trusted_client_ip(request)
                                 = X-Real-IP first, socket peer fallback
                                 NEVER reads X-Forwarded-For
                                 │
                                 ▼
                               rate limiter key / audit request_ip
```

Tier 3 (nginx) makes the chain trustworthy for all routes. Tier 1+2 (app) makes the app read the trustworthy value. Both halves are required; either alone is insufficient.

**Why `X-Real-IP` and not `X-Forwarded-For`:** nginx's realip module overwrites `$remote_addr` from the `X-Forwarded-For` header when the request comes from a `set_real_ip_from` trusted source (the Docker bridge). `$realip_remote_addr` is the TCP socket peer — the actual connecting IP, not a header. Gwen's PR #446 sets `X-Real-IP $realip_remote_addr` on the public/civilian blocks and `X-Forwarded-For $realip_remote_addr` (overwriting any client-supplied XFF). `X-Forwarded-For` is client-controlled in local/CI (appended via `$proxy_add_x_forwarded_for`); `X-Real-IP` is set by nginx and not client-appendable in any config. `trusted_client_ip` reads `X-Real-IP` first — the correct trust ordering.

### Workstream 2 — error classification chain

```
backend civilian.py:342-345
  429 + detail("Too many reports... Try again in {min} minutes.") + Retry-After: {seconds}
       │
       ▼
nginx (Retry-After in Access-Control-Expose-Headers — already set by #446)
       │
       ▼
public-transport.ts:39-40  (THE BUG — currently throws plain Error, no .status)
  AFTER FIX: throw new ApiRequestError(detail, status=429, retryAfter=seconds)
       │
       ▼
page.tsx:950-958 catch
  status = err.status  → 429  →  type = 'rate_limit'
  retryAfter = err.retryAfter  →  minutes = ceil(retryAfter/60)
       │
       ▼
render: "Too many reports from this network. Try again in {minutes} minutes."
  (NOT the generic "Submission failed. Please try again." + "call 911" boundary)
```

`ApiRequestError` already exists in `transport.ts:11-19` with `.status` + `.detail`. Workstream 2 adds an optional `.retryAfter: number | undefined` field and reuses the class from `public-transport.ts` (currently it throws a plain `Error`). No new error class.

### Workstream 3 — regression test shape

Backend test (`test_security_monitoring.py`):
```python
def test_summary_endpoint_does_not_call_xai(db_session, mock_system_admin):
    with patch("api.routes.admin.security.analyze_threat_log") as mock_analyze:
        # ... insert fixture rows ...
        response = client.get("/api/admin/security-logs/summary", ...)
        mock_analyze.assert_not_called()
        assert response.status_code == 200
```

Frontend tests (monitoring + system page test files): render the page, mock the API client module, assert `analyzeSecurityLog` is not in the list of called functions after mount, then simulate a manual Analyze click and assert it is called exactly once.

## Security review notes

This spec adopts the same trust-chain principles as the IP blocklist feature and PR #446:

1. **`X-Real-IP` primary, never `X-Forwarded-For` leftmost.** Same rule as the blocklist service helper. `trusted_client_ip` already implements this; Workstream 1 makes all app-layer consumers use it.
2. **Self-IP guard not applicable here** — no new block endpoints; Workstream 1 only changes how existing rate limiters and audit logs derive the client IP.
3. **Fail-open unchanged.** `main.py` rate limiter fails open if Redis down (line 776-777). `consent.py` uses `rate_limit_public` (fail-closed per its docstring "D6" — unchanged). Neither changes failure mode.
4. **`Retry-After` upper bound** already enforced by #446 (`RETRY_AFTER_CEILING_SECONDS`). Workstream 2's `{minutes}` derivation respects the same ceiling — it reads the `retry_after` value the backend already computed, not a raw header.
5. **No new LLM calls** (#419 non-goal). The background `process_ai_queue` remains gated by `auto_ai_analysis_enabled`.
6. **CORS exposed headers** — Gwen already added `Retry-After` to `Access-Control-Expose-Headers` in all 3 nginx configs. Workstream 2's frontend reading of `Retry-After` works without further nginx changes.

## Testing strategy

**TDD per workstream, per tier.** Failing test first → red → implement → green → ruff/lint → commit.

### Workstream 1
- **Tier 1:** backend test — send a request with a spoofed `X-Forwarded-For` but a different `X-Real-IP`; assert the rate limiter keys on the `X-Real-IP` value (not the spoofed XFF). RED on current code (keys on XFF), GREEN after swap.
- **Tier 2:** audit-trace test — assert the recorded `request_ip` equals the `X-Real-IP` value, not the spoofed XFF.
- **Tier 3:** extend `test_nginx_forwarded_headers.py` to parameterize over ALL location blocks in all 3 configs; assert every block sets `X-Real-IP $realip_remote_addr` (not `$remote_addr`).

### Workstream 2
- **Transport unit test:** mock `fetch` returning a 429 with `Retry-After: 3600` + JSON detail; assert `publicApiFetch` throws `ApiRequestError` with `.status === 429` and `.retryAfter === 3600`. RED on current code (throws plain `Error`, no `.status`).
- **Page test:** render `page.tsx`, mock the API client to reject with an `ApiRequestError` (status 429, retryAfter 3600), submit the form, assert the rendered error text contains "Too many reports" and "Try again in 60 minutes" and does NOT contain the generic "Submission failed" or "call 911" boundary text.

### Workstream 3
- Backend + frontend regression tests as described in Architecture. All expected to be RED→GREEN on the first run (tests assert behavior that already holds; if a test is GREEN immediately, that's fine — it still locks in the behavior).

### CI pre-flight (before push)
1. `cd src/backend && ruff check .`
2. `cd src/backend && ruff format --check .`
3. `cd src/backend && pytest -v` (blocklist + rate-limit + nginx-forwarded + civilian + security-monitoring tests)
4. `cd src/frontend && npm run lint`
5. `cd src/frontend && npx vitest run`
6. `cd src/frontend && npm run build` (with `NEXT_PUBLIC_AUTH_API_URL` + `NEXT_PUBLIC_BASE_URL` env vars)

## Build order / deployment

1. **Workstream 1 Tier 1** (P0 rate limiters) — ship first; closes the login brute-force bypass.
2. **Workstream 1 Tier 3** (nginx) — ship before Tier 2 so Tier 2's reads are trustworthy.
3. **Workstream 1 Tier 2** (audit call sites) — ship after Tier 3.
4. **Workstream 2** (civilian 429) — independent; can ship in parallel with Workstream 1.
5. **Workstream 3** (#419 regression tests) — independent; can ship in parallel.
6. **Full 6-gate CI pre-flight** before push to `origin/master`.
7. **No prod migration step.** Workstream 1 touches no DB schema. Workstream 2 changes a `detail` string only. Workstream 3 adds tests only. The deploy workflow's existing migration step is unaffected.

## Open questions

1. **`ApiRequestError` reuse vs. new `PublicApiRequestError`:** `ApiRequestError` lives in `transport.ts` (the authenticated transport). Reusing it from `public-transport.ts` creates a cross-import. Alternative: duplicate the class as `PublicApiRequestError` with the same shape + `.retryAfter`. **Recommendation:** reuse — the class is generic (status + detail + message), and a duplicate creates drift risk. The import is one line.
2. **`retryAfter` field name:** `.retryAfter` (seconds, matching the header) vs. `.retryAfterMinutes` (pre-converted). **Recommendation:** `.retryAfter` in seconds — matches the header semantics, conversion to minutes happens at the render site where the UI string is built.

## Acceptance criteria

### Workstream 1
- [ ] `main.py` `rate_limit_middleware` uses `trusted_client_ip`; spoofed XFF does not change the rate-limit key.
- [ ] `consent.py` uses `trusted_client_ip`; spoofed XFF does not change the rate-limit key.
- [ ] All 15 audit-trace call sites (`incidents.py`, `validator.py` ×4, `afor.py`, `encoder_crud.py` ×9) use `trusted_client_ip`.
- [ ] All location blocks in all 3 nginx configs set `X-Real-IP $realip_remote_addr`; `test_nginx_forwarded_headers.py` parameterizes over all blocks.
- [ ] Zero production usage call sites of `get_client_ip` remain (all 16 migrated: 1 consent + 15 audit; the alias is retained with its deprecation docstring for the Tier 5 removal follow-up).

### Workstream 2
- [ ] `public-transport.ts` throws `ApiRequestError` with `.status` + `.retryAfter` on non-OK responses.
- [ ] `page.tsx` renders the specific "Too many reports... Try again in {minutes} minutes." message on a 429, not the generic "Submission failed" + "call 911" boundary.
- [ ] `civilian.py:344` detail string includes the retry minutes.

### Workstream 3
- [ ] Summary endpoint has regression coverage proving no inline XAI call.
- [ ] Both admin pages have regression coverage proving no analyze call on initial render.
- [ ] Manual Analyze behavior remains available and tested (called exactly once on click).
- [ ] No change makes Ollama availability required for dashboard load.

### Cross-cutting
- [ ] All 6 CI gates green.
- [ ] `system-wiki/security/security-baseline.md` updated (XFF cleanup completes the #446 follow-up; note the `get_client_ip` deprecation + Tier 5 follow-up).
- [ ] `system-wiki/log.md` feature entry appended.
- [ ] `system-wiki/gaps/frs-codebase-gap-register.md` — close the "rate-limiter XFF bug (pre-existing)" high-risk verification target entry added by the blocklist feature.
