# Civilian Contributor Phase 5 — Slice I Handoff & Sprint Continuation

Parent session: 2026-07-12. Slices A–H completed earlier (see
`2026-07-12-civilian-contributor-phase-5-slice-a-handoff.md` and
`2026-07-12-civilian-contributor-phase-5-slices-c-e-handoff.md` — the latter
appended Slice G and H narrative).

This doc records Slice I completion, the three security-warning fixes found and
resolved during the quality gate, and a clear sprint continuation contract for
the remaining Phase 4/5 work (Slices J–N).

---

## Slice I — Admin CMS UI + backend list extension ✅

**Goal:** Provide SYSTEM_ADMINs a backend list endpoint returning all lifecycle
states with latest version fields, and a frontend admin CMS page to consume it.

### Backend extension (Slices F/I boundary)

- **New:** `GET /api/admin/community` in `src/backend/api/routes/community_content.py`
  (lines 89–96), backed by `get_system_admin` + `get_db_with_rls`.
- **New service method:** `community_service.list_admin_content(db)` in
  `src/backend/services/community_content.py` (lines 244–275) — returns all lifecycle
  states, joins latest version fields, no public-only filter.
- **Nullable PATCH semantics** (found + fixed during security gate):
  - Route passes `body.model_fields_set` to `update_draft()`.
  - Service uses `UNSET` sentinel to distinguish omitted from explicit null.
  - Explicit `null` clears nullable pointer fields (`expires_at`, `last_reviewed_at`)
    and inserts NULL in the new immutable version for version fields (`metadata_json`,
    `title_uk`, `body_uk`).
  - Omitted fields preserve existing values.
  - `title_en: null`/`body_en: null` returns `422` (DB NOT NULL).
  - DRAFT-only guard, `row_version` bump, audit `updated_fields` completeness, and
    immutable version insertion preserved.

### Security-warning fixes (found during quality gate, resolved)

1. **Missing no-store boundaries on admin routes**
   - **Problem:** `GET /api/admin/community`, POST/PATCH/PUBLISH/ARCHIVE all lacked
     `Cache-Control: no-store`, risking browser/proxy caching of unpublished content.
   - **Fix:** Added `_PRIVATE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, private"`
     and a `_set_private_cache(response)` helper called at the start of every admin
     route handler in `src/backend/api/routes/community_content.py`.

2. **Public projections exposed full `metadata_json`**
   - **Problem:** The public hub/detail service projection returned `row.metadata_json`
     without restriction. Admin metadata may contain operational details unsuitable for
     public exposure.
   - **Fix:** Replaced with `"metadata_json": None` in the public `_row_to_item()` dict
     builder in `src/backend/services/community_content.py` (line 116). The admin list
     endpoint still returns the full value.
   - **Residual:** No backend-enforced PII allowlist for metadata JSON; admin trust is
     the sole boundary. Consider adding a structured schema enforcement if the product
     requirement evolves.

3. **Blank optional localized strings sent as `""` → backend `422`**
   - **Problem:** The admin UI `emptyForm` initialized `title_uk`/`body_uk` as `""`. The
     backend `min_length=1` on these fields rejected empty strings.
   - **Fix:** Frontend `normalizedPayload()` now maps blank optional strings to `null`
     before POST/PATCH, preserving explicit-null clearing semantics while passing
     backend validation.

### SYSTEM_ADMIN version SELECT RLS policy (another quality-gate find)

- **Problem:** `community_content_version` had no SYSTEM_ADMIN SELECT policy, only
  public published/non-expired SELECT and admin INSERT. The admin list join would
  silently lose DRAFT/ARCHIVED versions.
- **Fix:** Added `community_content_version_admin_select` FOR SELECT in both
  `src/backend/alembic/versions/0012_community_content_schema.py` and
  `src/postgres-init/91_community_content_schema.sql`.

### Frontend

- **Files:** `src/frontend/src/lib/api/adminCommunity.ts`, `src/frontend/src/app/admin/community/page.tsx`.
- **Behavior:** Authenticated `SYSTEM_ADMIN` only; loads all lifecycle states via
  `fetchAdminCommunityContent()`; preserves loading/error/auth-gating; supports
  draft creation/selection/editing, bilingual fields, metadata JSON validation,
  publish/archive actions, 409 conflict messaging, and plain-text preview.
- **No localStorage, no offline PII, no offline caching.**

### Validation

