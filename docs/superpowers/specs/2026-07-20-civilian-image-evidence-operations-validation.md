# Civilian Image Evidence — Operations and Validation Execution Specification

**Date:** 2026-07-20

**Status:** Approved decomposition of the canonical design

**Canonical behavioral contract:**
`docs/superpowers/specs/2026-07-20-civilian-image-evidence-workspace-design.md`

This document owns migration sequencing, deployment safety, storage durability
verification, observability, rollback, validation evidence, and documentation
synchronization. It does not redefine product behavior or application security
contracts.

## 1. Scope

This execution specification owns:

- Alembic/bootstrap rollout verification;
- effective Compose/storage configuration checks;
- non-destructive persistence smoke testing;
- backend/frontend/security validation orchestration;
- observability and reconciliation checks;
- rollback boundaries;
- system-wiki and operational documentation synchronization.

Off-host backup, object storage, and disaster-recovery redesign remain out of scope.

## 2. Durable operational requirements

The behavioral requirement is storage-backend independent:

> A civilian image accepted and committed by the application remains available as
> the same authorized sanitized evidence after supported routine deployment,
> restart, and application-container replacement operations.

The current implementation satisfies this through the Docker named volume mounted
at `/app/storage`. Validation may inspect the current named-volume configuration,
but acceptance must not depend permanently on a specific Docker volume name or
host path. A future storage implementation may change without changing the
behavioral contract if it preserves durability, authorization, encryption,
integrity, and cleanup semantics.

The following are explicitly outside routine supported operations:

- deleting storage volumes;
- pruning active application storage;
- destructive database reset;
- replacing the VPS without restoring data.

These actions are not acceptable smoke-test steps.

## 3. Migration and deployment sequence

### 3.1 Pre-deploy

1. Confirm the branch/PR targets `master`.
2. Compare `.github/workflows/ci.yml` with `docs/agents/ci-preflight.md`.
3. Verify one Alembic head and inspect the new revision's predecessor.
4. Validate clean-bootstrap SQL alignment for new GeoIP and encrypted reporter
   identity fields.
5. Confirm effective production Compose mounts the configured civilian image
   storage into every service that reads, writes, or reconciles artifacts.
6. Confirm GeoIP provider/database configuration is present where required; absence
   must degrade to unavailable evidence, not fail startup or submission.
7. Confirm crypto-provider and key metadata contracts without printing secrets.
8. Before any VPS intervention, check for a running automated deploy with:

```bash
gh run list --workflow=deploy.yml --limit=5
```

Do not race the automated deploy pipeline.

### 3.2 Deploy

1. Apply application images and migration through the established deploy workflow.
2. Verify Alembic reaches the expected head.
3. Verify backend, worker, database, Redis, Keycloak, frontend, and gateway health
   according to the current deployment check suite.
4. Verify the configured image storage health check reports durable/writable and
   does not resolve to an unapproved ephemeral fallback.
5. Verify GeoIP unavailable mode remains healthy if provider data is intentionally
   absent in the target environment.
6. Do not use `docker compose down -v`.

### 3.3 Post-deploy

Run the authorized persistence and access smoke test in Section 5, inspect
application/worker logs for safe error classes, and verify no sensitive values or
raw IPs were emitted.

## 4. Storage health and observability

### 4.1 Storage health check

The application-level check should verify behavior rather than expose host details:

- configured root resolves successfully;
- directory exists or can be created according to startup policy;
- backend can perform a bounded create/fsync/read/remove probe;
- worker sees the same configured storage identity where reconciliation requires
  it;
- root is not an unapproved ephemeral fallback such as `/tmp`;
- free-space/inode conditions are reported through safe thresholds;
- health output never lists artifact filenames, report IDs, metadata, or secrets.

A failed durable-storage check should fail the relevant service health/readiness
state rather than silently accepting image writes to ephemeral storage.

### 4.2 Metrics and logs

Track aggregate, non-sensitive signals for:

- photo upload accepted/rejected by reason class;
- sanitized read success/unavailable/integrity/decrypt/path failures;
- GeoIP available/unavailable/error;
- contact reveal success/denied/audit failure;
- reconciliation referenced/quarantined/temp-cleaned counts;
- storage capacity thresholds.

Logs exclude reporter contact values, raw IPs, EXIF coordinates, browser GPS,
original filenames, storage paths outside safe normalized identifiers, ciphertext,
nonces, keys, and tokens.

### 4.3 Reconciliation

The existing worker reconciliation remains the artifact consistency mechanism.
Deployment validation must confirm:

- worker and backend use the same durable storage backend;
- referenced artifacts are not quarantined;
- stale temporary cleanup remains bounded to recognized files;
- symlinks/out-of-root paths are rejected;
- quarantine behavior does not make an original artifact available as fallback.

## 5. Persistence and authorization smoke test

Run only in an authorized, non-destructive environment with synthetic image data
and test identities.

### 5.1 Behavioral procedure

1. Submit a synthetic civilian report through the intended anonymous or registered
   path.
2. Upload a synthetic JPEG/PNG and record only safe test identifiers.
3. Confirm the application reports the image committed and workspace metadata lists
   sanitized evidence.
