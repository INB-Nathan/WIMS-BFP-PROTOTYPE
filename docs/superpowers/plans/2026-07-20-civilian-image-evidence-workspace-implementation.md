# Civilian Image Evidence Workspace — Implementation Plan

**Date:** 2026-07-20
**Plan for:** approved civilian image-evidence overhaul
**Branch:** `feat/triage-evidence-workspace` (starts at HEAD `89bf2aa2`)
**Canonical contract:** `docs/superpowers/specs/2026-07-20-civilian-image-evidence-workspace-design.md`
**Execution specs:**
- `docs/superpowers/specs/2026-07-20-civilian-image-evidence-backend-security.md`
- `docs/superpowers/specs/2026-07-20-civilian-image-evidence-frontend-workspace.md`
- `docs/superpowers/specs/2026-07-20-civilian-image-evidence-operations-validation.md`

This is an implementation plan, not implementation. It defines an ordered, single-writer task ledger. Each milestone is self-contained; dependencies are stated so the next writer starts only after the prior milestone's acceptance evidence exists.

## 0. Starting boundary & non-negotiables

- **Starting commit:** `89bf2aa2`. The branch already has pre-existing work: a modified `.pi/settings.json` and untracked manual/sensitive files (`WIMS-BFP-Deployment-Credentials.pdf`, `WIMS-BFP-VPS-Overview.pdf`, `wims-contabo-admin`, `wims-contabo-admin.pub`, `docs/database/`, `docs/deployment-inventory.md`, `docs/handoffs/`, `docs/WIMS-BFP-Full-System-User-Manual.*`, `docs/public-surface-reviewer-brief.md`, `.pi/skills/compact-handoff/`). **None of these may be staged, committed, edited, deleted, or read as part of this work.** The plan preserves them untouched; command output references them only via `git status --short --branch`.
- **No production/VPS operations, no destructive commands.** No `docker compose down -v`, no database reset/restore, no `git reset/clean/stash/checkout`, no branch switching, no push. This plan only edits the single plan file plus (during implementation, by the assigned writer) the source/test/wiki files enumerated per milestone.
- **No speculative abstractions or new dependencies.** `geoip2>=4.8.0` is already in `src/backend/requirements.txt`; reuse the `_load_geoip_reader()` adapter pattern in `src/backend/tasks/anomaly_detection.py:519` for the GeoIP service. Offline encryption reuses the existing non-extractable per-user AES-GCM key + `encryptPayload`/`decryptPayload` in `src/frontend/src/lib/offlineStore.ts:368` (key is `generateKey({name:'AES-GCM',length:256}, false, ['encrypt','decrypt'])` — non-extractable, confirmed).
- **Behavioral invariants preserved (verified in code, not assumed):**
  - `src/backend/services/report_photos.py` already writes three independent encrypted artifacts (original/sanitized/metadata) with distinct AADs `civilian-photo:{photo_id}:original:v1`, `:sanitized:v1`, `:metadata:v1`.
  - `src/docker-compose.yml` mounts `incident_attachments_data:/app/storage` into backend + worker; `CIVILIAN_PHOTO_STORAGE_DIR=/app/storage/civilian-photos`. Named volume survives rebuild/restart; not a fresh-volume reset. The acceptance test must not hard-code the volume name/host path.
  - `src/postgres-init/82_civilian_report_photos.sql` `report_photos_select` RLS already grants `NATIONAL_VALIDATOR`/`NATIONAL_ANALYST`/`SYSTEM_ADMIN`. No broader SELECT policy is needed for the validator read route.
  - `queue_projection.py` stays privacy-minimized (no raw device IDs/IP/PII/photo bytes).
  - Anonymous Turnstile (`check_device_abuse`) + lower cap (`CIVILIAN_REPORT_HOURLY_CAP`); registered `CIVILIAN_REPORTER` skips Turnstile, higher cap (`REGISTERED_REPORT_HOURLY_CAP`). Preserved.
  - `trusted_client_ip(request)` in `src/backend/utils/audit.py:20` is the only approved real-client-IP source (never `X-Forwarded-For`). GeoIP uses it.

## Milestone ledger

> Convention: every milestone lists **mode**, **behavior**, **non-goals**, **dependencies**, **exact files to inspect/modify**, **tests-first**, and **validation commands**. New backend test files are appended to the backend baseline; new frontend test files to the frontend baseline (see §"Validation commands" at bottom).

---

