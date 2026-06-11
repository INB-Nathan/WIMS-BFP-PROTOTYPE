## Executive Summary
This branch implements a large offline-first Regional Encoder workflow: local incident editing/queues, reconnect sync, backend `client_id` idempotency, PWA/connectivity behavior, and supporting docs/tests. The core direction is useful, but the verified findings include security-critical auth/credential issues, CI-breaking formatting, and central idempotency correctness gaps. **Verdict: ❌ Blocked** — do not merge until the blockers below are fixed and the branch is rebased against overlapping PRs.

---

## 1. Review Coverage

| Axis | Verdict | Verified | Refuted | Unverifiable | Critical | Major |
|------|---------|----------|---------|--------------|----------|-------|
| Standards | needs_work | 5 | 1 | 0 | 2 | 1 |
| Spec | needs_work | 4 | 0 | 0 | 1 | 1 |
| Quality | needs_work | 8 | 0 | 0 | 2 | 3 |
| Test | needs_work | 7 | 0 | 0 | 1 | 2 |
| Cleanliness | needs_work | 5 | 0 | 0 | 3 | 1 |

**Total:** 30 findings, 29 verified (96.7%), 1 refuted, 0 unverifiable. Verified severity distribution: 9 critical, 8 major, 10 minor, 2 nit. Some issues are duplicated across axes; triage below de-duplicates by risk.

Critical findings were spot-checked against the worktree. Confirmed examples include `syncEngine.ts` returning `{ error } as never`, `processDelete` using `body: undefined as unknown as string`, `main.py` creating `wims_app_user` with password `wimsapp`, Keycloak demo OTP constant `123123`, and ruff-format diffs in the three backend files.

---

## 2. Blast Radius

65 files changed (+4,438 / -781). Runtime impact spans auth infrastructure, backend startup/DB schema, incident APIs, shared frontend offline libraries, Regional Encoder UI, service worker/config, and tests/docs/wiki.

| File / group | Impact | Recent Activity | Hotlist? |
|------|--------|----------------|-----------|
| `src/backend/main.py` | core infrastructure/startup DB patch; all backend deployments | 10 recent commits in file log | ⚠️ yes |
| `src/docker-compose.yml` / prod compose | core dev/deploy config; Keycloak image and DB URLs | 10 recent commits | ⚠️ compose |
| `system-wiki/log.md` | docs/coordination; frequent conflict source | 10 recent commits | ⚠️ yes |
| `src/backend/api/routes/incidents.py` | incident upload-bundle path used by offline sync | 10 recent commits | — |
| `src/backend/api/routes/regional/encoder_crud.py` | Regional Encoder create/update/delete API | 2 recent commits | — |
| `src/postgres-init/45_add_client_id_to_incidents.sql` | DB migration/idempotency schema | new migration | — |
| `src/frontend/src/lib/syncEngine.ts` | shared offline sync engine for encoder workflow | 7 recent commits | — |
| `src/frontend/src/lib/offlineStore.ts`, `connectivity.ts`, hooks | shared frontend offline storage/connectivity | 7 recent commits for offlineStore | — |
| Regional dashboard/pages/forms/components | feature-specific UI, but large user-visible surface | `IncidentForm.tsx`: 10 recent commits | — |
| `src/keycloak/*demo-otp*`, realm JSON, `Dockerfile` | auth infrastructure; every login using browser OTP | new/1 recent commit | — |
| Backend/frontend tests and docs/wiki | no direct runtime impact, but CI/review confidence | mixed | — |

**Risk level:** 🔴 High — this is not a narrow frontend feature. It touches authentication, database startup roles, incident creation/idempotency, deployment config, and a heavily modified Regional Encoder surface. Security and CI findings are in core/high-blast-radius files.

---

## 3. Cross-PR Conflicts

### Hotlist
| File | Status |
|------|--------|
| `src/backend/api/routes/auth.py` | Not touched |
| `src/backend/main.py` | ⚠️ Changed |
| `.env.example` | Not touched |
| `docker-compose.yml` | ⚠️ `src/docker-compose.yml` changed |
| `system-wiki/log.md` | ⚠️ Changed |

### Open PR Overlaps (`gh pr list`)
| File | This PR | Open PR(s) | Merge Order Risk |
|------|---------|------------|------------------|
| `src/backend/api/routes/incidents.py` | +78/-11 | #252 `feat/m6-key-rotation` | ⚠️ core incident route conflict |
| `src/backend/api/routes/regional/encoder_crud.py` | +61/-17 | #252 `feat/m6-key-rotation` | ⚠️ core regional route conflict |
| `src/backend/main.py` | +21/-0 | #258 `feat/m15-ref-table-rls` | ⚠️ startup/RLS conflict |
| `system-wiki/gaps/frs-codebase-gap-register.md` | +1/-0 | #252, #258 | expected wiki conflict |
| `system-wiki/log.md` | +124/-0 | #252, #253, #254, #258 | expected log conflict |

### Local Worktree Overlaps
Additional local branches overlap `src/docker-compose.yml`, `src/backend/celery_config.py`, `IncidentForm.tsx`, Keycloak realm JSON, `offlineStore.ts`, and multiple wiki files (`pr-229`, `pr-230`, `pr-237`, `pr-238`, `pr-247`, `pr-249`, `pr-250`, `pr-252`, `pr-253`-`pr-256`).