| Suite | Result |
|---|---|
| Backend Ruff/format | Pass (306 files formatted) |
| Backend community service tests | 25 passed |
| Backend community route tests | 12 passed |
| Backend contributor tests | 21 passed |
| Backend civilian API tests | 9 passed |
| Backend migration schema tests (0012) | 12 passed |
| **Backend total targeted** | **77 passed, 0 failed** |
| Frontend community API tests | 9 passed |
| Frontend community Hub tests | 6 passed |
| Frontend community detail tests | 3 passed |
| Frontend contributor dashboard tests | 12 passed |
| Frontend admin API tests | 2 passed |
| Frontend admin page tests | 2 passed |
| **Frontend total targeted** | **28 passed, 0 failed** |
| Frontend focused ESLint | Pass (only pre-existing warnings) |
| `git diff --check` | No whitespace errors |
| No staged files | Yes |

### Residual risks (Slice I)

- Live non-superuser RLS execution deferred (requires `wims_app_user` +
  `RUN_COMMUNITY_RLS_TESTS=1` + admin DB URL).
- Frontend tests don't directly assert loading/error/409 UI interaction states
  (loading state is text-asserted, but no mock-rejection coverage).
- Full production `npm run build` fails during existing `/_not-found` prerender
  (OIDC Authority URL undefined — pre-existing, unrelated to Slice I).
- Admin `metadata_json` has no backend-enforced PII allowlist; relies on admin trust.

---

## Sprint Continuation Contract

The implementation plan defines 10 tasks. Slices A–I correspond to these completed
plan units:

| Plan Task | Slices | Status |
|---|---|---|
| Task 1 — Lock Phase 4 compatibility (leaderboard, optional_auth, score breakdown) | — | **Not started** |
| Task 2 — Migration/bootstrap for Phase 4/5 contracts | Part of A–E | **Partial** (photo + CMS schema done; leaderboard/trust-formula migration pending) |
| Task 3 — Replace legacy trust score with normalized reliability model | — | **Not started** |
| Task 4 — Harden tracking around capability tokens | — | **Not started** |
| Task 5 — Pre-upload → atomic photo-attach flow | A–D | **Partial** (anonymous pre-upload wired; registered pre-upload wiring; atomic attach not fully implemented) |
| Task 6 — Community content service, routes, expiry | E–F | **Done** |
| Task 7 — Community/contributor/admin frontend | G–H–I | **Done** |
| Task 8 — Station directory list-first UX | J | **Not started** |
| Task 9 — Documentation reconciliation | L | **Partial** (wiki updated per-slice; final reconciliation outstanding) |
| Task 10 — Full CI/migration/RLS gate | M–N | **Not started** |

### Remaining slices (proposed order)

#### Slice J — Station directory: list-first + map toggle
**Plan ref:** Task 8
**Files:** `src/frontend/src/app/fire-stations/page.tsx`, `FireStationsMapInner.tsx`,
`src/frontend/src/components/community/StationDirectory.tsx` (new),
`src/frontend/src/lib/api/reference.ts`.

**Contract:**
- Reuse the existing public station reference endpoint as the source of truth.
- Make the searchable list the primary interaction; keep the map collapsed behind an
  accessible toggle.
- Selecting a station centers/highlights that pin while retaining all other pins.
- Synchronize list and map selection/filters.
- Do not require geolocation permission; handle map tile/geolocation failure with a
  complete searchable list and degraded-state explanation.
- No offline/PWA store for station data; no report-specific station binding.
- Tests cover: all pins retained on selection, selected station centering/highlighting,
  keyboard selection, search-empty state, map failure, mobile layout.

#### Slice K — Task 1: Lock Phase 4 compatibility (leaderboard removal, `optional_auth` hardening, score breakdown)
**Plan ref:** Task 1
**Files:** `src/backend/services/contributor.py`, `src/backend/api/routes/civilian.py`,
`src/backend/schemas/civilian.py`, `src/backend/auth.py`,
`src/backend/tests/test_contributor.py`, `src/backend/tests/test_auth_optional.py`,
`src/backend/tests/integration/test_contributor_endpoints.py`.

**Contract:**
- Define `TRUST_SCORE_FORMULA_VERSION` constant and shared terminal/decided status
  mapping based on the live `citizen_reports.status` constraint.
- Change `optional_auth`: no cookie → `None`; present but invalid cookie → `401`/`403`.
  Add tests for all six paths: missing, valid reporter, valid non-reporter, expired,
  malformed, invalid audience.
