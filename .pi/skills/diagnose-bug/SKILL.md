---
name: diagnose-bug
description: "Diagnose and fix hard bugs in the WIMS-BFP codebase. Structured 6-phase investigation: feedback loop, reproduce, hypothesise, instrument, fix with regression test, post-mortem. Use when something is broken, throwing, failing, slow, or when the user says 'diagnose' or 'debug'."
---

# Diagnose Bug — WIMS Edition

A disciplined 6-phase investigation loop for hard bugs. **Skip phases only when explicitly justified.**

Before touching anything, read the relevant:
- **Bug patterns** — `docs/agents/gotchas.md` (16 real WIMS agent mistakes)
- **Architecture constraints** — `AGENTS.md` lines 40–49
- **Subsystem context** — `system-wiki/operations/agent-routing-guide.md` (minimum context pack)

---

## Phase 1 — Build a feedback loop

**This is the whole skill.** Everything else consumes its output. If you have a tight pass/fail signal that goes red on *this* bug, you will find the cause. If you don't, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Ways to construct one — try in this order

1. **Failing test** at whatever seam reaches the bug — unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server. Use `docker compose ps` to confirm the service is up first.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Database query** — connect to postgres and run the exact SQL the handler uses. Check if the GUC is set: `SHOW wims.current_user_id;`.
5. **Bisection harness.** If the bug appeared between two commits, automate `git bisect run` with a shell script that boots the stack, runs one assertion, and exits 0 (pass) or 1 (fail).
6. **Headless browser** — Playwright script that drives the UI, asserts on DOM/console/network.
7. **Property loop** — if the bug is "sometimes wrong output", run 100 random inputs and look for the failure mode.
8. **Differential loop** — run the same input through old vs new code (or two configs) and diff outputs.
9. **HITL bash script** — last resort. If a human must click, drive them with a structured script so the loop is still systematic. See `references/hitl-loop.sh`.

### Tighten the loop

Once you have *a* loop, make it faster, sharper, more deterministic:

- Can I make it faster? Cache setup, skip unrelated init, narrow the test scope.
- Can I make the signal sharper? Assert on the specific symptom, not "didn't crash".
- Can I make it more deterministic? Pin time, seed RNG, isolate filesystem, freeze network.

A 30-second flaky loop is barely better than no loop. A 2-second deterministic one is a debugging superpower.

### Non-deterministic bugs

Goal is not a clean repro but a **higher reproduction rate**. Loop 100×, parallelise, add stress, narrow timing windows. A 50%-flake bug is debuggable; 1% is not — keep raising the rate.

### WIMS-specific loop starters

| Bug symptom | Quick loop |
|---|---|
| RLS returning 0 rows | Run the SQL directly: `SET LOCAL wims.current_user_id = '<uuid>'; SELECT * FROM wims.fire_incidents;`. Then commit and re-run. |
| PII decryption failure | `python -c "from utils.crypto import decrypt_data; print(decrypt_data('<ciphertext>', '<key>'))"` |
| Rate limit too aggressive | `for i in 1..10; do curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost/api/...; done` |
| Test fixture returns 0 rows | Check which session factory: `_SessionLocal` (RLS-gated) vs `_AdminSessionLocal` (bypasses RLS) |
| Frontend build fails | Check `NEXT_PUBLIC_AUTH_API_URL` and `NEXT_PUBLIC_BASE_URL` are set |
| AFOR import fails | `curl -X POST http://localhost/api/regional/afor/import -F "file=@test_fixture.xlsx"` |

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a captured artifact (HAR file, log dump, core dump), or (c) permission to add temporary production instrumentation.

**Do not proceed to hypothesise without a loop.**

### Completion criterion

Phase 1 is done when you have **one command** you have already run at least once that is:

- [ ] **Red-capable** — drives the bug code path and asserts the user's exact symptom
- [ ] **Deterministic** — same verdict every run (flaky: high reproduction rate)
- [ ] **Fast** — seconds, not minutes
- [ ] **Agent-runnable** — you can run it unattended

If you catch yourself reading code to build a theory before this command exists, **stop.** No red-capable command, no Phase 2.

---

## Phase 2 — Reproduce + minimise

Run the loop. Watch it go red.

### Confirm
- [ ] The failure matches what the **user** described — not a different failure nearby
- [ ] The failure is reproducible across multiple runs
- [ ] You have captured the exact symptom (error message, wrong output, stack trace)

### Minimise

Shrink the repro to the **smallest scenario that still goes red**. Cut inputs, callers, config, data, and steps one at a time, re-running after each cut. Keep only what's load-bearing.

Done when **every remaining element is load-bearing** — removing any one makes it go green.

---

## Phase 3 — Hypothesise

Generate **3–5 ranked hypotheses** before testing any. Each must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."

### WIMS-specific hypotheses to consider early

