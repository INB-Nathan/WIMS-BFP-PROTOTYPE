# Implementation Plan — Civilian Contributor Enhancement (Phases 3 & 4)

**Spec:** `docs/superpowers/specs/2026-07-06-civilian-contributor-enhancement-design.md`
**Synthesis:** `.pi/chain-runs/spec-review/synthesis.md`
**Date:** 2026-07-11
**Decision log:**
- Turnstile CAPTCHA kept (spec overrides FRS Module 14(vii))
- Offline replay without Turnstile is accepted prototype gap
- CAPTCHA on real post-submit photo route, not orphan pre-upload
- Leaderboard API in Phase 4 (data endpoint only, no UI)
- Phase 5 = CMS for safety content + events + incident viewing (deferred)

---

## Phase 3 — CAPTCHA / Turnstile Integration

### Slice 3A — Backend service + schema

**Files:**
| File | Action |
|------|--------|
| `src/backend/services/captcha.py` | Implement `verify_turnstile(token, ip)` |
| `src/backend/schemas/civilian.py` | Add `turnstile_token: str \| None` to `CivilianReportCreate`, `CivilianReportAppend` |
| `src/backend/utils/rate_limit.py` | No change (constants exist) |

**Details:**

1. `services/captcha.py` — Replace stub with:
   ```python
   import httpx
   TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
   
   async def verify_turnstile(token: str, remote_ip: str | None = None) -> bool:
       """Verify a Turnstile token. Returns True on success, raises HTTPException(429) on failure."""
       secret = os.environ["TURNSTILE_SECRET_KEY"]
       data = {"secret": secret, "response": token}
       if remote_ip:
           data["remoteip"] = remote_ip
       async with httpx.AsyncClient(timeout=3.0) as client:
           resp = await client.post(TURNSTILE_VERIFY_URL, data=data)
           resp.raise_for_status()
           result = resp.json()
           if not result.get("success"):
               # Include error-codes in audit log
               logger.warning("Turnstile verification failed: %s", result.get("error-codes"))
               raise HTTPException(status_code=429, detail="CAPTCHA verification failed")
           return True
   ```

2. `schemas/civilian.py` — Add to both schemas:
   ```python
   turnstile_token: str | None = Field(default=None, max_length=2048)
   ```

### Slice 3B — Endpoint CAPTCHA guards

**Files:**
| File | Action |
|------|--------|
| `src/backend/api/routes/civilian.py` | Inject `optional_auth` + CAPTCHA guard in 3 endpoints |

**Endpoints to modify:**

1. `submit_civilian_report` (line ~334):
   - Add `user: Annotated[dict | None, Depends(optional_auth)] = None`
   - After `device_id` extraction, before rate-limit check:
     ```python
     if user is None:
         await verify_turnstile(body.turnstile_token, trusted_client_ip(request))
     ```
   - When `user is not None and user.get("role") == "CIVILIAN_REPORTER"`:
     - Set `contributor_user_id = user["user_id"]`
     - Use `REGISTERED_REPORT_HOURLY_CAP = 20` for rate limit (add constant)
   - Keep `device_id` for ALL submitters (anonymous + registered) for device-based ownership

2. `append_civilian_report` (line ~829):
   - Add `user: Annotated[dict | None, Depends(optional_auth)] = None`
   - Gate CAPTCHA on `user is None`

3. `upload_report_photo` (line ~1044):
   - Already uses `optional_auth` ✓
   - Add `if user is None: await verify_turnstile(turnstile_token, ...)` before upload

### Slice 3C — Frontend Turnstile widget

**Files:**
| File | Action |
|------|--------|
| `src/frontend/package.json` | Add `@cloudflare-turnstile` dependency |
| `src/frontend/src/app/report/page.tsx` | Add Turnstile widget to report form |
| `src/frontend/src/lib/api/legacy.ts` | Add `turnstile_token` to `CivilianReportV2Payload` |
| `src/frontend/src/lib/api/public-transport.ts` | Add `fetchWithOptionalAuth` wrapper |

**Details:**

1. **`fetchWithOptionalAuth` transport** — New wrapper that includes `credentials: 'include'` but catches 401 without redirecting to login. Pattern:
   ```typescript
   export async function fetchWithOptionalAuth(url: string, options?: RequestInit): Promise<Response> {
     const res = await fetch(url, { ...options, credentials: 'include' });
     if (res.status === 401) return res; // Don't redirect — optional_auth handles this
     return res;
   }
   ```
   Use this for civilian report/photo/append endpoints so registered users' cookies reach the backend while anonymous users get no redirect.

2. **Turnstile widget** — Drop into the report form's anonymous flow:
   ```tsx
   <Turnstile siteKey={NEXT_PUBLIC_TURNSTILE_SITE_KEY!} onVerify={(token) => setTurnstileToken(token)} />
   ```

3. **Payload** — Pass `turnstileToken` in `CivilianReportV2Payload` on submit.

### Slice 3D — Env vars + config