- Remove `LeaderboardEntry`, `get_leaderboard`, leaderboard route, and leaderboard
  opt-in column/migration. No remaining leaderboard references in code or docs.
- Extend private contributor response contracts with normalized breakdown fields
  (`volume_progress`, `outcome_accuracy`, `evidence_quality`, `consistency`, `decay`,
  `formula_version`, decided/active-month counts).

#### Slice L — Normalized trust-score engine + legacy score removal
**Plan ref:** Task 3
**Files:** `src/backend/services/contributor.py`, `src/backend/schemas/civilian.py`,
`src/backend/api/routes/civilian.py`, `src/backend/tests/test_contributor.py`,
`src/backend/tests/integration/test_contributor_endpoints.py`.

**Contract:**
- Compute only root reports (`linked_to_report_id IS NULL`) for volume and consistency.
- `volume_progress = min(1, log(1 + root_reports) / log(21))`.
- Outcome accuracy: `actioned / decided * min(1, decided / 10)`. Add zero-decided and
  one-decided confidence coverage.
- Evidence quality: bounded per-root-report score (photo, GPS, distance, timestamp);
  aggregate without unbounded photo credit.
- Consistency: distinct months in rolling six-calendar-month window / 6.
- Inactivity decay: `min(20, inactive_months * 2)`; final score clamped to [0, 100].
- Remove legacy `photo_bonus_for_report()` SECURITY DEFINER after all call sites
  and tests are migrated.
- Return private breakdown and formula version in `/me`, reports/stats.
- No leaderboard, no public ranking, no other contributor's data.

#### Slice M — Capability-only tracking + sunset device-ID lookups
**Plan ref:** Task 4
**Files:** `src/backend/api/routes/civilian.py`, `src/backend/auth.py`,
`src/backend/schemas/civilian.py`, `src/backend/tests/test_tracking_capabilities.py`,
`src/frontend/src/lib/api/legacy.ts`, `src/frontend/src/lib/api/civilian.ts`,
`src/frontend/src/app/tracking/page.tsx`,
`src/frontend/src/app/tracking/v2/[report_id]/[tracking_token]/page.tsx`.

**Contract:**
- Make the opaque high-entropy tracking capability the sole public lookup authority.
- SHA-256 token hashes stored; validation bound to report ID; one active token per
  report; expiry/revocation honoured.
- Neutral `404` for missing/expired/revoked/mismatched/unauthenticated lookups.
- Throttling; logs/audits contain only token-safe identifiers.
- Remove or deprecate `GET /api/civilian/reports?device_id=`,
  `GET /api/civilian/reports/{report_id}?device_id=`, device-ID-only legacy frontend paths.
- Reduce tracking response to safe projection (status, station name/phone, coarse
  distance, ETA, photo count, safety guidance). No lat/lng, PII, chain IDs, internal notes.

#### Slice N — Full CI gate + migration/RLS live tests + PR rebase
**Plan ref:** Tasks 9, 10
**Files:** `system-wiki/backend/api-route-map.md`, `system-wiki/frontend/route-map.md`,
`system-wiki/database/schema-overview.md`, `system-wiki/security/security-baseline.md`,
`system-wiki/index.md`, `system-wiki/log.md`, gap register.

**Contract:**
- Final documentation reconciliation: route maps, schema overview, security baseline,
  index, log. All statements match live code. No stale leaderboard/public-coordinate
  claims. Links resolve.
- Run live RLS integration tests in disposable Postgres with non-superuser
  `wims_app_user` + `RUN_CIVILIAN_PHOTO_RLS_TESTS=1` + `RUN_COMMUNITY_RLS_TESTS=1`.
  Verify cross-session denial, helper grants, audit immutability.
- Run Alembic upgrade/downgrade parity against disposable Postgres.
- Run `make ci-local` and compare with `.github/workflows/ci.yml` per
  `docs/agents/ci-preflight.md`.
- Rebase `feat/civilian-contributor-phase-5` against `origin/master`, resolve conflicts,
  verify no regressions.
- Append `system-wiki/log.md` entry; update gap register if FRS/code alignment changed.

---

## Current PR Status

| Property | Value |
|---|---|
| PR #553 | `feat/civilian-contributor-phase-5` |
| Base | `master` (`a6aa8793`) — **stale, needs rebase** |
| Head | `c38d2836` (5 commits from `x1n4te`) |
| Mergeable | `CONFLICTING` |
| Reviews | None |
| Owner comment | 10 remaining slices listed |
| Local | `feat/civilian-contributor-phase-5` checked out, ~60 modified/untracked files |
| Staged | Nothing staged |