### M1 — Schema: nullable coarse GeoIP + encrypted reporter-identity envelope
**Mode:** standard (TDD for the SQL contracts)
**Behavior:**
1. Add nullable coarse IP-geolocation columns to `wims.citizen_reports`: `ip_geo_city TEXT`, `ip_geo_province TEXT`, `ip_geo_centroid geography(Point,4326)`, `ip_geo_accuracy_m INTEGER`, `ip_geo_provider TEXT`, `ip_geo_lookup_at TIMESTAMPTZ`.
2. Add an encrypted reporter-identity envelope on `wims.citizen_reports` (follows the existing encrypted-PII naming pattern while adding explicit KMS key metadata): `reporter_pii_blob_enc TEXT`, `reporter_encryption_iv TEXT`, `reporter_crypto_provider TEXT`, `reporter_key_version INTEGER`, `reporter_kms_key_name TEXT`. **No plaintext `reporter_name`/`reporter_phone` columns.** All columns nullable so existing rows stay valid.
3. Add column comments stating precision (city/municipality centroid) and privacy limits; add PostGIS index only if a query in M3/M4 justifies it (decide during M3 — do not pre-add speculative indexes).
4. Create Alembic revision `0029_*` (down_revision `0028`) performing the same additive nullable changes. Document downgrade as lossless for *nullable* additions but explicitly **blocked** once rows carry live encrypted reporter snapshots or GeoIP evidence (per ops spec §7.2) — downgrade must not silently drop live encrypted identity; if rows exist, require approved export/recovery.
5. Keep `src/postgres-init/82_*.sql` aligned by adding a new, clearly-ordered idempotent bootstrap file `99_citizen_report_geoip_reporter_envelope.sql` (do not mutate `82` semantics). Align grants/RLS: no new RLS policy required (the envelope is decrypted only by server-side service under existing staff RLS; anonymous/report-owner SELECT already covers `citizen_reports`).

**Non-goals:** no public table, no original-image column, no plaintext reporter PII, no RLS broadening, no migration of existing rows.
**Dependencies:** none (first writer).
**Inspect/modify:**
- Inspect: `src/postgres-init/05_citizen_reports.sql`, `src/postgres-init/82_civilian_report_photos.sql`, `src/backend/models/citizen_report.py`, `src/backend/alembic/versions/0028_capability_tracking_projection.py`.
- Modify: add `src/postgres-init/99_citizen_report_geoip_reporter_envelope.sql`; add `src/backend/alembic/versions/0029_*.py`; extend `src/backend/models/citizen_report.py` with the new mapped columns (nullable).
**Tests first (interface clear):** backend migration tests against a disposable DB.
- `src/backend/tests/test_0029_geoip_reporter_schema.py` — fresh `alembic upgrade head` applies; `99_*.sql` bootstrap applies on a clean volume; columns nullable; `reporter_pii_blob_enc`/`ip_geo_centroid` present; `wims.citizen_reports` RLS still enforces (existing rows unaffected, existing `citizen_reports_select` policy untouched).
**Validation commands (M1):**
```bash
cd src/backend
ruff check .
ruff format --check .
pytest -q tests/test_0029_geoip_reporter_schema.py
alembic heads   # must show 0029 as head
# disposable DB: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wims_test alembic upgrade head
```

---

### M2 — GeoIP evidence service + server-side lookup adapter
**Mode:** standard (TDD)
**Behavior:**
1. New service `src/backend/services/geoip_evidence.py`:
   - `resolve_coarse_ip_evidence(client_ip: str) -> CoarseIpEvidence | CoarseIpUnavailable`. Reuses `geoip2.database.Reader` via env `GEOIP_DB_PATH`, mirroring `src/backend/tasks/anomaly_detection.py:519 _load_geoip_reader()`.
   - Returns only approved coarse fields: city/municipality, province/region label, centroid `geography(Point,4326)`, accuracy radius meters, provider/source id, lookup timestamp. **Raw IP discarded immediately** after derivation; never returned, never logged, never written to audit/tables.
   - On missing `GEOIP_DB_PATH`, missing file, or lookup error → returns `CoarseIpUnavailable` (non-blocking). Integrates with submission (M4) so a failure does not block an emergency report.
2. PostGIS-ready centroid output; no raw-IP retention. Provider adapter invocation isolated in the service (no network/DB lookup embedded in any route body).

**Non-goals:** no exact IP location, no raw-IP storage, no client-supplied IP trust, no fallback to original image.
**Dependencies:** M1 (schema columns exist).
**Inspect/modify:**
- Inspect: `src/backend/tasks/anomaly_detection.py:519`, `src/backend/requirements.txt` (geoip2 already present), `src/backend/utils/audit.py:20 trusted_client_ip`.
- Modify: add `src/backend/services/geoip_evidence.py` + `src/backend/schemas/geoip.py` (Pydantic result types).
**Tests first:**
- `src/backend/tests/test_geoip_evidence.py` — success stores only approved coarse fields and derives centroid; failure (unset/missing DB) yields `CoarseIpUnavailable` and does not raise; raw IP absent from returned struct and from any log assertion; PostGIS centroid cast valid.
**Validation commands (M2):**
```bash
cd src/backend
ruff check . && ruff format --check .
pytest -q tests/test_geoip_evidence.py
```