| Pattern | Hypothesis template |
|---|---|
| RLS context | "If `wims.current_user_id` is not set after commit, then adding `set_rls_context(db, user_id)` after the commit will fix it." |
| Session factory | "If the test uses `_SessionLocal` instead of `_AdminSessionLocal`, then seeding will fail because RLS blocks the insert." |
| UUID vs string | "If a UUID is passed where a string is expected, then `str(uuid_value)` in the fixture will fix it." |
| PII key mismatch | "If `WIMS_MASTER_KEY` differs between environments, then decryption will fail with an auth tag mismatch." |
| Import ordering | "If code is placed between import blocks, then `ruff check .` will catch E402." |
| RLS policy gap | "If a new table lacks `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, then admin queries will still show all rows." |
| Keycloak role path | "If the token carries `resource_access.bfp-client.roles` but `auth.py` only checks `realm_access.roles`, then the role lookup fails silently." |

**Show the ranked list to the user before testing.** They often have domain knowledge that re-ranks instantly ("we just deployed a change to #3"). Proceed with your ranking if the user is AFK.

---

## Phase 4 — Instrument

Each probe maps to a specific prediction from Phase 3. **Change one variable at a time.**

### Tool preference
1. **Debugger / REPL** — one breakpoint beats ten logs
2. **Targeted logs** at the boundaries that distinguish hypotheses
3. Never "log everything and grep"

**Tag every debug log** with a unique prefix: `logger.info("[DEBUG-a4f2] RLS context value: %s", user_id)`. Cleanup becomes a single `grep \[DEBUG-`. Untagged logs survive; tagged logs die.

### WIMS-specific instrumentation commands

| Probe | Command |
|---|---|
| Check RLS context | `psql -c "SHOW wims.current_user_id;"` |
| Check session factory | `rg "SessionLocal\|AdminSessionLocal" tests/test_file.py` |
| Check PII key | `python -c "from utils.crypto import get_master_key; print(get_master_key()[:8])"` (prints first 8 chars, enough to confirm correct key) |
| Check audit trigger | `psql -c "SELECT tgname FROM pg_trigger WHERE tgrelid = 'wims.audit_log'::regclass;"` |
| Check import order | `cd src/backend && ruff check . | head -20` |
| Check route order | Check `get_current_wims_user` comes before `get_db_with_rls` in route signature |

### Performance branch

For performance regressions: establish a baseline measurement first (timing harness, profiler, query plan), then bisect. Measure first, fix second.

---

## Phase 5 — Fix + regression test

### Check for a correct seam

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow, a regression test there gives false confidence.

**If no correct seam exists, that itself is the finding.** Flag it for Phase 6.

### If a correct seam exists

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

### WIMS-specific fix constraints

Before committing the fix, verify these if the change touches them:

- [ ] RLS context re-set after every `db.commit()` in the handler
- [ ] PII columns: plaintext field is NULL, encrypted field is populated
- [ ] Audit trigger still fires — check `wims.audit_log` has the new entry
- [ ] Route order: `get_current_wims_user` before `get_db_with_rls`
- [ ] No `print()` or `[DEBUG-...]` logging survived

---

## Phase 6 — Cleanup + post-mortem

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes (or absence of seam is documented)
- [ ] All `[DEBUG-...]` instrumentation removed — `rg "\[DEBUG-"` across touched files
- [ ] Throwaway prototypes deleted
- [ ] The correct hypothesis is stated in the commit / PR message

### Then ask: what would have prevented this bug?

- If the answer is a missing test seam → surface as architecture improvement candidate
- If the answer is a missing gotcha → consider adding it to `docs/agents/gotchas.md`
- If the answer is an RLS/PII/audit gap that isn't caught → file an issue with `ready-for-agent`

Route the recommendation: `/grill-with-docs` on the pain point → create issue → `/issue-implement`.

---

## WIMS Bug Pattern Reference

These appear frequently. Check them early — they save hours.

| # | Pattern | Symptom | Quick check |
|---|---------|---------|-------------|
| 1 | **RLS context lost after commit** | Handler inserts/updates succeed but the next query returns 0 rows | `SHOW wims.current_user_id;` after commit |
| 2 | **Wrong session factory** | Fixture data invisible to the handler | Check `_SessionLocal` vs `_AdminSessionLocal` in test |
| 3 | **UUID passed where string expected** | `AttributeError: 'UUID' object has no attribute 'replace'` | `str(uuid_value)` in fixture overrides |
| 4 | **PII key mismatch** | Decryption returns garbage or auth tag error | Cross-check `WIMS_MASTER_KEY` across envs |
| 5 | **Import ordering (E402)** | `ruff check .` fails on code between import blocks | Move all code below imports |
| 6 | **Missing RLS on new table** | Admin queries show all rows, app queries show none | `ALTER TABLE wims.x ENABLE ROW LEVEL SECURITY;` |
| 7 | **Route dependency order** | Route fails with "no wims_user in request.state" | `get_current_wims_user` before `get_db_with_rls` |
| 8 | **Keycloak role path** | Role-based access unexpectedly denied | Check `realm_access.roles` vs `resource_access.<client>.roles` |
| 9 | **Pytest outside src/backend/** | `ModuleNotFoundError: No module named 'auth'` | Run from `src/backend/` |
| 10 | **Frontend build env vars** | Build fails with missing `NEXT_PUBLIC_*` | `export NEXT_PUBLIC_AUTH_API_URL=... NEXT_PUBLIC_BASE_URL=...` |
