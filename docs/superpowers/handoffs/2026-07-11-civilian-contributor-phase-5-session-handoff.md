# Session Handoff: Civilian Contributor Phase 5

**Date:** 2026-07-11  
**Branch:** `feat/civilian-contributor-phase-5`  
**Pull request:** [#553](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/pull/553)  
**Base:** `master`

## Purpose

Continue the Phase 4/Phase 5 civilian contributor work with **subagent-driven development**. The next session must use read-only/context-gathering subagents before implementation, then keep one parent-controlled writer per slice. Subagents must not commit; the parent should review, validate, and commit coherent slices.

## Durable context

- Approved design: `docs/superpowers/specs/2026-07-06-civilian-contributor-enhancement-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-11-civilian-contributor-phase-5-implementation-plan.md`
- Production routing dependency: GitHub issue [#552](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/552)
- The plan artifact's historical "current implementation facts" and acceptance report predate the latest slices. Re-read live source and this handoff; do not treat those stale statements as current behavior.

## What is implemented in PR #553

Commits currently pushed:

- `b1410b54` — Phase 5 foundations
- `0cb2f887` — preserved the implementation plan in tracked `docs/`

Implemented and tested foundations include:

1. Fail-closed optional authentication: absent credentials may be anonymous; supplied invalid credentials do not silently become anonymous.
2. Capability-only public tracking projection with neutral failure behavior and no public coordinates, PII, or trust score.
3. Public leaderboard removal and private normalized trust-score groundwork.
4. Normalized reliability score implementation using live terminal statuses, UTC six-month semantics, evidence tolerance, and formula version `reliability-v1`.
5. Migrations/bootstrap/tests for contributor snapshot cleanup and photo pre-upload schema.
6. Anonymous session schema/helper groundwork: hash-backed token, expiry/revocation, report/photo ownership columns, narrow helper grants, and no broad `BYPASSRLS`.
7. Registered contributor pending photo upload at `POST /api/civilian/photos/upload`, reusing encrypted validation/storage, SHA-256 hashes, idempotency, owner caps, audit, and safe cleanup.
8. Design/spec and relevant system-wiki synchronization.

Focused local validation passed during the session:

- Anonymous-session, civilian API, and report-photo tests: `36 passed` in the final local run.
- The implementing subagent reported `56/56` targeted tests including its added pending-upload tests.
- Ruff check and format checks passed for touched Python files.
- `git diff --check` passed.

The local worktree still has unrelated/pre-existing unstaged `.pi` changes:

- Modified: `.pi/settings.json`
- Untracked: `.pi/agents/`, `.pi/chains/`

Do not stage those paths unless the user explicitly requests it.

## Immediate next slice

### Slice A — Anonymous pending photo insertion

The current pre-upload route intentionally returns `501` for anonymous requests. Implement the missing safe path:

- Add or use a narrowly scoped SQL helper that creates the encrypted pending photo row while deriving ownership from the validated anonymous capability.
- The raw capability must be accepted only through the Authorization header, used transiently, and never logged, persisted in Python, or placed in a URL.
- Preserve `FORCE ROW LEVEL SECURITY`; do not use a general superuser session, `BYPASSRLS`, caller-set owner IDs, or unrestricted GUCs.
- Keep `report_id` and `attached_at` null for pending rows.
- Preserve encrypted original/sanitized/metadata artifacts, SHA-256 hashes, AAD/key-version conventions, idempotency, owner caps, audit, and safe compensation cleanup.
- Add disposable-Postgres/RLS integration coverage, not only static SQL assertions.

### Slice B — Atomic report creation and photo attach

After Slice A is safe:

- Accept photo IDs/client photo IDs during report submission.
- Set `citizen_reports.anonymous_session_id` from the validated capability in the same transaction.
- Lock the report and complete pending photo batch; reject cross-owner, mixed-owner, duplicate, partial, expired, or already-attached batches neutrally.
- Call the atomic attach helper and create the report/audit record as one transaction with rollback coverage.
- Preserve compatibility with the current post-submit route only as an explicit migration path.
- Add idempotent retry tests and live RLS/audit tests.

## Remaining planned work after photo flow

1. CMS backend: content/version tables, publication pointer, lifecycle, preview, rollback, bilingual/expiry rules, sanitizer, admin authorization, audit, and expiry task.
2. Community frontend: `/community`, announcement/event detail routes, safety-first hierarchy, locale fallback states.
3. Private contributor dashboard: `/contributor`; no public leaderboard.
4. Admin CMS UI: draft/editor/preview/publish/archive/version history/rollback.
5. Station directory: searchable list first, optional map, retained pins, selection center/highlight, keyboard/mobile and map-failure fallback.
6. Frontend API/route integration and root-page emergency-first contributor invitation.
7. System-wiki route/schema/security updates after live behavior is implemented.
8. Performance benchmark at approximately 10k contributors/100k reports before considering caching.
9. Full CI/migration/frontend gate per `.github/workflows/ci.yml` and `docs/agents/ci-preflight.md`.
10. Controlled production routing remains blocked on issue #552; public OSRM is prototype-only.

## Required next-session workflow

1. Run `git status --short --branch`, confirm branch/PR, and preserve the unstaged `.pi` paths.
2. Read current root and scoped instructions before editing:
   - `AGENTS.md`
   - `src/AGENTS.md`
   - `src/backend/AGENTS.md`
   - `docs/AGENTS.md`
   - `docs/agents/gotchas.md`
   - relevant `system-wiki` instructions/context packs
3. Read this handoff, the approved design, and the tracked implementation plan.
4. Dispatch parallel **read-only** context-gathering subagents for:
   - backend photo/report transaction and route ownership;
   - PostgreSQL migration/RLS/helper/audit security;
   - QA/integration/CI coverage and disposable database setup;
   - frontend report submission contract and offline/idempotency impact.
5. Ask the subagents to cite exact files/symbols, identify stale assumptions, and propose the smallest next slice. Do not let context-gathering agents edit files.
6. Have the parent synthesize the findings and resolve conflicts against live code, the approved spec, and the plan. If a security or contract conflict is found, stop and request a decision rather than silently weakening the design.
7. Dispatch one implementation subagent as the sole writer for the selected narrow slice, in a fresh context, with explicit file scope and no commit instruction.
8. Review the diff and re-read changed files. Run the narrowest tests first, then required backend/security/migration checks. Use disposable services only; never use production tools or destructive persistent-volume commands.
9. Re-run independent read-only security and QA reviews against the diff. Parent applies any fixes.
10. Update relevant docs/wiki/log only when live behavior changed, then commit and push a coherent slice to PR #553.
11. End with `git status --short --branch`, exact checks/results, skipped checks/reasons, residual risks, and the next slice.

## Safety boundaries

- Never expose plaintext PII, raw capabilities, exact public report coordinates, or secret-bearing logs.
- Do not turn `/` into the Community landing page; it remains anonymous emergency reporting.
- Do not reintroduce a public leaderboard.
- Do not weaken RLS or use broad `BYPASSRLS` to make tests pass.
- Do not run production SSH/Compose commands or destructive database operations without explicit approval.
- Do not claim the full plan is implemented; PR #553 is a foundation and partial Task 5 implementation.