---

### M3 — Photo read service (sanitized-only, fail-closed)
**Mode:** standard (TDD) — security-critical
**Behavior:** Add read-side functions in a focused service (extend `src/backend/services/report_photos.py` or an adjacent `services/report_photo_read.py`; do **not** duplicate upload validation/encryption constants) that return sanitized bytes + safe metadata:
1. Load photo through an RLS-scoped session (`get_db_with_rls`).
2. Validate report/photo association and caller authorization (validator workspace roles via existing server-side role + RLS).
3. Validate stored `sanitized_storage_path` resolves beneath the configured civilian photo root (`_get_storage_dir()`), reject symlinks, traversal, unrecognized artifact names (`_FINAL_ARTIFACT_RE`), non-regular files.
4. Enforce bounded stored size; read encrypted sanitized artifact; decrypt with `civilian-photo:{photo_id}:sanitized:v1`; verify stored `sanitized_sha256` against decrypted plaintext; verify expected MIME contract (image/jpeg|image/png).
5. Return only sanitized bytes + safe metadata (capture time, dimensions, EXIF availability, GPS consensus, evidence source, image-to-report distance). Never expose original path/filename, ciphertext, crypto metadata, unrestricted EXIF.
6. Any missing/quarantined/corrupt/hash-mismatched/out-of-root/undecryptable case → neutral unavailable result + safe operational log. **Never fall back to original artifact.** No application route serves originals.

**Non-goals:** no original route, no PII in responses, no audit side effects on read.
**Dependencies:** M1 (schema), existing `report_photos.py` AADs/helpers (verified present).
**Inspect/modify:**
- Inspect: `src/backend/services/report_photos.py` (`_get_storage_dir`, `_FINAL_ARTIFACT_RE`, `_cleanup_files`, `DEFAULT_STORAGE_DIR`, AAD constants, `get_crypto_provider`), `src/backend/services/kms/__init__.py:37 get_crypto_provider`, `src/backend/auth.py:get_db_with_rls`.
- Modify: add `src/backend/services/report_photo_read.py` (or extend `report_photos.py`) with `get_sanitized_photo_bytes(...)` and `get_safe_photo_metadata(...)`.
**Tests first:**
- `src/backend/tests/test_report_photo_read.py` — validator role retrieves sanitized bytes; unauthorized/cross-scope → neutral denial; report/photo mismatch denied; sanitized AAD + hash + size + MIME + path-containment + symlink-reject + missing-file + corrupt-file covered; proof no original route and no original fallback ever returns; responses would carry `no-store`/`nosniff` headers (asserted at route layer in M5).
**Validation commands (M3):**
```bash
cd src/backend
ruff check . && ruff format --check .
pytest -q tests/test_report_photo_read.py tests/test_report_photos.py
```

---

### M4 — Reporter identity service + anonymous validation + authenticated derivation + GeoIP persistence at submission
**Mode:** standard (TDD)
**Behavior:**
1. New `src/backend/services/reporter_identity.py`:
   - Anonymous validation: `reporter_name` required for every report; `reporter_phone` required for normal reports, optional for `I_NEED_HELP`/`SOMEONE_ELSE_NEEDS_HELP` life-safety fast submit.
   - Authenticated `CIVILIAN_REPORTER`: derive contributor id, display name, contact number **server-side** from the authenticated profile; **ignore caller-supplied reporter identity**; never overwrite `witness_name`/`witness_phone`.
   - Build canonical reporter snapshot; encrypt via `get_crypto_provider().encrypt_json(...)` with AAD `civilian-report:{report_id}:reporter-identity:v1`; store in `reporter_pii_blob_enc` + associated IV/provider/key-version/kms-key-name from M1.
   - Encryption failure → reject the identity-dependent write (fail-closed), **no plaintext fallback**. Snapshot immutable submission evidence (decrypt on demand only in M5 contact-reveal).
   - Incomplete authenticated profile: normal report → profile-completion response; life-safety with only phone missing → still submittable.