| File | Action |
|------|--------|
| `.env.example` | Add `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (with test key defaults) |
| `src/.env.production.example` | Add both keys (no defaults) |
| `src/docker-compose.yml` | Add both keys to `backend` service env block |
| `src/docker-compose.yml` | Add `TURNSTILE_SITE_KEY` to `frontend` service env block |

### Slice 3E — Tests

| File | Action |
|------|--------|
| `src/backend/tests/test_captcha.py` | Unit tests for `verify_turnstile()` |
| `src/backend/tests/integration/test_civilian_captcha.py` | Integration tests: anonymous requires token, registered skips, invalid token → 429 |

---

## Phase 4 — Registered Contributor Endpoints

### Slice 4A — Trust score foundation

**Files:**
| File | Action |
|------|--------|
| `src/backend/services/contributor.py` | Implement trust score engine + aggregation queries |
| `src/backend/schemas/civilian.py` | Add `ContributorProfileResponse`, `ContributorStatsResponse`, `LeaderboardEntry` |
| `src/backend/utils/rate_limit.py` | Add `REGISTERED_REPORT_HOURLY_CAP: int = 20` |
| New SQL migration or Alembic 0006 | Add SECURITY DEFINER function for photo bonus query |

**Details:**

1. `services/contributor.py` — Implement:
   - `compute_trust_score(user_id)` — Per spec §6.1 formula:
     ```python
     volume_credit = min(40, report_count * 2)  # +2/report, cap 40
     accuracy_bonus = actioned_count * 5        # +5 per ACTIONED, no cap
     photo_bonus = sum(photo_bonus_per_report)   # aggregated per-report
     decay = inactive_months * 2                 # -2/month, floor 0
     return max(0, min(100, volume_credit + accuracy_bonus + photo_bonus - decay))
     ```
   - `get_contributor_profile(user_id)` — Stats + trust score + badge mapping
   - `get_contributor_reports(user_id, page, limit)` — Paginated report history
   - Badge levels: `0-19` Novice, `20-49` Regular, `50-79` Trusted, `80-100` Guardian

2. **RLS workaround for photo bonus (W5):** Add SECURITY DEFINER function to DB:
   ```sql
   CREATE OR REPLACE FUNCTION wims.get_photo_bonus_components(p_report_id INTEGER)
   RETURNS TABLE(gps_consensus TEXT, photo_reported_distance_m NUMERIC)
   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wims, pg_temp
   AS $$
       SELECT gps_consensus, photo_reported_distance_m
       FROM wims.report_photos
       WHERE report_id = p_report_id;
   $$;
   REVOKE ALL ON FUNCTION wims.get_photo_bonus_components(INTEGER) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION wims.get_photo_bonus_components(INTEGER) TO wims_app;
   ```
   This goes in a new Alembic revision (0006) or as a startup DDL patch. The trust score computation calls this function scoped to the authenticated user's own reports.

3. `rate_limit.py` — Add:
   ```python
   REGISTERED_REPORT_HOURLY_CAP: int = 20
   ```

### Slice 4B — Contributor API routes

**Files:**
| File | Action |
|------|--------|
| `src/backend/api/routes/civilian.py` | Add 4 new routes at `/api/civilian/contributor/` |
| OR new `src/backend/api/routes/contributor.py` | Separate route file for contributor endpoints |

**Endpoints:**

1. `GET /api/civilian/contributor/me` — `Depends(get_current_wims_user)` + `CIVILIAN_REPORTER` role check → `ContributorProfileResponse`
2. `GET /api/civilian/contributor/reports` — `?page=1&limit=20` → paginated report list with routing data + photo count
3. `GET /api/civilian/contributor/stats` — Lifetime stats, per-month aggregation, badge history
4. `GET /api/civilian/contributor/leaderboard` — Top-N contributors by trust score (rate-limited, opt-in only)

Each delegates to `services/contributor.py`.

### Slice 4C — Auth branching in submit endpoint

Already covered in Slice 3B. The `submit_civilian_report` endpoint gets `optional_auth` which enables:
- Registered users: `contributor_user_id` set, rate limit 20/hr, no CAPTCHA
- Anonymous: rate limit 3/hr, Turnstile required, `contributor_user_id = NULL`

### Slice 4D — Tests

| File | Action |
|------|--------|
| `src/backend/tests/test_contributor.py` | Unit tests for trust score formula (clamping, badge boundaries, decay, photo bonus) |
| `src/backend/tests/integration/test_contributor_endpoints.py` | Integration tests: 401 without auth, 200 with valid JWT, profile fields, stats counts, leaderboard ordering |

---

## Wiki synchronization

After each merged phase, run `wims-workflow.pr-ready` chain which calls the wiki synchronizer to update:
- `system-wiki/backend/api-route-map.md` — new endpoints
- `system-wiki/database/schema-overview.md` — any new tables/functions
- `system-wiki/subsystems/civilian-reporting-phase2.md` — Phase 3/4 additions
- `system-wiki/log.md` — log entry per merge

---

## Dependency graph

```
Phase 3A (service + schema)
    │
    ├──→ Phase 3B (endpoint guards) ──→ Phase 3C (frontend widget)
    │                                       │
    │                                       └──→ Phase 3D (env vars)
    │
    └──→ Phase 3E (tests)
              │
              v
         [MERGE Phase 3]
              │
              v
Phase 4A (trust score + RLS function + schema)
    │
    ├──→ Phase 4B (contributor routes)
    │       │
    │       └──→ Phase 4C (auth branching — shares Slice 3B changes)
    │
    └──→ Phase 4D (tests)
              │
              v
         [MERGE Phase 4]
              │
              v
         Wiki sync (pr-ready chain)
```

Parallelizable: 3C + 3D can overlap with 3B. 4C is already done as part of 3B.
