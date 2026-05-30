# Re-Review: PR #179 — feat/kanban-batch-1

**Re-reviewed:** `feat/kanban-batch-1` @ `079413f`
**Prior review:** @ `2313a5e` (7 blockers, 11 suggestions in `docs/reviews/kanban-batch-1-review.md`)
**Fix commits:** `62bffc5` → `079413f` (5 commits claiming to address review findings)
**Base:** `f221bfb` (merge-base with `origin/master`)
**Size:** 40 files, +2804 / −115 lines (+271 lines since prior review)
**Date:** 2026-05-30

---

## Review History

| Review | SHA | Verdict | Blockers |
|--------|-----|---------|----------|
| 1st (2026-05-30) | `2313a5e` | REQUEST CHANGES | 7 blocking |
| **2nd (this)** | `079413f` | **REQUEST CHANGES** | 1 new blocking + Copilot items |

---

## BLOCKING — Resolved ✓ (from prior review)

| # | Prior Blocker | Resolution |
|---|---------------|------------|
| 1 | Public map queries `fire_incidents`, not `citizen_reports` | ✅ FIXED — `map.py:159` now queries `FROM wims.citizen_reports` |
| 5 | Missing backlog migration for AES-256-GCM | ✅ FIXED — `scripts/encrypt_backlog.py` created (218 lines) |
| 6 | Duplicated role resolution in `events.py` | ✅ FIXED — extracted to `auth.py:resolve_wims_role_from_token` |
| 7 | Missing `system-wiki/log.md` entry | ✅ FIXED — entry at line 1027 |

Prior suggestions S1 (60s polling + tab-visibility), S2 (backdrop-click close modal) also fixed. ✅

## BLOCKING — Deferred (from prior review, acknowledged in PR body)

| # | Blocker | Status |
|---|---------|--------|
| 2 | Cluster algorithm ignores spec params (500m bucket, 10km, 1hr, min-3, cap-50) | ⏸️ DEFERRED — PR body: "Deferred to follow-up" |
| 3 | No stale-if-error cache (serve-stale, 503 degraded, fresh TTL 60s) | ⏸️ DEFERRED — PR body: "Deferred to follow-up" |
| 4 | Shared `fireLocation` state not implemented | ⏸️ DEFERRED — PR body: "Deferred to follow-up" |

These are acknowledged gaps. Merge decision on these is the author's call — Karpathy G7 says I should flag them as incomplete but not re-block if the author explicitly deferred.

---

## BLOCKING — New Findings (Karpathy Guidelines)

### 🔴 B1: Karpathy G4/G10 — SSE publishing dead from 5 sync endpoints

**severity: FUNCTIONAL-BUG** | `regional.py:1770-1783,2175-2189`, `admin.py:706-717`, `workflow.py:139-148,475-492`

The fire-and-forget pattern `asyncio.get_running_loop().create_task(...)` with `except RuntimeError: pass` silently fails in all 5 sync endpoint call sites. FastAPI runs sync `def` functions in an `anyio` threadpool worker — those threads have NO asyncio event loop. `asyncio.get_running_loop()` always raises `RuntimeError`, which is silently swallowed.

> **quote(standard):** Karpathy G4 (Goal-driven): "Define success criteria. Loop until verified." — SSE publishing was claimed to work but was never tested from actual sync endpoints. G10 (Production-grade): code that silently discards events is not production-ready.

> **quote(code):**
> ```python
> # regional.py:1770-1783 — update_incident (def, sync!)
> try:
>     loop = asyncio.get_running_loop()   # RuntimeError in threadpool
>     loop.create_task(publish_incident_event(...))
> except RuntimeError:
>     pass                                 # silently dead
> ```

**Dead call sites:** `update_incident` (regional.py:1710, `def`), `verify_incident` (regional.py:2128, `def`), `update_security_log` (admin.py:653, `def`), `claim_cluster_command` (workflow.py:44, `def`), `apply_terminal_action_command` (workflow.py:372, `def`).

**Working call sites (3 of 8):** `correct_verified_incident` (regional.py:2403, `async def`), `analyze_threat_log` (ai_service.py, `async def`), `ingest_eve_file` (suricata_ingestion.py, uses standalone `publish_security_event_sync`).

**Fix:** Either convert affected endpoints to `async def`, or use `publish_*_sync()` standalone functions (matching the Suricata pattern that works).

---

### 🔴 B2: Karpathy G2 — Dead code: EmergencyPanel + unused state in PublicFireMapInner.tsx

**severity: DEAD-CODE** | `PublicFireMapInner.tsx:151-205,218-220,322-332`

`EmergencyPanel` component (54 lines) is defined but never rendered in the JSX. The `emergencyContacts` and `nearbyStations` state variables are set in a `useEffect` that makes a real network call — but the data is never consumed anywhere in the rendered output.

> **quote(standard):** Karpathy G2 (Simplicity first): "No code beyond what was asked. Dead code is complexity debt." G5 (No placeholders): this is effectively placeholder code that ships without its rendering target.

