# Spec Review Synthesis — Civilian Contributor Enhancement (Phases 3 & 4)

**Spec:** `docs/superpowers/specs/2026-07-06-civilian-contributor-enhancement-design.md`
**Reviewed by:** devops, qa, security, architect, product (5 voices)
**Date:** 2026-07-11

---

## BLOCKERS

### Phase 3 — CAPTCHA (Cloudflare Turnstile)

| # | Finding | Voices | File/Location |
|---|---------|--------|---------------|
| B1 | `services/captcha.py` is an empty stub — no `verify_turnstile()` function exists | 5/5 | `src/backend/services/captcha.py:1-5` |
| B2 | `CivilianReportCreate` schema has no `turnstile_token` field | 5/5 | `src/backend/schemas/civilian.py:15-34` |
| B3 | `CivilianReportAppend` schema has no `turnstile_token` field | 3/5 | `src/backend/schemas/civilian.py:50-68` |
| B4 | `submit_civilian_report` endpoint has no `optional_auth` dependency, no CAPTCHA call, no registered/anonymous branch | 5/5 | `src/backend/api/routes/civilian.py:334` |
| B5 | Photo upload endpoint has no CAPTCHA for anonymous users | 3/5 | `src/backend/api/routes/civilian.py:1044` |
| B6 | Append endpoint has no CAPTCHA for anonymous users (doesn't even use `optional_auth`) | 3/5 | `src/backend/api/routes/civilian.py:829` |
| B7 | No `TURNSTILE_SITE_KEY` or `TURNSTILE_SECRET_KEY` env vars in any config | 4/5 | `.env.example`, `docker-compose.yml` |
| B8 | Frontend has zero Turnstile integration — no widget, no `turnstile_token` in payload types | 3/5 | `src/frontend/src/lib/api/legacy.ts` |

### Phase 4 — Registered Contributor Endpoints

| # | Finding | Voices | File/Location |
|---|---------|--------|---------------|
| B9 | `services/contributor.py` is an empty stub — no trust score engine, no dashboard/leaderboard queries | 5/5 | `src/backend/services/contributor.py:1-5` |
| B10 | None of the 4 contributor endpoints exist (`/contributor/me`, `/reports`, `/stats`, `/leaderboard`) | 5/5 | `src/backend/api/routes/` |
| B11 | No `ContributorProfileResponse`, `ContributorStatsResponse`, or leaderboard Pydantic schemas | 5/5 | `src/backend/schemas/civilian.py` |
| B12 | `REGISTERED_REPORT_HOURLY_CAP` not defined — registered users get same 3/hr as anonymous | 3/5 | `src/backend/utils/rate_limit.py` |
| B13 | No auth detection branching in submit endpoint — `contributor_user_id` never set for registered reporters | 4/5 | `src/backend/api/routes/civilian.py:334` |

---

## WARNINGS

| # | Finding | Priority | Location |
|---|---------|----------|----------|
| W1 | Offline-first report submission bypasses CAPTCHA entirely (accepted gap for prototype) | Medium | `src/frontend/src/lib/api/offlineCivilian.ts` |
| W2 | No audit trail for CAPTCHA failures — can't detect abuse patterns | Medium | `services/captcha.py` (stub) |
| W3 | No rate limit on photo upload endpoint — storage exhaustion vector | High | `src/backend/api/routes/civilian.py:1044` |
| W4 | Test Turnstile keys could leak to production — no startup validation | Low | `.env.example` |
| W5 | Trust score photo-bonus query blocked by `report_photos` RLS (CIVILIAN_REPORTER denied SELECT) | High | `src/postgres-init/82_civilian_report_photos.sql:206-213` |
| W6 | Leaderboard endpoint leaks PII — no opt-in, no rate limit for scraping | High | Spec §8.3 (not yet built) |
| W7 | No rate limits on Phase 4 authenticated endpoints | Medium | Spec §8.3 (not yet built) |
| W8 | Routing `execution_path` values mismatch between spec (`"sync"`) and code (`"inline_after_commit"`) | Low | `src/backend/services/routing.py:42` |
| W9 | No synchronous OSRM attempt at submission time (always defers to Celery) | Medium | `src/backend/api/routes/civilian.py:612` |
| W10 | `exif_data JSONB` in spec stores raw EXIF as plaintext — implementation correctly encrypts it | Low | Spec §7.2 vs implementation |
| W11 | AAD template in spec underspecified — doesn't match implementation's per-artifact AAD | Low | Spec §7.4 |
| W12 | Encrypted metadata blob in spec doesn't match implementation | Low | Spec §7.4 |
| W13 | No `optional_civilian_reporter` utility dependency — risk of inconsistent role checks | Low | `src/backend/auth.py` |
| W14 | Existing `_trust_score` in civilian.py is a per-report heuristic, not the Phase 4 accumulated score | Low | `src/backend/api/routes/civilian.py:182` |
| W15 | Celery worker has no healthcheck and insufficient `stop_grace_period` | Low | `src/docker-compose.yml` |

---

## INFOS

- `optional_auth` dependency at `auth.py:307` exists and is correct ✓
- Schema foundation (migration 0004/0005, `contributor_user_id`, `report_photos`, RLS) is in place ✓
- Photo pipeline (`services/report_photos.py`) is substantially implemented per spec §7 ✓
- Orphan photo cleanup is correctly configured as Celery beat task ✓
- `get_photo_db` RLS-scoped session dependency exists ✓

---

## Prioritized Action Plan

### Must do before Phase 3 implementation
1. **B1** — Implement `verify_turnstile()` in `services/captcha.py` (Cloudflare siteverify POST, 3s timeout, error handling)
2. **B2, B3** — Add `turnstile_token: str | None` to `CivilianReportCreate` and `CivilianReportAppend` schemas
3. **B4-B6** — Inject `optional_auth` into all 3 anonymous endpoints, add `if user is None: verify_turnstile(...)` guard
4. **B7** — Add `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` to `.env.example` and `docker-compose.yml`
5. **B8** — Add Turnstile React widget to report form, add `turnstile_token` to frontend payload types

### Must do before Phase 4 implementation
6. **B9** — Implement `services/contributor.py` with trust score formula (§6.1), badge levels (§6.2), dashboard aggregation, leaderboard query
7. **B10** — Add 4 routes under `/api/civilian/contributor/` gated on `CIVILIAN_REPORTER` role
8. **B11** — Add `ContributorProfileResponse`, `ContributorStatsResponse`, leaderboard schemas
9. **B12** — Add `REGISTERED_REPORT_HOURLY_CAP = 20` to `rate_limit.py`

### Should fix alongside
10. **W5** — Add SECURITY DEFINER helper or RLS policy for trust score photo-bonus queries
11. **W3** — Add rate limit to photo upload endpoint
12. **W9** — Add inline OSRM attempt before Celery fallback (spec §4.2 design)
13. **W2** — Add audit logging for CAPTCHA failures
14. **W8** — Align `routing_execution_path` values with spec

### Spec documentation fixes
15. **W10, W11, W12** — Update spec §7 to match implementation (encrypted metadata blob, per-artifact AAD)
16. **W14** — Clarify per-report vs accumulated trust score coexistence
