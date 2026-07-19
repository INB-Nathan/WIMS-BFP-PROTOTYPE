# Device Blocklist Production Repair — Design

**Date:** 2026-07-19  
**Status:** Approved for specification review  
**Scope:** Repair the production device-blocklist schema contract, restore device-token correlation configuration documentation, and make the monitoring UI explain unavailable device blocking.

## Problem and evidence

Read-only production inspection established two independent failures:

1. `wims.device_blocklist` does not exist in the production database, even though the backend is at Alembic revision `0026`. The table is currently defined only in `src/postgres-init/94_device_blocklist.sql`. Production startup runs `alembic upgrade head` in `src/backend/entrypoint.sh`, so an existing database never receives the bootstrap-only table.
2. `DEVICE_TOKEN_SIGNING_KEY` is absent from the production backend environment. `device_token_middleware._issue_token()` intentionally returns no token/hash without that key. As a result, the production threat-log corpus has no `device_token_hash` values, and the UI cannot enable device blocking for any row.

No production data, key, or environment file is included in this change.

## Goals

1. An existing database upgraded through Alembic obtains `wims.device_blocklist` with the same table, indexes, RLS posture, and repeat-offender configuration as the clean bootstrap definition.
2. The repository documents the required non-secret device-token signing-key configuration without supplying a default or committing a real key.
3. Every threat-feed row visibly exposes a Device Block action. The action is enabled only when the row carries a correlated `device_token_hash`; otherwise it is disabled with a concise explanation.
4. Tests prevent the missing migration and the misleading hidden-action state from returning.

## Non-goals

- Backfilling historical `security_threat_logs.device_token_hash` values.
- Inventing a device identifier from IP, user agent, or browser fingerprint.
- Allowing a device block request without a server-correlated device token.
- Writing, rotating, or exposing the production signing key as part of repository changes.
- Changing existing RBAC, RLS authorization semantics, Redis fail-open behavior, audit behavior, or device-block API contracts.

## Design

### Persistent schema repair

Add one new Alembic revision after the current head. Its `upgrade()` creates `wims.device_blocklist` idempotently, creates its two indexes, enables and forces RLS, replaces the `device_blocklist_admin_all` policy with the established SYSTEM_ADMIN-only predicate, and inserts the default `device_blocklist.repeat_offender_threshold` configuration using `ON CONFLICT DO NOTHING`.

The migration mirrors the authoritative clean-bootstrap contract in `src/postgres-init/94_device_blocklist.sql`. The downgrade reverses only objects introduced by the migration in dependency-safe order. It must not alter unrelated tables or bootstrap history.

### Signing-key deployment contract

Add `DEVICE_TOKEN_SIGNING_KEY` as a required non-secret-placeholder entry in the applicable committed environment example/contract, with a clear description that production must provide a cryptographically random secret through the established deployment secret mechanism. No fallback value is permitted: the middleware’s existing fail-open behavior remains intact when configuration is absent.

The production rollout runbook portion of the implementation must state that the new secret is configured before deployment, never printed, and verified only by its presence—not its value.

### Monitoring UI

Keep the backend as the authority: only a server-correlated `device_token_hash` may be blocked. Replace the current conditional action group with an always-visible Device Block control:

- With a hash: preserve the current enabled `Block Device` button and its existing confirmation/API call.
- Without a hash: render a disabled `Block Device` button with an accessible explanatory title/description: `Device blocking unavailable: this alert has no correlated device token.`
- Preserve the existing source-IP action in both cases. No client-side attempt is made to call the device-block API without a hash.

## Validation

1. Add a migration-focused regression test or executable contract assertion that fails if the Alembic upgrade path does not create `wims.device_blocklist` with its expected RLS policy and configuration key.
2. Add/extend frontend tests to verify both the enabled correlated-device action and the disabled explanatory action for an uncorrelated threat row.
3. Run the targeted backend migration/test checks, backend Ruff, targeted frontend Vitest, frontend lint, and production build.
4. In a future authorized deployment, verify the table exists, the signing key is present without exposing it, and newly correlated threat rows can enable Device Block. Historical rows are explicitly excluded from this acceptance check.

## Documentation synchronization

The implementation changes schema, environment/deployment behavior, and frontend behavior. Update the relevant database, security, backend API, and frontend route-map wiki synthesis pages; append `system-wiki/log.md`; update the gap register only if the pre-existing bootstrap-versus-upgrade contract gap is formally recorded or closed.