> **quote(code):** `EmergencyPanel` defined at lines 151-205, `fetchEmergencyServices` called at lines 322-332 populating state that's never read in JSX (lines 354-440).

**Fix:** Either render `<EmergencyPanel>` in the JSX return tree, or remove the component, the fetch, the state variables, and the `EmergencyContact`/`NearbyStation` types if unused elsewhere.

---

### 🔴 B3: Karpathy G2 — Dead no-op assignment in regional.py:1423-1424

**severity: DEAD-CODE** | `regional.py:1423-1424`

```python
pii_dict: dict[str, Any] = {}
for f in pii_fields:
    val = getattr(body, f, None)
    if val is not None and val != "" and val != {} and val != []:
        pii_dict[f] = val
if not pii_dict:
    pii_dict = {}       # ← no-op: pii_dict is already {}
```

> **quote(standard):** Karpathy G2 (Simplicity first) / G5 (No placeholders): dead branch that reassigns `{}` to `{}`.

**Fix:** Delete lines 1423-1424. The `pii_dict` is already empty if the loop produced no entries.

---

### 🔴 B4: Karpathy G2 — Dead Redis pool constants in map.py:37-38

**severity: DEAD-CODE** | `map.py:37-38`

```python
_REDIS_POOL_SIZE = 5
_REDIS_POOL_MAX_CONNECTIONS = 10
```

Declared but never passed to `aioredis.from_url()` at line 46. These look like intended configuration that was never wired in.

> **quote(standard):** Karpathy G2: dead constants mislead readers into thinking pool sizing is configured.

**Fix:** Either pass to `from_url(max_connections=_REDIS_POOL_MAX_CONNECTIONS)` or delete both lines.

---

## SUGGESTIONS — Non-Blocking

### S1: Karpathy G2 — status_filter bind param always included + empty-string gap

`map.py:398-405` — The `status_filter` param is always added to the params dict, even when the SQL clause has no `:status_filter` placeholder. Additionally, when `status_filter == ""` (falsy but not None), neither branch fires → `status_clause = ""` → no filter at all, not even the default DRAFT exclusion.

> **quote(standard):** Karpathy G10: silent parameter mismatch can mask bugs.

**Fix:** Only add `status_filter` to params when truthy. Drop the `elif status_filter is None` branch — any falsy value (None, "") gets the default `!= 'DRAFT'` filter.

### S2: Karpathy G2 — Duplicate xlsx in export filename

`ExportPreviewModal.tsx:150-156` — `ext` and `fmtName` are identical (`format === 'excel' ? 'xlsx' : format`), producing `wims-bfp-xlsx-20260101.xlsx` instead of `wims-bfp-excel-20260101.xlsx`.

**Fix:** `fmtName` should be `format` (the user-facing label), `ext` should remain `xlsx` for Excel.

### S3: Karpathy G2 — Dead `EventBus.publish_sync()` in event_bus.py:83-108

Never called anywhere. The standalone `publish_security_event_sync()` handles sync publishing. Remove or use it.

### S4: Karpathy G2 — Dead import `useMap` in PublicFireMapInner.tsx:9

Only `useMapEvents` is used. `useMap` is imported but never called.

### S5: Karpathy G2 — No-op alias `_resolve_role_from_token` in events.py:37

Direct one-line alias with no transformation. Just use the imported function directly.

### S6: Karpathy G2 — Duplicate `displayValue` formatting across analyst pages

Identical 7-line formatting block (PHP currency / response_time / locale) duplicated in `analyst/page.tsx:1069-1078` and `analyst/[workflow]/page.tsx:195-203`. Extract to `@/lib/formatters.ts`.

### S7: Karpathy G2 — Duplicate `severityColor`/`markerRadius` across map components

`PublicFireMapInner.tsx:53-71` and `ValidatorMapInner.tsx:10-27` — identical color/opacity logic. Extract to `@/lib/map-helpers.ts`.

### S8: Karpathy G3/G9 — `regional.py` at 2891 lines; PR added ~76 more

This file handles: AFOR import, incident CRUD, PII encryption, verification workflow, corrections, and now SSE publishing. Any PR that touches this file should consider extraction, not addition.

### S9: Host CPU/RAM health check regression on 32-core machines

`admin.py:72-76` uses `psutil.cpu_percent(interval=0.5)` which blocks the sync `def system_health()` endpoint for 500ms. For the admin health dashboard this is acceptable; flagging for awareness per Karpathy G9 (macro-architecture: health checks should not block).

---

## PRAISE

- ✅ Prior blocker #1 (fire_incidents→citizen_reports) fixed — privacy contract restored
- ✅ Prior blocker #6 (role resolution dedup) fixed — extracted to `auth.py`
- ✅ Prior blocker #7 (log.md) fixed — entry at system-wiki/log.md:1027
- ✅ Prior S1/S2 (60s polling, tab-visibility, backdrop-click close) all fixed
- ✅ Nginx SSE location block correctly configured (`proxy_buffering off`, extended timeouts)
- ✅ TLS 1.3-only + ChaCha20 cipher suite hardened correctly
- ✅ No TODOs, no stubs, no commented-out code in new files
- ✅ All commits use Conventional Commit format with issue references
- ✅ No secrets committed