4. Perform a supported routine backend deployment/restart/container-replacement
   operation that preserves configured durable storage.
5. Authenticate as an authorized National Validator.
6. Retrieve the sanitized evidence through the application route.
7. Verify content integrity against the known synthetic sanitized result or the
   application's stable evidence digest contract.
8. Verify an unauthorized role receives the neutral denial contract.
9. Verify no application route provides original-image content.
10. Verify ordinary workspace loading does not reveal reporter contact and that an
    explicit authorized reveal creates the expected sensitive audit record.

### 5.2 Pass criteria

- committed sanitized evidence remains available after the supported routine
  operation;
- returned content has preserved integrity and approved MIME;
- authorization and neutral-denial behavior hold;
- original evidence remains inaccessible;
- storage, application, and audit logs contain no prohibited sensitive values;
- reconciliation does not quarantine the committed artifact.

This procedure intentionally avoids asserting a Docker volume name, host path, or
cipher implementation. Those are current implementation checks, not the durable
behavioral acceptance criterion.

## 6. Validation ladder

### 6.1 Documentation/spec-only stage

```bash
git diff --check
```

Verify referenced paths, contracts, and scoped instructions.

### 6.2 Backend and migration stage

From `src/backend/`:

```bash
ruff check .
ruff format --check .
pytest -q tests/test_report_photos.py tests/test_contributor.py tests/test_civilian_triage_module.py
alembic heads
```

Append all newly added focused backend test files to this baseline command. Use a
disposable database for migration upgrade/bootstrap checks. Include relevant
RLS, crypto-provider, audit, and infrastructure-heavy tests explicitly; default
pytest ignore rules are not evidence those suites passed.

### 6.3 Frontend stage

From `src/frontend/`:

```bash
npm run lint
npx vitest run src/app/report/__tests__/page.test.tsx src/app/incidents/triage/page.test.tsx src/components/civilian/PhotoUpload.test.tsx
npm run build
```

Append all newly added focused frontend test files to this baseline command. Run
focused offline-store/sync tests for IndexedDB/encryption/replay changes.

### 6.4 Compose stage

From `src/`, validate effective configurations using the committed safe env
contracts and the exact base/CI/production overlay combinations documented in
`src/AGENTS.md`. A successful `docker compose config` proves interpolation and
structure only; it does not prove startup, migration, storage durability, or health.

### 6.5 Push/PR stage

Follow `.github/workflows/ci.yml` as the executable merge-gate source and
`docs/agents/ci-preflight.md` as guidance. Report every skipped or unavailable
suite with the exact command and reason.

## 7. Rollback boundaries

### 7.1 Application rollback

A frontend/backend image rollback may be safe only if the previous application can
operate with the additive nullable schema. Verify this explicitly in the migration
plan. Do not downgrade the database merely to match an application rollback unless
an approved recovery plan proves no encrypted reporter snapshots or GeoIP evidence
will be lost.

### 7.2 Migration rollback

Downgrade behavior must not silently drop live encrypted reporter identity or coarse
location evidence. If safe lossless downgrade is impossible after writes begin,
the migration must document downgrade as blocked or require a separately approved
export/recovery procedure.

### 7.3 Feature fallback

If the dedicated workspace fails after deploy:

- preserve the existing queue and action workflow during the parity period;
- disable navigation to the new route through the smallest approved rollback;
- do not disable photo writes merely because sanitized reads are unavailable;
- do not expose originals as a temporary workaround;
- retain all committed artifacts and evidence rows for later recovery.

## 8. Documentation synchronization

After implementation—and only after behavior is verified—update:

- `system-wiki/subsystems/civilian-reporting-phase2.md`;
- `system-wiki/frontend/route-map.md`;
- `system-wiki/backend/api-route-map.md`;
- `system-wiki/database/schema-overview.md`;
- `system-wiki/security/security-baseline.md`;
- `system-wiki/operations/civilian-triage-hci-polish.md`;
- `system-wiki/gaps/frs-codebase-gap-register.md` when FRS/code alignment changes;
- `system-wiki/log.md`.

Update API/user/operations documentation affected by the final implementation.
Follow `system-wiki/AGENTS.md` for frontmatter, sources, links, indexes, and log
requirements. Do not claim the feature is live based only on merged specs or code;
production claims require the corresponding deploy evidence.

## 9. Delivery evidence checklist

The implementation handoff/PR must state:

- files changed by backend, frontend, migration/bootstrap, infrastructure, tests,
  and docs;
- targeted and broad commands run with exact results;
- migration head and disposable upgrade/bootstrap result;
- RLS, crypto, audit, offline, and persistence smoke evidence;
- checks skipped with reasons;
- final `git status` including unrelated pre-existing work;
- system-wiki and gap-register disposition;
- residual risks, especially the accepted absence of off-host backup.

## 10. Stop conditions

Pause deployment and request a decision if:

- automated deployment is already running before manual VPS intervention;
- effective storage resolves to ephemeral or divergent backend/worker locations;
- migration would drop or expose PII;
- raw IPs or sensitive location/contact values appear in logs or audits;
- sanitized reads require original fallback;
- rollback requires destructive volume/database operations;
- required RLS, crypto, audit, migration, offline, or persistence checks cannot be
  run and no approved substitute exists.