2. Wire into `src/backend/api/routes/civilian.py` `submit_civilian_report` (line 423): after report INSERT + witness PII encryption (M1's `_encrypt_witness_pii`), (a) persist coarse GeoIP via `geoip_evidence.resolve_coarse_ip_evidence(trusted_client_ip(request))` into M1 columns — non-blocking on failure; (b) persist the encrypted reporter snapshot. Keep anonymous Turnstile/lower cap and registered bypass/higher cap untouched (lines 432–450, 447).
3. Reporter vs eyewitness semantic separation enforced through the full round-trip; the wizard/UX (M6) labels them distinctly.

**Non-goals:** no plaintext reporter columns, no caller-supplied identity trust, no original-image involvement, no RLS change.
**Dependencies:** M1 (schema + envelope), M2 (GeoIP service).
**Inspect/modify:**
- Inspect: `src/backend/api/routes/civilian.py` (`submit_civilian_report` 423–713, `_encrypt_witness_pii` 117, `CivilianReportCreate`/`CivilianReportResponse` in `src/backend/schemas/civilian.py:18/75`), `src/backend/services/kms/__init__.py`, `src/backend/utils/audit.py:20,125 hash_client_ip`.
- Modify: add `src/backend/services/reporter_identity.py`; modify `civilian.py` submission route and `schemas/civilian.py` (add `reporter_name`/`reporter_phone` to `CivilianReportCreate` with validation; document they are reporter-only, distinct from `witness_name`/`witness_phone`).
**Tests first:**
- `src/backend/tests/test_reporter_identity.py` — anonymous normal requires name+phone; anonymous life-safety requires name, allows missing phone; authenticated identity server-derived, caller identity ignored; reporter vs eyewitness round-trip distinct; provider failure leaves no plaintext reporter PII (assert columns NULL, no plaintext column); profile-completion/life-safety exceptions match contract; GeoIP success stores only approved coarse fields; GeoIP failure accepts report with unavailable state; raw IP absent from rows/audit/logs.
**Validation commands (M4):**
```bash
cd src/backend
ruff check . && ruff format --check .
pytest -q tests/test_reporter_identity.py tests/test_civilian_api.py tests/test_contributor.py
```

---

### M5 — Validator workspace + sanitized-content + audited contact-reveal APIs
**Mode:** standard (TDD, security-critical)
**Behavior:** Add routes to `src/backend/api/routes/triage.py` (reuse the existing `_require_cluster_workflow_actor`/`get_db_with_rls` dependency graph):
1. `GET /api/triage/clusters/{cluster_id}/workspace` → returns safe cluster/report evidence, location comparisons (report pin, device GPS, EXIF GPS, IP-city centroid with server-computed PostGIS distances), image metadata + content URLs, contributor credibility summaries (`services/contributor.py`), follow-ups/activity/civilian-visible feedback. **Excludes** image bytes, original paths, raw IPs/device IDs, ciphertext, crypto metadata, original filenames, unrestricted EXIF, contact PII on normal load. Privacy projection must reuse/extend `queue_projection.py` semantics (no raw fields).
2. `GET /api/triage/reports/{report_id}/photos/{photo_id}/content` → calls M3 read service; returns only sanitized JPEG/PNG with headers `Cache-Control: no-store`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`, inline disposition with a server-owned generic filename (not the original filename). Neutral not-found for auth/scope/path failures. **No original route/fallback.**
3. `POST /api/triage/reports/{report_id}/contact-reveal` → decrypts reporter snapshot **only after** role + RLS + report-scope checks; writes a **transaction-bound sensitive audit** (`log_system_audit(..., sensitive=True)`) before returning contact data. If audit write fails → reveal fails closed (no PII returned). Audit payload contains identifiers/outcome only — no contact values, raw IPs, ciphertext, key material.
4. PostGIS distances for the four sources computed server-side (extend the `ST_Distance(ST_GeogFromText(...))` pattern already in `report_photos.py` upload, and the IP-city centroid from M1). API labels IP evidence coarse/approximate; never recommends terminal outcome from mismatch.
5. Existing claim/terminal/split/merge/activity/correction/status-update routes retain semantics.

**Non-goals:** no originals, no IP-derived exact location, no PII on normal load, no RLS broadening, no automatic terminal decision.
**Dependencies:** M1, M3, M4; `services/contributor.py` (credibility) already exists; `services/civilian_triage/` for cluster/report context already exists.
**Inspect/modify:**
- Inspect: `src/backend/api/routes/triage.py`, `src/backend/services/civilian_triage/queue_projection.py`, `src/backend/services/civilian_triage/repository.py`, `src/backend/services/contributor.py`, `src/backend/utils/audit.py:log_system_audit`, `src/backend/auth.py:get_db_with_rls`.
- Modify: add route handlers + Pydantic response schemas in `src/backend/schemas/civilian.py` (or a new `schemas/triage_workspace.py`); add service functions (`services/civilian_triage/workspace_projection.py` and a `contact_reveal.py` or extend `reporter_identity.py`).
**Tests first:**
- `src/backend/tests/test_triage_workspace.py` — workspace projection privacy (no forbidden fields); sanitized-content retrieval + header assertions + no-store/nosniff; neutral denial for unauthorized/cross-scope; contact-reveal authorization + transaction-bound sensitive audit; audit-failure blocks reveal; no original route exists (assert 404 for any original path attempt); PostGIS distance calculations handle missing sources and cast geography.
**Validation commands (M5):**
```bash
cd src/backend
ruff check . && ruff format --check .
pytest -q tests/test_triage_workspace.py tests/test_civilian_triage_module.py tests/test_report_photo_read.py
```

---

### M6 — Frontend: dedicated validator workspace page + identity UX + offline reporter-identity encryption (modal retained)
**Mode:** standard (TDD for routing/state/identity; component reuse)
**Behavior:**
1. Create App Router page `src/frontend/src/app/incidents/triage/[clusterId]/page.tsx` (`'use client'`). Queue `Inspect / Act` continues to open the modal in this milestone (parity not yet established) — the page is built alongside but not yet the default navigation target.
2. Page owns: cluster workspace query state, selected report id, freshness/stale-state, active action tab, claim/activity heartbeat lifecycle, pending destructive-confirmation state, return-to-queue query state (filters + selected item preserved via explicit URL/search params, not hidden global state). Direct load/refresh reconstructs from `clusterId` + server data; inaccessible/missing/merged/closed clusters → safe recoverable states.
3. Reuse existing modal components (do **not** reimplement): `src/frontend/src/components/triage/TriageInspectionModal.tsx`, `ClusterSummaryHeader.tsx`, `ReportsListPanel.tsx`, `TriageInvestigationBoard.tsx`, `TriageSpatialPanel.tsx`, `ActivityPanel.tsx`, `TerminalActionPanel.tsx`, `SplitActionPanel.tsx`, `MergeActionPanel.tsx`, `StatusUpdatePanel.tsx`, `CitizenMessagePreview.tsx`, `ConfirmActionDialog.tsx`, `TriageLegend.tsx`, `JurisdictionContext.tsx`, `TriageCanvasMap*.tsx`, `useTriageModalState.ts`.
4. New workspace sub-components (SSR-safe dynamic-import for any map per `frontend/AGENTS.md`): sticky cluster header, report navigator, evidence gallery (sanitized content URLs only; states: loading/loaded/empty/unavailable/corrupt/denied/partial), location comparison map (4 markers + accuracy circle + legend + distances + non-color-only classifications + "IP location approximate" copy), contributor credibility compact+expandable, explicit audited contact-reveal interaction.
5. Identity UX: anonymous reporter name/phone validation (name always; phone normal-only); authenticated `CIVILIAN_REPORTER` shows profile-derived text, no duplicate inputs; incomplete-profile handling preserves safety behavior; reporter vs eyewitness fields clearly labeled/separate (no silent copy).
6. **Offline browser reporter-identity encryption (no plaintext PII):** online drafts keep reporter PII in component memory, never written to the existing plaintext localStorage draft (non-sensitive draft fields keep using the established draft mechanism). When an anonymous report is queued offline: construct a reporter-identity snapshot separate from the non-sensitive operation payload; encrypt with the existing device-bound **non-extractable** Web Crypto key in `offlineStore.ts` (`getOrCreateKey()`, `generateKey({name:'AES-GCM',length:256}, false, ['encrypt','decrypt'])` — `false` = non-extractable, verified at line 282); use a **purpose-specific, versioned AAD distinct from photo encryption** (bind to report client id + `"reporter-identity:v1"`). Store only ciphertext, IV, version, and association identifiers in IndexedDB (reuse `OfflineOp`/`EncryptedPayload` shape, `offlineStore.ts:69/111`). Replay decrypts only when ready to submit; clears the sensitive envelope after successful sync. Key-loss/failure → mark envelope permanently unreadable; do not submit without required identity; do not fall back to plaintext; preserve non-sensitive details where safe; prompt re-entry. No service worker caches revealed validator PII or replays authenticated mutations.
7. Accessibility/HCI invariants from the frontend spec §7 (keyboard reachability, focus headings, non-color-only markers, evidence-oriented alt text, reduced-motion, two-step destructive confirmation, no commit shortcuts).
8. **No modal retirement in M6** — that is M7.

**Non-goals:** no originals/unrestricted EXIF, no plaintext reporter PII in localStorage/IndexedDB operation payloads, no raw IPs/device IDs in UI, no client-side authoritative spatial verdict, no automatic terminal recommendation, no caching of validator evidence/contact in SW/IndexedDB/localStorage, no new crypto provider.
**Dependencies:** M5 (API contracts); reuses `offlineStore.ts` encryption primitives (verified present).
**Inspect/modify:**
- Inspect: `src/frontend/src/app/incidents/triage/page.tsx` (modal wiring, line 355 `TriageInspectionModal`), `src/frontend/src/components/triage/*`, `src/frontend/src/components/civilian/PhotoUpload.tsx`, `src/frontend/src/lib/offlineStore.ts:240–392` (key/salt isolation, `encryptPayload`/`decryptPayload`:368/376), `src/frontend/src/lib/syncEngine.ts`, `src/frontend/src/lib/api/offlineCivilian*`, `src/frontend/src/app/report/*` draft logic, `system-wiki/frontend/route-map.md`, `system-wiki/frontend/validator-triage-shortcuts`.
- Modify: add `src/frontend/src/app/incidents/triage/[clusterId]/page.tsx` + workspace sub-components under `src/frontend/src/components/triage/workspace/`; add/extend frontend API client in `src/frontend/src/lib/api/` for the three new endpoints; extend `src/frontend/src/types/`; add `src/frontend/src/lib/offlineReporterIdentity.ts` (reporter-identity offline envelope helper) and wire into the offline civilian report queue; ensure plaintext reporter PII is never placed in the existing draft/localStorage path.
**Tests first:**
- `src/frontend/src/app/incidents/triage/[clusterId]/__tests__/page.test.tsx` — queue→workspace routing (deep link, refresh, filter-preserving return), report selection updates evidence without navigation, stale refresh does not overwrite action forms, inaccessible/missing/merged clusters safe states.
- `src/frontend/src/components/triage/workspace/__tests__/evidence-gallery.test.tsx` — loaded/empty/partial/missing/corrupt/denied states; only sanitized content URLs used.
- `src/frontend/src/components/triage/workspace/__tests__/location-map.test.tsx` — 4 markers + accuracy circle + legend + distances + unavailable sources + no mismatch-driven terminal recommendation.
- `src/frontend/src/components/triage/workspace/__tests__/credibility.test.tsx` — compact/expanded; anonymous-safe projection; explicit audited contact-reveal interaction.
- `src/frontend/src/components/civilian/__tests__/reporter-identity.test.tsx` — anonymous normal requires name/phone; anonymous life-safety requires name, allows missing phone; reporter vs eyewitness controls distinct; authenticated reporter inputs absent; incomplete-profile handling preserves safety.
- `src/frontend/src/lib/__tests__/offlineReporterIdentity.test.ts` — encrypt/decrypt round-trip with purpose-specific AAD; IndexedDB operation payload contains no plaintext reporter PII; localStorage draft contains no reporter PII; encrypted envelope replay + cleanup after sync; key-loss → permanent-unreadable, no plaintext fallback, prompts re-entry. Extend `src/frontend/src/lib/__tests__/offlineStore.encryption.test.ts` assertions if the store shape changes.
**Validation commands (M6):**
```bash
cd src/frontend
npm run lint
npx vitest run \
  src/app/incidents/triage/[clusterId]/__tests__/page.test.tsx \
  src/components/triage/workspace/__tests__/evidence-gallery.test.tsx \
  src/components/triage/workspace/__tests__/location-map.test.tsx \
  src/components/triage/workspace/__tests__/credibility.test.tsx \
  src/components/civilian/__tests__/reporter-identity.test.tsx \
  src/lib/__tests__/offlineReporterIdentity.test.ts
```

---

### M7 — Route queue inspection to page + modal retirement + action/UX regression
**Mode:** standard (TDD for navigation switch + parity)
**Behavior:**
1. After parity is verified (M6 page covers claim/activity heartbeat, terminal/correction/split/merge/update, destructive confirmation, citizen-message preview, activity history, selection behavior, keyboard safety), switch queue `Inspect / Act` to navigate to `/incidents/triage/[clusterId]` (edit `src/frontend/src/app/incidents/triage/page.tsx:355` and its wiring) while preserving return-to-queue filters/selected item via URL/search state.
2. Remove modal-only shell/state/CSS (`TriageInspectionModal` modal-only concerns, `triage-modal.css` modal-only rules, `useTriageModalState.ts` modal-only state) **only after** parity tests pass. Shared action components (`TriageActionTabs`, panels, `TriageCanvasMap`, `ConfirmActionDialog`, `CitizenMessagePreview`, `JurisdictionContext`) remain.
3. Keep the existing `no-commit-keyboard-shortcut` policy and two-step destructive confirmation.

**Non-goals:** no new workflow, no change to backend, no original-image exposure.
**Dependencies:** M6 (parity), M5 (API).
- Inspect: `src/frontend/src/app/incidents/triage/page.tsx`, `src/frontend/src/components/triage/TriageInspectionModal.tsx`, `useTriageModalState.ts`, `triage-modal.css`, `TriageActionTabs.tsx`, existing modal tests `TriageInspectionModal.update.test.tsx`.
- Modify: route switch in `page.tsx`; delete/trim modal-only code; update modal tests to page-parity tests (or convert).
**Tests first:**
- Extend `src/frontend/src/app/incidents/triage/__tests__/page.test.tsx` (and the M6 workspace tests) to cover: queue `Inspect / Act` navigates to the cluster workspace; return preserves filters/selected item; claim/activity heartbeat, terminal/correction/split/merge/update parity; citizen-message preview; destructive confirmation; activity timeline; no commit shortcuts; deep-link/refresh reconstruction.
- `src/frontend/src/components/triage/__tests__/modal-retirement.test.tsx` — assert modal-only shell/state removed and shared components retained (or convert existing modal tests).
**Validation commands (M7):**
```bash
cd src/frontend
npm run lint
npx vitest run src/app/incidents/triage/__tests__/page.test.tsx src/components/triage/__tests__/modal-retirement.test.tsx
npm run build   # NEXT_PUBLIC_AUTH_API_URL/ MAPBOX_TOKEN/ BASE_URL per CI
```

---

### M8 — Integrations: migration/bootstrap parity, Compose/storage health, persistence + authorization smoke (non-destructive), wiki sync
**Mode:** hardening (validation + documentation)
**Behavior:**
1. **Migration/bootstrap parity:** confirm one Alembic head (`alembic heads`); `alembic upgrade head` on a disposable fresh DB; verify clean-bootstrap `99_*.sql` applies on a fresh volume; confirm M1 columns present in both paths; confirm downgrade is documented as blocked once live data exists.
2. **Compose/storage health:** from `src/`, validate effective configs (`docker compose config --quiet` for base/ci/prod overlays per `src/AGENTS.md`) — confirm `incident_attachments_data:/app/storage` mounted into backend **and** worker for every overlay; confirm the application-level storage health probe (read/write/fsync/remove, root not `/tmp`) is wired and fails readiness on ephemeral fallback. Confirm `GEOIP_DB_PATH` presence is optional (degrades to unavailable, not startup failure).
3. **Persistence + authorization smoke (non-destructive, authorized synthetic data only):** submit synthetic report + JPEG/PNG; confirm committed + workspace metadata lists sanitized evidence; perform a supported routine backend restart/container-replacement that preserves named volume; authenticate as National Validator; retrieve sanitized evidence via the route; verify integrity/approved MIME; verify unauthorized role gets neutral denial; verify **no route serves originals**; verify normal workspace load reveals no contact PII and an explicit reveal creates the expected sensitive audit. **Destructive volume operations are prohibited** (ops spec §2).
4. **Wiki synchronization (after behavior verified, per `system-wiki/AGENTS.md`):** update `system-wiki/subsystems/civilian-reporting-phase2.md`, `system-wiki/frontend/route-map.md`, `system-wiki/backend/api-route-map.md`, `system-wiki/database/schema-overview.md`, `system-wiki/security/security-baseline.md`, `system-wiki/operations/civilian-triage-hci-polish.md`; update `system-wiki/index.md` and append `system-wiki/log.md`; update `system-wiki/gaps/frs-codebase-gap-register.md` only if FRS/code alignment changed. Do **not** claim the feature is live until deploy evidence exists.

**Non-goals:** no off-host backup/object-storage redesign, no DR redesign, no production deploy from this plan, no new dependencies.
**Dependencies:** M1–M7.
**Inspect/modify:**
- Inspect: `src/AGENTS.md`, `src/docker-compose.yml` (+ `.ci.yml`/`.prod.yml` overlays), `.env.example`, `src/postgres-init/`, `src/backend/alembic/versions/`, the six wiki pages + `index.md`/`log.md`/`gaps/`.
- Modify: wiki pages (synthesis only, post-verification); confirm (not edit) Compose storage mounts.
**Validation commands (M8):**
```bash
cd src/backend && alembic heads && \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wims_test alembic upgrade head
cd src && docker compose config --quiet && \
  docker compose --env-file ../.env.example -f docker-compose.yml -f docker-compose.ci.yml config --quiet && \
  docker compose --env-file ../.env.example --env-file .env.production.example -f docker-compose.yml -f docker-compose.prod.yml config --quiet
# Persistence smoke (authorized synthetic, non-destructive) per ops spec §5 — run in isolated env
cd src/frontend && npm run build
git diff --check -- system-wiki
```

---

## Cross-task validation & final integration checks

After M1–M8 are individually accepted, run the full baseline gates (commands are the executable merge-gate source per `.github/workflows/ci.yml` and `docs/agents/ci-preflight.md`):

**Backend (from `src/backend/`):**
```bash
ruff check . && ruff format --check .
pytest -v --tb=short \
  --ignore=tests/test_rate_limiting.py --ignore=tests/test_suricata_ingestion.py \
  --ignore=tests/test_infra_config.py \
  --ignore=tests/integration/test_wims_initial_schema_bootstrap.py \
  --ignore=tests/integration/test_auth_otp_policy.py \
  --ignore=tests/integration/test_database_schema.py \
  --ignore=tests/integration/test_rls_policy_enforcement.py \
  --ignore=tests/integration/test_sql_quality_audit.py
alembic heads
# Append every new focused test file:
#   test_0029_geoip_reporter_schema.py, test_geoip_evidence.py, test_report_photo_read.py,
#   test_reporter_identity.py, test_triage_workspace.py
```
Run the **excluded** RLS/bootstrap/SQL-quality integration suites explicitly in their required Compose environment and report each result separately (they are not evidence of passing under the default run).

**Frontend (from `src/frontend/`):**
```bash
npm ci
npm run lint
npx vitest run
NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth/realms/bfp \
NEXT_PUBLIC_MAPBOX_TOKEN= NEXT_PUBLIC_BASE_URL=http://localhost \
npm run build
# Append every new focused test file from M6/M7/M8.
```

**Compose (from `src/`):** the three `docker compose config --quiet` combinations above. A successful config parse proves interpolation/structure only — not startup, migration, storage durability, or health.

**Deployment checks:** **planned/skipped until authorized.** This plan performs no VPS/docker deploy. When authorized, follow ops spec §3: target `master`, confirm no running `deploy.yml` (`gh run list --workflow=deploy.yml --limit=5`) before any manual VPS step, verify Alembic head, verify service health, verify storage health is durable/non-ephemeral, verify GeoIP unavailable mode stays healthy, and run the §5 non-destructive persistence/authorization smoke. Do **not** use `docker compose down -v`.

## Acceptance-criteria → milestone traceability

| Design acceptance criterion | Covered by |
|---|---|
| 1. Sanitized evidence survives routine deploy/restart/container-replacement | M1 (named volume unchanged), M3 (read), M8 (persistence smoke) |
| 2. Validators view sanitized images + safe metadata in cluster workspace; originals inaccessible | M3, M5 |
| 3. Map shows report pin, device GPS, EXIF GPS, coarse IP-city centroid + accuracy | M5, M6 |
| 4. Missing sources shown unavailable; no auto-reject/action | M3, M5, M6 |
| 5. Anonymous normal needs name+phone; life-safety needs name, phone optional | M4, M6 |
| 6. Authenticated reporters not asked to repeat identity; server-derived encrypted snapshot; eyewitness untouched | M4, M6 |
| 7. No plaintext reporter PII in browser drafts/offline payloads; encrypted offline replay works | M6, M7 |
| 8. Anonymous Turnstile/lower cap + registered bypass/higher cap preserved | M4 (no change to lines 432–450) |
| 9. Contributor credibility + feedback/history in workspace; no raw device IDs/IPs/contact PII on load | M5, M6 |
| 10. Contact reveal explicit, role-protected, sensitively audited | M5 |
| 11. Queue polling remains lightweight/privacy-minimized | M5 (reuses queue_projection privacy), unchanged `/api/triage/queue` |
| 12. Schema upgrades work for persistent + clean bootstrap | M1, M8 |
| 13. Images/sensitive metadata/validator evidence not cached offline | M6, M7 |

## Risk register (preserved boundaries)

- **Queue minimization:** `/api/triage/queue` and `queue_projection.py` are not modified to add PII/photo bytes (criterion 11).
- **RLS:** no new public policy, no `BYPASSRLS`, no admin-session domain query added; read service uses `get_db_with_rls` (M3/M5).
- **Crypto/AAD:** existing `sanitized:v1` AAD reused for reads; new `reporter-identity:v1` AAD (M4); offline purpose-specific AAD (M7). No plaintext fallback; encryption failure fails closed.
- **Audit fail-closed:** contact reveal writes transaction-bound sensitive audit before returning PII; audit failure blocks reveal (M5).
- **PostGIS:** all distance/classification computations server-side; frontend renders server-provided values only (M5/M6).
- **Original-image non-access:** no route, no fallback path; sanitized-read failures never return originals (M3).
- **Anonymous/auth rate/CAPTCHA:** unchanged (M4).
- **Named-volume current implementation:** preserved; acceptance test is storage-backend independent (M8, ops spec §2).