**Recommendation:** do not merge this branch first. Merge/review smaller focused PRs touching security/core infra (#252, #258, and focused compose/celery work) first if they pass, then rebase this branch and resolve conflicts. This PR is currently high-risk and blocked, so it should be last in the merge order.

---

## 4. Triage

### 🔴 Must-Fix Before Merge (Blockers)
| ID | Axis | Finding | Risk |
|----|------|---------|------|
| P1/Q2/P2/C5 | Spec/Quality/Cleanliness | Temporary Keycloak demo OTP provider is committed, wired into compose/realm, and accepts hardcoded OTP `123123`; `target/` artifact is tracked. The removal guide explicitly says to remove before opening a PR unless demo-only. | Security-critical auth bypass and scope creep in auth infrastructure. Restore base Keycloak image/`auth-otp-form`, remove provider/artifact, and keep only normal OTP policy tests. |
| Q1 | Quality | `src/backend/main.py` startup patch creates `wims_app_user` with hardcoded password `wimsapp`. | Source-visible database credential in core startup path; affects every deployment that runs the self-heal patch. Use secret/env provisioning with no unsafe default. |
| C1/C2/C3 | Cleanliness | `ruff format --check` fails for `incidents.py`, `encoder_crud.py`, and `main.py`. | CI-breaking mechanical issue. Merge gate will be red until `ruff format` output is applied. |
| Q4 | Quality | Upload-bundle idempotency uses SELECT-then-INSERT without an atomic conflict path. | Concurrent retry with same `client_id` can race into duplicate-key/500, undermining the central offline-first idempotency guarantee. Use `INSERT ... ON CONFLICT`/retry transaction. |
| T1 | Test | No direct backend test covers `encoder_crud.py` `client_id` idempotency path. | Main feature path lacks regression coverage; after fixing idempotency/validation, add duplicate-`client_id` tests for the Regional Encoder create endpoint. |

### 🟡 Should-Fix Before Merge
| ID | Axis | Finding | Risk |
|----|------|---------|------|
| Q3 | Quality | `encoder_crud.py` casts raw `client_id` to `:cid::uuid` without validation. | Malformed input can produce an unhandled PG error/500 in an API path used by offline sync. |
| S1/Q5, S2 | Standards/Quality | `syncEngine.ts` uses `as never`, `as unknown as {error:string}`, and `undefined as unknown as string` in shared sync code. | Type erosion in the offline sync engine increases chance of uncaught runtime errors. Replace with a discriminated union and omit DELETE body. |
| S5 | Standards | `checkSession()` maps HTTP 500/429 to `offline`. | Backend degradation can be hidden as connectivity loss, causing sync to silently defer instead of surfacing server/auth failures. |
| C4 | Cleanliness | `base64ToBlob` dead code in `IncidentForm.tsx`. | Avoids lint/human-review noise in a large diff. |
| P3/P4 | Spec | Celery registration fix is unrelated; no linked issue/FRS/acceptance criteria. | Scope and acceptance are ambiguous. Extract or clearly justify in PR body. |
| T3/T6/T7 | Test | Offline regional list/online-cache paths, real IndexedDB ops, and connectivity probe edge cases lack direct tests. | Important offline behavior can regress without clear coverage. Add targeted tests if these paths remain in scope. |

### 🟢 Can Defer
| ID | Axis | Finding |
|----|------|---------|
| S3 | Standards | Duplicate `isNetworkError` helper in three frontend files; refactor to shared helper later if behavior stabilizes. |
| S6 | Standards | `__resetConnectivityForTests` exported from production module; low runtime risk but should eventually be test-only. |
| Q6 | Quality | `markSynced` does a redundant `put` then `delete`. |
| Q7 | Quality | IndexedDB cache errors are swallowed; improve observability later if not blocking UX. |
| Q8 | Quality | Duplicate `information_schema` query per create request; low performance risk at current scale. |
| T2/T4/T5 | Test | Celery test directionality, auth-refresh success test, and React `act()` warnings should be improved but are not primary blockers. |

### ⚪ Do Not Fix
| ID | Axis | Finding | Why |
|----|------|---------|-----|
| S4 (OCC portion) | Standards | “OCC 409 untested” | Refuted: `test_occ_conflict.py::test_stale_write_returns_409` already covers the stale-write 409 path. Do not add redundant OCC tests solely for this claim. |

---

## 5. Merge Verdict

**Verdict:** ❌ Blocked

**Confidence:** 0.93 — all five review axes were verified, critical findings were spot-checked in the worktree, CI-format failure and branch overlaps were independently checked, and GitHub/local overlap data corroborates high merge risk.

**Reasoning:** The deciding factors are not stylistic. A hardcoded Keycloak OTP bypass is present and wired into the runtime image/realm, a core backend startup patch hardcodes a DB credential, ruff formatting currently fails CI, and offline idempotency still has a verified race plus missing endpoint coverage. Any one of the security or CI items would block; together they make this unsafe to merge.

**5 PM Friday test:** No. I would not merge this before vacation because it could ship an MFA bypass, create production credential debt, fail CI, and conflict with other active PRs in core incident/startup files.

---

## 6. Human Review Needed

1. Security/product owner decision: confirm whether the demo OTP bypass is ever acceptable in `master`. Current repo guidance says remove before PR, so default is removal.
2. Maintainer coordination: decide merge order with #252, #258, and local compose/celery/keycloak branches before rebasing this PR.
3. Product/FRS owner: provide explicit acceptance criteria or issue/FRS reference for the offline-first encoder behavior; current evidence is inferred from commits/docs.

Wiki updates: none made; this is a review report only, with no branch file changes.