---

## COPILOT REVIEW VERIFICATION

GitHub Copilot filed 5 inline comments. All 5 are **correct and verified**:

| # | File:Line | Copilot Claim | Verdict |
|---|-----------|---------------|---------|
| C1 | PublicFireMapInner.tsx:332 | EmergencyPanel never rendered; emergencyContacts/nearbyStations dead code | ✅ VALID → Blocking B2 |
| C2 | ExportPreviewModal.tsx:156 | Duplicate xlsx in filename | ✅ VALID → Suggestion S2 |
| C3 | map.py:37-38 | Dead Redis pool constants | ✅ VALID → Blocking B4 |
| C4 | map.py:405 | status_filter bind param mismatch | ✅ VALID → Suggestion S1 |
| C5 | regional.py:1424 | `if not pii_dict: pii_dict = {}` is no-op | ✅ VALID → Blocking B3 |

---

## SPEC VERIFICATION TABLE (Updated from prior review)

| # | Title | Prior | Current | Notes |
|---|-------|-------|---------|-------|
| #113 | Curated default export columns | PARTIAL | PARTIAL | 9 columns vs spec's 7; minor |
| #115 | Copy incident ID controls | ✅ | ✅ | |
| #116 | Descriptive export filenames | ✅ | ✅ | Filename has double-xlsx bug (S2) |
| #117 | Action-oriented select-page labels | ✅ | ✅ | |
| #118 | damage_cost Top-N metric | ✅ | ✅ | |
| #119 | Export column parity | PARTIAL | ✅ | FIXED — backend ALLOWED_EXPORT_COLUMNS now matches |
| #120 | Rows-per-page selector | ✅ | ✅ | |
| #126 | Public map PRD | ❌ BROKEN | ✅ | FIXED — now queries citizen_reports |
| #127 | Report-area cluster API | ❌ | ⏸️ DEFERRED | Acknowledged gap |
| #128 | Stale-if-error cache | ❌ | ⏸️ DEFERRED | Acknowledged gap |
| #129 | Emergency services endpoint | ✅ | ✅ | |
| #130 | Root public map component | PARTIAL | PARTIAL | BFP stations still not on map itself |
| #131 | Shared fireLocation state | ❌ | ⏸️ DEFERRED | Acknowledged gap |
| #132 | Polling/degraded behavior | PARTIAL | ✅ | FIXED — 60s polling + tab-visibility |
| #133 | Tests and wiki updates | ✅ | ✅ | |
| #134 | Triage modal escape/close | PARTIAL | ✅ | FIXED — backdrop click + Escape |
| #135 | Validator operational map | ✅ | ✅ | |
| #147 | Map only on safety step | ✅ | ✅ | |
| #150 | Expand AES-256-GCM encryption | PARTIAL | ✅ | FIXED — backlog migration script added |
| #153 | Enforce TLS 1.3 only | ✅ | ✅ | |
| #154 | Cipher suite hardening | ✅ | ✅ | |
| #175 | SSE notification infrastructure | PARTIAL | **🔴 BROKEN** | SSE endpoint + event_bus exist, but 5 of 8 publishers are DEAD CODE (B1). Also: no react-hot-toast, no notification history panel (deferred). |

---

## AGGREGATE SUMMARY

| Axis | Blocking (new) | Suggestion | Praise |
|------|---------------|------------|--------|
| Standards | 0 | S2, S5, S6, S7, S8 | 5 |
| Spec | B1 (SSE not functional from 5 endpoints) | S1 (status_filter) | 3 |
| Quality | B2 (EmergencyPanel dead), B3 (no-op), B4 (dead constants) | S3 (dead publish_sync), S4 (dead import) | 2 |
| **Karpathy G-Violations** | G2 x3, G4 x1, G5 x1, G10 x2 | G2 x5, G9 x1, G10 x1 | — |

---

## VERDICT

**REQUEST CHANGES.** 4 new blocking items (B1-B4) must be resolved:

1. **B1 — CRITICAL:** SSE events silently dropped from 5 of 8 publishing points. The `asyncio.get_running_loop()` + `except RuntimeError: pass` pattern cannot work from sync FastAPI endpoints running in threadpool workers. This means incident updates, verification actions, and admin HITL confirmations never publish SSE events.

2. **B2-B4:** Dead code removal (EmergencyPanel component + unused state + network call, no-op assignment, dead pool constants) — 3 trivial fixes.

The 3 deferred items (#127 cluster algorithm, #128 stale-if-error, #131 shared fireLocation) are acknowledged gaps — the author can decide whether they block merge.

All 5 GitHub Copilot comments are accurate and actionable.

---

*Re-reviewed by Hermes Agent (coding profile) with Karpathy Guidelines emphasis*
