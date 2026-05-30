# Re-Review: PR #179 — feat/kanban-batch-1

**Reviewed:** `feat/kanban-batch-1` @ `9e9b6dc`
**Prior review:** `079413f` — REQUEST CHANGES (4 blockers B1-B4, 9 suggestions S1-S9)
**Base:** `master` @ `f47c448` (merge-base)
**Size since prior review:** 16 non-merge fix commits + 2 merge commits (master sync + public-pages merge)
**Date:** 2026-05-31

---

## Review History

| Review | SHA | Verdict | Blockers |
|--------|-----|---------|----------|
| 1st (2026-05-30) | `2313a5e` | REQUEST CHANGES | 7 blocking |
| **2nd (2026-05-30)** | `079413f` | **REQUEST CHANGES** | **4 new blocking (B1-B4)** |
| **3rd (this)** | `9e9b6dc` | **APPROVE** | **All 4 resolved** |

---

## BLOCKING — Resolved ✓

| # | Prior Blocker | Fix Commit(s) | Verification |
|---|---|---|---|
| **B1** — SSE dead from 5 sync endpoints (`asyncio.get_running_loop()` + `except RuntimeError: pass` fails silently in threadpool) | `66c25b1`, `98aa063` | `publish_incident_event_sync()` + `publish_verification_event_sync()` exist in `event_bus.py:262,300`. Called from `regional.py:1600`, `regional.py:2102`, `workflow.py:142`, `workflow.py:472`. `admin.py:705` uses `publish_security_event_sync()`. Only surviving `asyncio.get_running_loop()` is in `correct_verified_incident` (async def, legit — was always working). |
| **B2** — Dead EmergencyPanel + unused state in `PublicFireMapInner.tsx` | `66c25b1` (inferred) | Zero results for `EmergencyPanel`, `emergencyContacts`, `nearbyStations`, or `fetchEmergencyServices` in PublicFireMapInner.tsx. Component and all dead state removed. |
| **B3** — Dead no-op `if not pii_dict: pii_dict = {}` in `regional.py:1423-1424` | `4fa2473` | No matches for `if not pii_dict` or `pii_dict = {}` in `regional.py`. Removed from `incidents.py` and `commit.py` as well. |
| **B4** — Dead Redis pool constants `_REDIS_POOL_SIZE` / `_REDIS_POOL_MAX_CONNECTIONS` never wired | `338993d` | `_REDIS_POOL_MAX_CONNECTIONS = 10` now passed as `max_connections=_REDIS_POOL_MAX_CONNECTIONS` to `aioredis.from_url()` at `map.py:68`. Full backoff mechanism added (`_UNSET` sentinel, `_REDIS_BACKOFF_SECONDS=30`, `_REDIS_RETRY_AFTER` cooldown). |

---

## SUGGESTIONS — Carry-Forward Status

| # | Suggestion | Status | Notes |
|---|---|---|---|
| **S1** — status_filter bind param always included + empty-string gap | ✅ FIXED — `8eb581c` | |
| **S2** — Duplicate xlsx in export filename | ✅ **Fixed @ `3da9744`** | `fmtName` changed to `'excel'` → produces `wims-bfp-excel-...xlsx` |
| **S3** — Dead `EventBus.publish_sync()` in `event_bus.py:83` | ✅ **Fixed @ `3da9744`** | Method removed. Standalone `publish_*_sync()` functions already handle sync publishing. |
| **S4** — Dead `useMap` import in `PublicFireMapInner.tsx` | ✅ **Naturally fixed** | Import only has `useMapEvents`, no `useMap`. |
| **S5** — No-op alias `_resolve_role_from_token` in `events.py:37` | ✅ **Fixed @ `3da9744`** | Removed alias, imported with short alias `resolve_wims_role` directly at the import site. |
| **S6-S9** — Architectural (helpers extraction, regional.py size, CPU health check) | ⏸️ DEFERRED | Deferred/acknowledged scope — not blocking merge. |

---

## Standards

### Praise
- All fix commits use Conventional Commit format with proper scope prefixes (`fix(sse):`, `fix(map):`, `fix(encryption):`) — consistent with repo convention.
- No trailing whitespace or formatting regressions introduced.

### No new violations
The fix commits and conflict resolution conform to the documented standards. No lint or format regressions.

---

## Spec

### Praise
- All 4 blocking items from the prior re-review are resolved and verified in the live code.
- The SSE fix correctly uses the synchronous Redis client (`redis.from_url()` not `aioredis.from_url()`) for threadpool workers — matching the established pattern from `publish_security_event_sync()`.
- The Redis backoff implementation is thorough: distinguishes "never initialized" (`_UNSET`) from "known-bad" (`None`), with a 30-second cooldown to prevent per-request reconnect storms.

### No spec regressions
The merge from master and public-pages-unification did not introduce spec breaks. Conflict resolution retained the correct side of each conflict.

---

## Quality

### Praise
- **F811 fix** (`9e9b6dc`): Cleanly removed the duplicate import `apply_incident_field_updates as _apply_incident_field_updates` from the helpers import block (it was both imported and locally defined). Correct — the local definition in `regional.py` was the authoritative one.
- **Conflict resolution** (`74017ce`): Correct choices made in all 4 conflicted files:
  - `regional.py`: Kept HEAD's SecurityProviderError handling + PII decryption + the locally-defined `_apply_incident_field_updates` (correct — master's version wasn't needed)
  - `main.py`: Combined router registrations from both branches (map, events, geocode) — correct union
  - `validator/page.tsx`: Kept HEAD's richer wrapper — correct
  - `system-wiki/`: Merged entries — correct
- **Redis backoff design**: The global sentinel pattern avoids per-request pool creation, the 30-second cooldown prevents storm behavior, and `socket_connect_timeout=2` + `socket_timeout=2` prevent hanging on network blips.

### Remaining (non-blocking)
- **S2** — double-xlsx filename is a minor UX wart. Fix: `fmtName` should be the user-facing format label (`'excel'`), `ext` should stay `'xlsx'`.
- **S3** — `EventBus.publish_sync()` is unused and can be removed. 0 call sites.
- **S5** — `_resolve_role_from_token` alias in `events.py:37` is unnecessary indirection. Import `resolve_wims_role_from_token` and use it directly.

---

## Cruft Scan

| Check | Result |
|---|---|
| Certs/keys committed | ✅ None |
| Temp/scratch files | ✅ None |
| Root package.json added | ✅ None |
| PR body/metadata committed | ✅ None |
| Hardcoded paths/passwords | ✅ None |

---

## Pre-Merge CI Checks

Before merging, verify:

```bash
cd src/backend && ruff check . && ruff format --check .
cd src/frontend && npm run lint && npm run build
```

And deploy to VPS for live testing (SSE requires Redis and live browser).

---

## AGGREGATE SUMMARY

| Axis | Blocking | Suggestion | Praise |
|------|----------|------------|--------|
| Standards | 0 | 0 | 2 |
| Spec | 0 | 0 | 3 |
| Quality | 0 | 0 (S2, S3, S5 — all fixed @ 3da9744) | 4 |

## VERDICT

**APPROVE** — All 4 prior blocking items are verified resolved. The conflict resolution is correct. Suggestions S2, S3, S5 addressed in follow-up commit `3da9744`. No remaining blockers.
