# Idempotent Validator Verification — Implementation Handoff

## Summary

Issue [#267](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/267) adds idempotency to three validator routes (`verify_incident`, `archive_incident`, `unarchive_incident`) by accepting an optional `client_id` (UUID string), checking the `wims.incident_verification_history` table for an existing record with that `client_id`, and returning `{"status": "already_applied"}` (200) on duplicate detection instead of re-processing the verification.

Includes a new database migration (`56_add_client_id_to_verification_history.sql`) that adds a `client_id UUID` column and a partial unique index `uq_incident_verification_history_client_id WHERE client_id IS NOT NULL`.

## Changed Files

### New files

- **`src/postgres-init/56_add_client_id_to_verification_history.sql`**
  Migration adding `client_id UUID` column to `wims.incident_verification_history` with partial unique index. Idempotent (`IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS`).

- **`src/backend/tests/test_validator_idempotency.py`**
  Five focused reproduction tests covering verification idempotency via body `client_id`, archive/unarchive idempotency via body `client_id`, backward compatibility without `client_id`, and distinct `client_id` isolation.

### Modified files

| File | Change |
|---|---|
| `src/backend/schemas/regional.py` | Added `client_id: str \| None = None` to `VerificationActionRequest` |
| `src/backend/services/regional_incidents/helpers.py` | Added `client_id` parameter to `insert_incident_verification_history()`, guarded by `_ivh_has_column(db, "client_id")`, across all 5 INSERT branches (3 modern `target_type`-based + 2 legacy `incident_id`-based) |
| `src/backend/services/regional_incidents/lifecycle.py` | Threaded `client_id` through `verify_incident_command()`, `archive_finalized_incident()`, `unarchive_finalized_incident()` |
| `src/backend/api/routes/regional/__init__.py` | Added `_ivh_has_client_id_column(db)` helper using module-level column existence cache pattern |
| `src/backend/api/routes/regional/validator.py` | Added idempotency checks on all three routes — all accept body `client_id`; archive/unarchive retain query-param compatibility |
| `system-wiki/backend/api-route-map.md` | Updated route descriptions with `client_id` idempotency annotations |
| `system-wiki/log.md` | Appended `#267` entry |

### No changes

- `bulk_approve_pending_incidents` (not in scope for #267)
- Frontend (no changes required)
- ORM model (migration-only column, handled via runtime column checks)

## Implemented Routes

| Route | Method | Pattern | Idempotency Source |
|---|---|---|---|
| `/incidents/{id}/verification` | `PATCH` | Body `client_id` in `VerificationActionRequest` | Checks IVH globally for `client_id = :cid` |
| `/validator/incidents/{id}/archive` | `PATCH` | Body `client_id`; query param retained for compatibility | Same IVH check |
| `/validator/incidents/{id}/unarchive` | `PATCH` | Body `client_id`; query param retained for compatibility | Same IVH check |

## Tests and Commands

### Test file: `src/backend/tests/test_validator_idempotency.py`

| Test | What it verifies |
|---|---|
| `test_267_duplicate_client_id_returns_already_applied` | Second `verify_incident` with same `client_id` returns 200 `{"status": "already_applied"}` instead of 409 |
| `test_267_archive_with_duplicate_client_id` | Second `archive_incident` with same `client_id` returns `already_applied` |
| `test_267_unarchive_with_duplicate_client_id` | Second `unarchive_incident` with same `client_id` returns `already_applied` |
| `test_267_verification_without_client_id_still_works` | Omitting `client_id` (None) works normally — backward compatible |
| `test_267_different_client_ids_produce_distinct_ivh_rows` | Different `client_id` values on same incident produce separate IVH rows |
| Existing lifecycle tests | All unchanged lifecycle tests still pass |

### Validation commands

```bash
cd src/backend && \
  DATABASE_ADMIN_URL="postgresql://postgres:password@localhost:5432/wims" \
  DATABASE_URL="postgresql://wims_app_user:wimsapp@localhost:5432/wims" \
  REDIS_URL="redis://localhost:6379/0" \
  python3 -m pytest tests/test_validator_idempotency.py -v --tb=short

cd src/backend && \
  DATABASE_ADMIN_URL="postgresql://postgres:password@localhost:5432/wims" \
  DATABASE_URL="postgresql://wims_app_user:wimsapp@localhost:5432/wims" \
  REDIS_URL="redis://localhost:6379/0" \
  python3 -m pytest tests/test_regional_incident_lifecycle.py -v --tb=short

cd src/backend && ruff check .
cd src/backend && ruff format --check .
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git diff --check
```

### Pre-existing failure (unrelated)

`test_commit_structural_persists_wgs84_coordinates` fails due to missing `crypto_provider` column in the test database — this is a pre-existing schema mismatch, not related to #267.

## Mechanical Gates

| Gate | Result |
|---|---|
| `ruff check .` | ✅ All checks passed |
| `ruff format --check .` | ✅ 177 files already formatted |
| `git diff --check` | ✅ No whitespace errors |
| Idempotency tests (5) | ✅ 5/5 passed |
| Lifecycle tests (2) | ✅ 2/2 passed |
| Debug artifacts (`print`, `console.log`, `debugger`) | ✅ None found |
| Merge conflict markers | ✅ None found |
| TODO/FIXME/HACK in new/changed code | ✅ None found |
| Commented-out code blocks | ✅ None found |
| Trailing whitespace | ✅ None found |
| File permissions | ✅ All 644 |
| Binary files accidentally included | ✅ None found |

**Verdict: ✅ Clean — all mechanical checks pass**

## Residual Risks and Open Questions

1. **RLS safety confirmed** — The `archive_incident` route's idempotency check queries IVH using `target_type/target_id` columns (not the legacy `incident_id` column used by the RLS policy join). The `NATIONAL_VALIDATOR` role passes RLS unconditionally via the role-based OR clause, so this is safe.

2. **`bulk_approve_pending_incidents` out of scope** — This function also inserts IVH rows but is explicitly excluded from #267. It now lacks `client_id` support, meaning any future bulk-approve offline retry could produce duplicate submissions. A follow-up issue should extend `client_id` to the bulk-approve path.

3. **Pre-existing integration test failure** — `test_commit_structural_persists_wgs84_coordinates` fails due to a missing `crypto_provider` column in the test DB. This is unrelated but may block CI merge gates if the CI runs that test suite. The test database likely needs migration 55+ applied.

## Commit Hash

`5521c95` — `feat(#267): idempotent validator verification via client_id`

## Wiki Update Confirmation

Wiki updates were completed as part of the implementation:

- **`system-wiki/backend/api-route-map.md`** — Updated route descriptions for `verify_incident`, `archive_incident`, and `unarchive_incident` with `client_id` idempotency annotations and bumped `updated:` date.
- **`system-wiki/log.md`** — Appended entry for `[2026-06-12] feat | GH #267 idempotent validator verification`.

No `system-wiki/gaps/frs-codebase-gap-register.md` update was needed because this change implements existing FRS verification behavior without creating or closing a documented FRS/codebase gap.

## Recommended Next Step

Review the diff, ensure the database migration has been applied to the test environment, then push the branch / open a PR.
