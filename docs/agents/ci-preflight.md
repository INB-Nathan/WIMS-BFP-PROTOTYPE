# CI Pre-flight Routine

Run this routine in full before every push or PR on this repo.
All four CI gates are blocking (`merge-gate` fails if any one fails).

---

## Gate 1 — Backend ruff lint

```bash
cd src/backend
ruff check .
```

**If it fails:** ruff prints `file.py:line:col: Exxxx message`. Fix each one.
Common issues:

| Code | Meaning | Fix |
|------|---------|-----|
| `F401` | Unused import | Remove the import or add `# noqa: F401` only if re-exported intentionally |
| `F821` | Undefined name | Check spelling; add missing import |
| `E711` | `== None` instead of `is None` | Change to `is None` / `is not None` |
| `W291/W293` | Trailing whitespace | Delete trailing spaces |
| `E302/E303` | Wrong blank-line count | Two blank lines before top-level defs |

After fixing, re-run `ruff check .` until it exits 0.

---

## Gate 2 — Backend ruff format

```bash
cd src/backend
ruff format --check .
```

**If it fails:** run the formatter to auto-fix, then review the diff:

```bash
ruff format .
git diff
```

`ruff format` enforces: double quotes, 4-space indent, trailing commas in multi-line
collections, blank lines around class bodies. It does NOT sort imports — that is
handled by `ruff check` (rule `I`). The project does NOT enable `I` rules, so import
order is not enforced; do not add isort or reorder imports unnecessarily.

After formatting, re-run `ruff format --check .` until it exits 0.

---

## Gate 3 — Backend pytest

CI command (mirrors `ci.yml` exactly):

```bash
cd src/backend
pytest -v --tb=short \
  --ignore=tests/test_rate_limiting.py \
  --ignore=tests/test_suricata_ingestion.py \
  --ignore=tests/test_infra_config.py \
  --ignore=tests/integration/test_wims_initial_schema_bootstrap.py \
  --ignore=tests/integration/test_auth_otp_policy.py \
  --ignore=tests/integration/test_database_schema.py \
  --ignore=tests/integration/test_rls_policy_enforcement.py \
  --ignore=tests/integration/test_sql_quality_audit.py
```

The `addopts` in `pytest.ini` already include the same `--ignore` list, so
`pytest -v` locally is equivalent. Use the explicit form above to exactly match CI.

**Required environment variables** (CI injects these; set locally for integration tests):

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/wims_test"
export REDIS_URL="redis://localhost:6379/0"
export KEYCLOAK_REALM_URL="http://localhost:8080/auth/realms/bfp"
export KEYCLOAK_CLIENT_ID="bfp-client"
export KEYCLOAK_AUDIENCE="account"
export WIMS_MASTER_KEY="<32-byte hex key>"
```

### Common test failure patterns

**UUID passed where string expected**
Symptom: `AttributeError: 'UUID' object has no attribute 'replace'`
Fix: In fixture dependency overrides, always `str()` UUID values:
```python
async def _async_override():
    return {"user_id": str(user_id), "keycloak_id": str(keycloak_id)}
```

**RLS context not set after commit**
Symptom: queries return 0 rows after a `db.commit()` mid-handler.
Cause: `SET LOCAL wims.current_user_id` resets when the transaction commits.
Fix: call `set_rls_context(db, user_id)` again after every `db.commit()` in the
same handler (see `incidents.py` and `regional.py` for the pattern).

**Fixture using wrong session factory**
Symptom: INSERT in fixture succeeds but the row is invisible to the handler.
Cause: test seeding used `_SessionLocal` (app URL, RLS-gated) instead of
`_AdminSessionLocal` (admin URL, bypasses RLS).
Fix: seed test data through `_AdminSessionLocal` from `database.py`.

**Import errors on collection**
Symptom: `ModuleNotFoundError: No module named 'auth'`
Cause: running pytest outside `src/backend/` — `pythonpath = .` in `pytest.ini`
resolves relative to that directory.
Fix: always run pytest from `src/backend/`.

---

## Gate 4 — Frontend

```bash
cd src/frontend
npm run lint          # ESLint — must exit 0 (warnings OK, errors block)
npx vitest run        # all tests must pass
npm run build         # production build must succeed
```

Build requires these env vars (CI sets them; safe dummy values work locally):

```bash
export NEXT_PUBLIC_AUTH_API_URL="http://localhost:8080/auth/realms/bfp"
export NEXT_PUBLIC_MAPBOX_TOKEN=""
export NEXT_PUBLIC_BASE_URL="http://localhost"
```

---

## Gate 5 — SQL migrations (optional locally, always runs in CI)

CI applies every `.sql` file in `src/postgres-init/` in strict lexical order
with `ON_ERROR_STOP=1`. If you added or edited a migration file:

```bash
# spin up a throw-away postgres and replay all migrations
export PGPASSWORD=postgres
for f in $(ls src/postgres-init/*.sql | LC_ALL=C sort); do
  echo "Applying $f"
  psql -v ON_ERROR_STOP=1 -h localhost -p 5432 -U postgres -d wims_test -f "$f"
done
```

Common SQL failures: duplicate object names (add `IF NOT EXISTS` / `OR REPLACE`),
missing schema prefix (`wims.` before table names), `CREATE POLICY` on a table
that does not yet have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.

---

## Recommended pre-push sequence

```bash
# 1. Fix lint
cd src/backend && ruff check . && ruff format --check .
# If format check fails:
#   ruff format . && git add -u && git diff --staged

# 2. Run tests
cd src/backend && pytest -v --tb=short

# 3. Frontend
cd src/frontend && npm run lint && npx vitest run && npm run build

# 4. Commit only if all three pass
git status
git add <specific files>
git commit -m "..."
git push
```

Never skip ruff format — it is the single most common CI blocker on this repo.
Run `ruff format .` (auto-fix) rather than hand-fixing whitespace.