## Non-negotiable pre-merge gates

1. **Live RLS integration tests** — run disposable Postgres with `wims_app_user` +
   env flags for all photo/community/contributor RLS suites.
2. **Rebase/resolve** against `origin/master` — the PR is `CONFLICTING`, base is stale.
3. **Final CI gate** per `docs/agents/ci-preflight.md` — compare with
   `.github/workflows/ci.yml`.
4. **Full frontend build** — requires OIDC env vars; currently blocked on pre-existing
   `/_not-found` prerender failure. This is an environment/infra issue, not a code
   regression from Phase 5.

## Cross-slice residual risks (all slices A–I)

- Live RLS/helper execution gate unrun for all photo/community SLICES: requires
  disposable Postgres with non-superuser `wims_app_user` + env flags. Must run before
  merge (Slice N).
- PR #553 is `CONFLICTING`/`DIRTY` against `origin/master`; rebase/resolve before merge.
- Production `npm run build` fails during existing `/_not-found` prerender because
  `OIDC Authority URL is undefined` — environment/config prerequisite, unrelated to
  Phase 5 code.
- Known QA blockers from the plan still unresolved (outside completed slices):
  - Plaintext EXIF columns in `report_photos.py` (Task 5).
  - Contributor snapshot RLS not owner-scoped (Task 3 cleanup).
  - Trust-score formula missing timestamp term (Task 3).
  - Audit immutability gap (known, documented, needs separate repair).
- Routing production dependency blocked on issue #552.

## Handoff files index

| File | Content |
|---|---|
| `docs/superpowers/plans/2026-07-11-civilian-contributor-phase-5-implementation-plan.md` | Full plan (10 tasks, 8 revision blockers) |
| `docs/superpowers/handoffs/2026-07-11-civilian-contributor-phase-5-session-handoff.md` | Original session start |
| `docs/superpowers/handoffs/2026-07-12-civilian-contributor-phase-5-slice-a-handoff.md` | Slice A + B appendix |
| `docs/superpowers/handoffs/2026-07-12-civilian-contributor-phase-5-slices-c-e-handoff.md` | Slices C, D, E, F, G, H |
| **This file** | Slice I, security fixes, sprint continuation for J–N |

## Key files changed in this session (Slice I fixes)

- `.pi/AGENTS.md` — outcome-quality policy added
- `.pi/settings.json` — model overrides removed, thinking medium retained
- `src/backend/alembic/versions/0012_community_content_schema.py` — added
  `community_content_version_admin_select` FOR SELECT policy
- `src/postgres-init/91_community_content_schema.sql` — same policy addition
- `src/backend/api/routes/community_content.py` — `_PRIVATE_CACHE_CONTROL` + response
  headers on all admin routes; `model_fields_set` propagation for nullable PATCH
- `src/backend/services/community_content.py` — `UNSET` sentinel/sentinel dict for
  omitted-vs-null fields; public projections return `metadata_json: None`
- `src/backend/tests/test_0012_community_content_schema.py` — assertion covers new
  admin SELECT policy
- `src/backend/tests/test_community_content_routes.py` — nullable PATCH clearing tests
- `src/backend/tests/test_community_content_service.py` — nullable PATCH clearing tests
- `src/frontend/src/app/admin/community/page.tsx` — blank optional string normalization
- `system-wiki/backend/api-route-map.md`, `system-wiki/frontend/route-map.md`,
  `system-wiki/database/schema-overview.md`, `system-wiki/security/security-baseline.md`,
  `system-wiki/index.md`, `system-wiki/log.md` — per-slice wiki updates

## Final test counts (end of Slice I, all fixes applied)

| Area | Tests | Result |
|---|---|---|
| Backend community routes | 12 | ✅ |
| Backend community service | 25 | ✅ |
| Backend community schema (0012) | 12 | ✅ |
| Backend contributor | 21 | ✅ |
| Backend civilian API | 9 | ✅ |
| **Backend total** | **77** | **✅** |
| Frontend community API | 9 | ✅ |
| Frontend community Hub | 6 | ✅ |
| Frontend community detail | 3 | ✅ |
| Frontend contributor dashboard | 12 | ✅ |
| Frontend admin API | 2 | ✅ |
| Frontend admin page | 2 | ✅ |
| **Frontend total** | **28** | **✅** |
