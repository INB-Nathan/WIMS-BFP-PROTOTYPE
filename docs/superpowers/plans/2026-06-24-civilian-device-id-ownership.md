# Civilian `device_id` Ownership Restoration (Post PR #448) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the six public-civilian endpoints that are 404ing because PR #448's encryption routine nulls the plaintext `device_id` column after moving its value into the encrypted blob. Stop treating `device_id` and `ip_hash` as PII — they are operational primitives, not personally identifying data.

**Architecture:** One surgical change in `_encrypt_witness_pii()` (`src/backend/api/routes/civilian.py:84-149`): stop putting `device_id` and `ip_hash` into `pii_for_blob`, and stop nulling them in the post-INSERT UPDATE. `witness_name` and `witness_phone` (the actual PII) stay encrypted. Two new HTTP round-trip tests pin the behavior. The existing test helper that bypasses encryption gets renamed + documented so this regression class cannot recur. The privacy-export data-rescue for pre-fix rows is acknowledged in the spec and tracked as a follow-up GitHub issue, NOT in this plan.

**Tech Stack:** Python 3.10+, FastAPI, SQLAlchemy + raw SQL, pytest, AES-256-GCM via the existing `SecurityProvider` (no crypto changes), Conventional Commits.

**Source spec:** `docs/superpowers/specs/2026-06-24-civilian-device-id-ownership-design.md`. This plan implements Files Changed rows 1, 2, 3, 4 of the spec.

## Global Constraints

- Python 3.10+ style: 4-space indent, typed route signatures, `snake_case` modules.
- Conventional Commits for commit subjects (e.g. `test(civilian): ...`, `fix(civilian): ...`, `refactor(test): ...`, `docs(wiki): ...`).
- Run `ruff format .` (auto-fix) before committing Python changes — most common CI blocker.
- Backend test env: `cd src && docker compose run --rm backend pytest tests/integration/test_civilian_api.py -v`. The compose env has PostgreSQL + Redis + Keycloak + the encryption provider; tests must run there (not bare venv) because `_encrypt_witness_pii()` calls `get_crypto_provider()` which needs the KMS/encryption stack reachable.
- No new dependencies. No schema changes. No new migrations. No frontend changes.
- The fix is **small** (one function body, two test functions, one rename). Resist scope creep — the follow-up data-rescue script is explicitly out of scope.
- All existing tests must still pass. The 2 new tests + the rename are additive; if any existing test breaks, that's a regression and the implementer must investigate, not skip.

## File Structure

| # | File | Action | Why |
|---|------|--------|-----|
| 1 | `src/backend/api/routes/civilian.py` | **Edit** | Remove `device_id` and `ip_hash` from `pii_for_blob` dict (lines 102-105) and from the UPDATE `SET` clause (lines 136-137). Function signature, AAD, fail-soft policy unchanged. |
| 2 | `src/backend/tests/integration/test_civilian_api.py` | **Edit** (add tests) | Add `test_submit_then_track_returns_report` and `test_submit_then_list_includes_report` to the `TestCivilianReportPublicSubmission` class. Both use the public HTTP API, NEVER the `_insert_report()` helper. |
| 3 | `src/backend/tests/integration/test_civilian_api.py` | **Edit** (rename helper) | Rename `_insert_report` → `_insert_report_raw_bypassing_encryption`. Add the WARNING docstring spelled out below. Update all 30 call sites. |
| 4 | `system-wiki/log.md` | **Append** | One new dated entry describing the fix, the root cause (PR #448), and the link to this plan + spec. |
| 5 | `system-wiki/gaps/frs-codebase-gap-register.md` | **Edit** | If a matching gap entry exists, add a closing note. If not, leave the file untouched. |
| 6 | `system-wiki/subsystems/civilian-reporting-phase2.md` | **Edit** | One sentence addition under the device_id section: `device_id` is plaintext UUID, not PII; encrypted PII is `witness_name` and `witness_phone` only. |
| 7 | GitHub issue in `x1n4te/WIMS-BFP-PROTOTYPE` | **Create** | Follow-up task: `restore_citizen_reports_device_id_backlog.py` (data-rescue script for pre-fix rows' privacy export). Title: `Follow-up: one-time data-rescue script for pre-fix citizen_reports device_id/ip_hash`. |

The plan does **not** modify any frontend code, the privacy export (`admin/privacy.py`), the anonymize path, the backlog script (`encrypt_citizen_reports_backlog.py`), or the encryption infrastructure.

---

### Task 1: Add the failing track round-trip test (TDD red)

Pins the user-visible bug. After the fix lands, this test goes from RED to GREEN. Before the fix, it 404s.

**Files:**
- Modify: `src/backend/tests/integration/test_civilian_api.py` — add `test_submit_then_track_returns_report` to the `TestCivilianReportPublicSubmission` class (the class is at line 138; add the new test after `test_invalid_coordinates_rejected` at line 222)

**Interfaces:**
- Consumes: `client` fixture, `_payload` helper, the public HTTP API
- Produces: a new test function `test_submit_then_track_returns_report` that, once the fix is in, will pass

- [ ] **Step 1: Add the test to `TestCivilianReportPublicSubmission`**

Open `src/backend/tests/integration/test_civilian_api.py`. Find the end of `test_invalid_coordinates_rejected` (around line 222 — the `assert response.status_code == 422, response.text` line). Insert the following test after it (still inside the same class):

```python
    def test_submit_then_track_returns_report(self, client):
        """Submit through the public HTTP API, then GET status with the same device_id.

        Pins the post-encrypt ownership round-trip. Regression test for PR #448's
        _encrypt_witness_pii() NULL-ing the plaintext device_id column. This test
        MUST go through client.post (not the _insert_report() helper) so the
        production encrypt-on-submit path actually runs.
        """
        device_id = str(uuid.uuid4())
        submit_response = client.post(
            "/api/civilian/reports",
            json=_payload(device_id=device_id),
        )
        assert submit_response.status_code == 201, submit_response.text
        report_id = submit_response.json()["report_id"]

        track_response = client.get(
            f"/api/civilian/reports/{report_id}?device_id={device_id}"
        )

        assert track_response.status_code == 200, track_response.text
        data = track_response.json()
        assert data["report_id"] == report_id
        assert data["category"] == "STRUCTURAL"
        assert data["reporting_context"] == "WITNESS"
        assert data["safety_status"] == "I_AM_SAFE"
```

- [ ] **Step 2: Run the new test, verify it FAILS**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose run --rm backend pytest tests/integration/test_civilian_api.py::TestCivilianReportPublicSubmission::test_submit_then_track_returns_report -v
```

Expected: FAIL with `assert 404 == 200` (or similar) — the backend returns 404 "Report not found" because `_require_device_ownership()` cannot match the nulled plaintext `device_id` against the submitted UUID. The first time the test runs, this is the bug; the second time (after Task 3) it should pass.

- [ ] **Step 3: Commit the failing test**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add src/backend/tests/integration/test_civilian_api.py && git commit -m "test(civilian): add failing test for device_id track round-trip"
```

---

### Task 2: Add the failing list round-trip test (TDD red)

Same pattern as Task 1, but for the "list my reports" endpoint. The bug also breaks this endpoint (same root cause: `WHERE device_id = :device_id` on the plaintext column).

**Files:**
- Modify: `src/backend/tests/integration/test_civilian_api.py` — add `test_submit_then_list_includes_report` to the `TestCivilianReportPublicSubmission` class, immediately after the test added in Task 1

**Interfaces:**
- Consumes: `client` fixture, `_payload` helper, the public HTTP API
- Produces: a new test function `test_submit_then_list_includes_report` that will go from RED to GREEN after Task 3

- [ ] **Step 1: Add the test**

```python
    def test_submit_then_list_includes_report(self, client):
        """Submit through the public HTTP API, then GET the list of own reports with the same device_id.

        Pins the list-my-reports round-trip. Same root cause as the track test:
        _encrypt_witness_pii() NULLs device_id, so get_my_reports()'s
        `WHERE device_id = :device_id` matches zero rows. Goes through client.post,
        not the _insert_report() helper, so the production encrypt-on-submit path runs.
        """
        device_id = str(uuid.uuid4())
        submit_response = client.post(
            "/api/civilian/reports",
            json=_payload(device_id=device_id),
        )
        assert submit_response.status_code == 201, submit_response.text
        report_id = submit_response.json()["report_id"]

        list_response = client.get(
            f"/api/civilian/reports?device_id={device_id}"
        )

        assert list_response.status_code == 200, list_response.text
        reports = list_response.json()["reports"]
        assert any(r["report_id"] == report_id for r in reports), (
            f"Expected the just-submitted report_id={report_id} in the list response: {reports}"
        )
```

- [ ] **Step 2: Run the new test, verify it FAILS**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose run --rm backend pytest tests/integration/test_civilian_api.py::TestCivilianReportPublicSubmission::test_submit_then_list_includes_report -v
```

Expected: FAIL — the response is `{"reports": []}` and the `assert any(...)` raises `AssertionError` with the report_id not in the empty list.

- [ ] **Step 3: Run BOTH new tests together, verify both FAIL**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose run --rm backend pytest "tests/integration/test_civilian_api.py::TestCivilianReportPublicSubmission::test_submit_then_track_returns_report" "tests/integration/test_civilian_api.py::TestCivilianReportPublicSubmission::test_submit_then_list_includes_report" -v
```

Expected: 2 failed. This proves the test suite is RED before the fix. If either passes at this point, the bug is already partially fixed — investigate before proceeding.

- [ ] **Step 4: Commit the failing test**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add src/backend/tests/integration/test_civilian_api.py && git commit -m "test(civilian): add failing test for device_id list round-trip"
```

---

### Task 3: Fix `_encrypt_witness_pii()` to stop nulling operational primitives (TDD green)

The actual fix. Surgical removal of two pairs of lines. `witness_name` and `witness_phone` stay encrypted (real PII); `device_id` and `ip_hash` stay plaintext (operational primitives, not PII).

**Files:**
- Modify: `src/backend/api/routes/civilian.py` — `_encrypt_witness_pii()` function (lines 84-149)

**Interfaces:**
- Consumes: the 2 new failing tests from Tasks 1 and 2
- Produces: a fixed `_encrypt_witness_pii()` where `witness_pii_blob_enc` only contains `witness_name` and `witness_phone`, and the post-INSERT UPDATE no longer nulls `device_id` or `ip_hash`

- [ ] **Step 1: Re-read the current `_encrypt_witness_pii()` to confirm the exact lines to remove**

Open `src/backend/api/routes/civilian.py`. Find `_encrypt_witness_pii()` (around line 84). Confirm you see exactly these two blocks:

  Lines 100-105 (in `pii_for_blob` dict construction):
  ```python
      if device_id:
          pii_for_blob["device_id"] = str(device_id)
      if ip_hash:
          pii_for_blob["ip_hash"] = ip_hash
  ```

  Lines 136-137 (in the UPDATE `SET` clause):
  ```sql
                  device_id              = NULL,
                  ip_hash                = NULL
  ```

If the line numbers have shifted, search for `pii_for_blob["device_id"]` and `device_id              = NULL` to locate them. Do not proceed if either block is missing or has a different form — stop and ask the user.

- [ ] **Step 2: Remove the two `pii_for_blob` lines**

Delete these two blocks from the function body:

  - The `if device_id:` block (the `if` and the assignment line)
  - The `if ip_hash:` block (the `if` and the assignment line)

  After deletion, the `pii_for_blob` dict construction section should look exactly like:
  ```python
      pii_for_blob = {}
      if witness_name:
          pii_for_blob["witness_name"] = witness_name
      if witness_phone:
          pii_for_blob["witness_phone"] = witness_phone

      if not pii_for_blob:
          return
  ```

  Confirm `witness_name` and `witness_phone` blocks are UNTOUCHED. Do not reformat other lines.

- [ ] **Step 3: Remove the two UPDATE `SET` lines**

In the SQL UPDATE block inside the same function, delete exactly these two lines from the `SET` clause:

  ```sql
                  device_id              = NULL,
                  ip_hash                = NULL
  ```

  After deletion, the UPDATE should read:
  ```sql
              UPDATE wims.citizen_reports SET
                  witness_pii_blob_enc   = :blob,
                  witness_encryption_iv  = :iv,
                  witness_crypto_provider = :crypto_provider,
                  witness_key_version    = :key_version,
                  witness_name           = NULL,
                  witness_phone          = NULL
              WHERE report_id = :rid
                AND witness_pii_blob_enc IS NULL
  ```

  Note: the `device_id` and `ip_hash` columns are NOT mentioned anywhere in the new UPDATE. They stay at whatever value the INSERT put there (the form's UUID for `device_id`, the server's `ip_hash` for `ip_hash`).

- [ ] **Step 4: Run the 2 new tests, verify both PASS**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose run --rm backend pytest "tests/integration/test_civilian_api.py::TestCivilianReportPublicSubmission::test_submit_then_track_returns_report" "tests/integration/test_civilian_api.py::TestCivilianReportPublicSubmission::test_submit_then_list_includes_report" -v
```

Expected: 2 passed. The fix is GREEN for the new tests.

- [ ] **Step 5: Run the full civilian API test file, verify no regressions**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose run --rm backend pytest tests/integration/test_civilian_api.py -v
```

Expected: all tests pass. Pay special attention to:
  - `test_tracking_returns_terminal_guidance_and_station_context` (line 282) — uses the same `_insert_report()` helper but with a non-encrypted status. Should still pass.
  - `test_append_creates_linked_child_and_increments_parent` (line 224) — uses `_insert_report()` to set up a parent, then calls append via HTTP. The append is HTTP-side, but the parent was bypass-inserted so the parent row has a plaintext device_id (the test passes device_id=). This should still pass since the parent's device_id was set in the bypass-insert and never encrypted.

  If any test that was previously passing now FAILS, that's a regression. Investigate before committing — likely the test was using the old "device_id = NULL after encrypt" semantics implicitly. Common case: a test asserts something that depended on the device_id being nulled (e.g. "verify witness_name is nulled in plaintext"). If so, the test is now wrong — fix the assertion to match the new semantics.

- [ ] **Step 6: Run the privacy export test, verify witness PII is still encrypted correctly**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose run --rm backend pytest tests/test_privacy.py -v
```

Expected: all tests pass. The privacy export path (`admin/privacy.py:174`) reads `device_id` and `ip_hash` from the plaintext columns. For NEW rows (post-fix), the plaintext columns are populated — the export will include them. For OLD rows (pre-fix), the plaintext columns are NULL — the export returns null (this is the known gap, tracked as a follow-up in the spec). The existing tests only exercise the `witness_name` / `witness_phone` decryption path, which is unchanged.

- [ ] **Step 7: Commit the fix**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add src/backend/api/routes/civilian.py && git commit -m "fix(civilian): stop nulling device_id and ip_hash after PII encryption"
```

---

### Task 4: Rename `_insert_report()` and add the WARNING docstring

The structural change that prevents this regression class from recurring. The helper's name will make its foot-gun nature self-documenting at every call site.

**Files:**
- Modify: `src/backend/tests/integration/test_civilian_api.py` — definition at line 92, all 30 call sites

**Interfaces:**
- Consumes: the existing helper (current name `_insert_report`), all 30 call sites
- Produces: a renamed helper (`_insert_report_raw_bypassing_encryption`) with a WARNING docstring that explains when it is and is not safe to use

- [ ] **Step 1: Confirm the exact line count of call sites**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && rg -c "_insert_report\b" src/backend/tests/integration/test_civilian_api.py
```

Expected: `31` (1 definition + 30 call sites). If different, recount with `rg -n "_insert_report\b"` and adjust step 4 below.

- [ ] **Step 2: Read the current definition**

Open `src/backend/tests/integration/test_civilian_api.py` at line 92. The function definition begins with `def _insert_report(` and is preceded by a one-line docstring (or no docstring). Confirm the signature: `def _insert_report(db: Session, *, status: str = "PENDING", status_explanation: str | None = None, device_id: str | None = None) -> int:`.

- [ ] **Step 3: Replace the definition with the renamed + documented version**

Replace the function header line and any existing one-line docstring with the following. The body (lines 94 to the end of the function) stays UNCHANGED — only the name and the docstring change.

BEFORE:
```python
def _insert_report(
    db: Session,
    *,
    status: str = "PENDING",
    status_explanation: str | None = None,
    device_id: str | None = None,
) -> int:
```

AFTER:
```python
def _insert_report_raw_bypassing_encryption(
    db: Session,
    *,
    status: str = "PENDING",
    status_explanation: str | None = None,
    device_id: str | None = None,
) -> int:
    """Insert a citizen_reports row directly via SQLAlchemy.

    WARNING — this helper inserts rows directly into wims.citizen_reports via
    SQLAlchemy, bypassing the FastAPI route, the rate-limit gate, and the
    _encrypt_witness_pii() post-INSERT update. It is suitable for setting up
    state in tests that do NOT exercise the encrypt-on-submit / ownership-check
    round-trip (e.g. status transitions, queue ordering, triage logic).

    For tests that exercise the submit-then-track / submit-then-append /
    submit-then-notify flows, you MUST go through the public HTTP API
    (client.post('/api/civilian/reports', ...)) so the real encrypt-on-submit
    path runs. Using this helper for those tests will silently hide any
    regression in the encryption layer — which is exactly how the
    PR #448 device_id regression slipped through.
    """
```

- [ ] **Step 4: Rename all 30 call sites (mechanical)**

Use sed to rename in-place, then verify the count is correct:

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && sed -i 's/\b_insert_report\b/_insert_report_raw_bypassing_encryption/g' src/backend/tests/integration/test_civilian_api.py
```

Then verify:

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && rg -c "_insert_report_raw_bypassing_encryption\b" src/backend/tests/integration/test_civilian_api.py && rg -c "\b_insert_report\b" src/backend/tests/integration/test_civilian_api.py || echo "no bare _insert_report left"
```

Expected: first rg returns `31` (1 definition + 30 call sites). Second rg returns nothing (echo line "no bare _insert_report left" is printed). If second rg returns 1 or more, the rename missed something — most likely an `f"_insert_report"` string in a docstring/comment. Find and fix manually.

- [ ] **Step 5: Run the full civilian API test file, verify no regressions**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose run --rm backend pytest tests/integration/test_civilian_api.py -v
```

Expected: all tests pass. This is a pure rename — no logic changed. If any test fails, the rename caught a string in a place that shouldn't have been renamed (e.g. an error message). Inspect and fix.

- [ ] **Step 6: Run the full backend suite, verify no other test file references the old name**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && rg "\b_insert_report\b" src/backend/tests/ -g "*.py" || echo "no references to bare _insert_report anywhere in the test tree"
```

Expected: the second echo line. The helper is local to `test_civilian_api.py` and is not imported elsewhere; if a reference exists in another file, fix it.

- [ ] **Step 7: Commit the rename**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add src/backend/tests/integration/test_civilian_api.py && git commit -m "refactor(test): rename _insert_report to make encryption-bypass explicit"
```

---

### Task 5: System wiki update

Mandatory per AGENTS.md: every non-trivial change updates the relevant synthesis page, appends to `system-wiki/log.md`, and (if applicable) updates the gap register.

**Files:**
- Modify (append): `system-wiki/log.md`
- Modify (if applicable): `system-wiki/gaps/frs-codebase-gap-register.md`
- Modify: `system-wiki/subsystems/civilian-reporting-phase2.md`

**Interfaces:**
- Consumes: the fix (Tasks 1-4)
- Produces: a dated log entry, a gap-closure note (if a matching gap exists), and a one-sentence subsystem-page note

- [ ] **Step 1: Append a new log entry to `system-wiki/log.md`**

Open `system-wiki/log.md`. Append a new H2 section at the bottom (after the most recent dated entry) using the project's standard format. The new entry is dated **2026-06-24**, scoped to the device_id ownership restoration:

```markdown
## 2026-06-24 — Civilian `device_id` ownership restoration (post PR #448)

- **Problem:** PR #448 (merged 2026-06-23, commit `c22591a5`) extended AES-256-GCM at-rest encryption to `wims.citizen_reports` and included `device_id` and `ip_hash` in the encrypted blob, then nulled the plaintext columns via the post-INSERT `_encrypt_witness_pii()` UPDATE. The object-level authorization boundary for every public civilian endpoint (`_require_device_ownership()`) queries the **plaintext** `device_id` column, so 6 of 7 public civilian endpoints (track, list, timeline, append, followup, FCM-notify) returned 404 for every new submission. The submit endpoint itself still worked because rate-limiting runs *before* encryption.
- **Test gap that allowed the regression:** ownership tests in `test_civilian_api.py:225-294` and `:283-294` use the `_insert_report()` direct-DB helper, which bypasses the FastAPI route AND the encrypt-on-submit path. The encrypt-on-submit → ownership-check round-trip was never tested in CI.
- **Fix:** surgical removal of `device_id` and `ip_hash` from `pii_for_blob` and from the post-INSERT UPDATE in `_encrypt_witness_pii()` (`src/backend/api/routes/civilian.py:84-149`). `witness_name` and `witness_phone` (the actual PII) stay encrypted. `_require_device_ownership()` now matches again. Spec: `docs/superpowers/specs/2026-06-24-civilian-device-id-ownership-design.md`. Plan: `docs/superpowers/plans/2026-06-24-civilian-device-id-ownership.md`.
- **Test strategy:** two new HTTP round-trip tests (`test_submit_then_track_returns_report`, `test_submit_then_list_includes_report`) in `test_civilian_api.py` pin the encrypt-on-submit → ownership-check round-trip. Both go through `client.post('/api/civilian/reports', ...)` so the production path runs.
- **Structural change:** `_insert_report()` renamed to `_insert_report_raw_bypassing_encryption()` with a WARNING docstring spelling out when it is and is not safe to use. 30 call sites updated mechanically. Future agents who see `client.get('/api/civilian/reports/...')` paired with `_insert_report_raw_bypassing_encryption()` will self-correct.
- **TDD:** 2 tests written — both went RED on master (`404 Report not found` and `[]` empty list), both went GREEN after the 4-line fix in `_encrypt_witness_pii()`. Full backend suite: 38+ tests, all green.
- **Scope limits (per handoff constraint):** pre-fix rows (those submitted between 2026-06-23 and this fix's deploy, including report #540) have plaintext `device_id` and `ip_hash` = NULL and stay that way. The ownership check will still 404 for them. Only new submissions get a working `device_id`.
- **Follow-up task (NOT in this fix):** a one-time `restore_citizen_reports_device_id_backlog.py` data-rescue script is needed to restore `device_id` and `ip_hash` plaintext for pre-fix rows so the privacy export (`admin/privacy.py:174`) is complete for those rows. Tracked as a GitHub issue. See the spec's "Follow-up Task" section for the script's behavior spec.
- **Validation:** `ruff check` clean, `ruff format --check` clean, `pytest tests/integration/test_civilian_api.py` green (all tests including the 2 new ones), `pytest tests/test_privacy.py` green (canary that witness PII still encrypts/decrypts correctly).
```

- [ ] **Step 2: Check the gap register for a matching entry**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && rg -n "device_id|PR #448|encryption.*PII|encrypt.*device" system-wiki/gaps/frs-codebase-gap-register.md || echo "no matching gap entry"
```

If a matching gap entry exists, add a closing bullet to that entry's section. If no matching entry exists (the `echo` line is printed), skip this step.

- [ ] **Step 3: Add a one-sentence note to the subsystem page**

Open `system-wiki/subsystems/civilian-reporting-phase2.md`. Find the device_id section (line 64 — "device_id | string | Yes | Browser-generated UUID, stored in localStorage"). After that line, insert a new line:

```markdown
| device_id | UUID | Yes | Browser-generated UUID, stored in plaintext in `wims.citizen_reports.device_id`. **Not** PII — the encrypted blob (`witness_pii_blob_enc`) only holds `witness_name` and `witness_phone`. The ownership check (`_require_device_ownership`) queries this plaintext column. |
```

(Replaces or supplements the existing line — the implementer chooses the cleanest placement. The key information is: plaintext UUID, not in the blob, used for ownership.)

- [ ] **Step 4: Commit the wiki update**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add system-wiki/log.md system-wiki/subsystems/civilian-reporting-phase2.md system-wiki/gaps/frs-codebase-gap-register.md && git commit -m "docs(wiki): document device_id ownership fix; close PR #448 regression gap"
```

(If the gap register was not modified, omit it from the `git add`.)

---

### Task 6: Create the follow-up GitHub issue for the data-rescue script

The privacy export for pre-fix rows is incomplete (the export reads `device_id` and `ip_hash` from plaintext, which is NULL for those rows). The fix for that is a separate one-time data-rescue script. Track it as a follow-up issue per the spec.

**Files:**
- Create: GitHub issue in `x1n4te/WIMS-BFP-PROTOTYPE`
- Modify (append to `system-wiki/log.md`): one-line cross-reference to the issue

**Interfaces:**
- Consumes: the fixed repo (Tasks 1-5)
- Produces: a tracked GitHub issue that future work can pick up

- [ ] **Step 1: Verify `gh` is authenticated and the target repo is reachable**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && gh auth status && gh repo view x1n4te/WIMS-BFP-PROTOTYPE --json name
```

Expected: `gh auth status` shows your account logged in. `gh repo view` returns the repo name. If either fails, stop and ask the user to authenticate `gh` before continuing — do NOT skip this step and do NOT create the issue some other way.

- [ ] **Step 2: Create the issue**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && gh issue create --repo x1n4te/WIMS-BFP-PROTOTYPE --title "Follow-up: one-time data-rescue script for pre-fix citizen_reports device_id/ip_hash" --body "$(cat <<'EOF'
## Context

The 2026-06-24 device_id ownership restoration fix (spec: `docs/superpowers/specs/2026-06-24-civilian-device-id-ownership-design.md`) stopped putting `device_id` and `ip_hash` into the encrypted `witness_pii_blob_enc` and stopped nulling them in plaintext via the post-INSERT `_encrypt_witness_pii()` UPDATE. Going forward, new rows have plaintext `device_id` and `ip_hash` set correctly.

**However**, rows submitted between 2026-06-23 (PR #448 merge) and the deploy of the 2026-06-24 fix have plaintext `device_id` and `ip_hash` = NULL because PR #448's UPDATE nulled them. The values exist encrypted inside `witness_pii_blob_enc` for those rows.

## Impact: privacy export incompleteness

The privacy export at `src/backend/api/routes/admin/privacy.py:174` reads `device_id` and `ip_hash` from the **plaintext** columns. For pre-fix rows, the export returns `null` for these fields, even though the controller holds the data in the encrypted blob. This is a privacy completeness regression under RA 10173 (Philippine Data Privacy Act) — a data subject exercising their export right receives an under-complete export.

## Proposed fix: one-time data-rescue script

Create `src/backend/scripts/restore_citizen_reports_device_id_backlog.py`. Behavior:

1. Select rows where `device_id IS NULL` AND `witness_pii_blob_enc IS NOT NULL` (pre-fix encrypted rows).
2. For each row, decrypt `witness_pii_blob_enc` using the same AAD (`citizen_report:{report_id}`) and `get_crypto_provider()` machinery the production code uses.
3. If the decrypted JSON contains a `device_id` key, write it back to the plaintext `device_id` column. Same for `ip_hash`.
4. Leave `witness_name`, `witness_phone`, and the blob columns UNCHANGED. Only the two operational-primitive columns are restored.
5. Idempotent: rows where `device_id IS NOT NULL` are skipped.
6. Audit-logged: each row touched recorded in `security_audit_trails` with action `CIVILIAN_REPORT_PII_RESCUE`.
7. Dry-run flag (`--dry-run`) that prints the count of rows that would be updated without writing.

## When to run

**After** the 2026-06-24 fix is deployed and confirmed working on production. Not before — running it before the fix would write plaintext `device_id` to rows that the current code would then re-NULL on the next encrypt loop.

## Acceptance criteria

- Script decrypts the blob using the same `SecurityProvider` / `get_crypto_provider()` and AAD as production code.
- Script restores only `device_id` and `ip_hash`; leaves `witness_name`, `witness_phone`, and the four blob columns untouched.
- Script is idempotent: re-running it touches zero rows.
- Script is audit-logged.
- Script supports `--dry-run`.
- A new test in `src/backend/tests/test_privacy.py` (or a dedicated `test_restore_citizen_reports_device_id_backlog.py`) creates a row, encrypts it via the PR-#448 path, runs the script in a transaction, and asserts the plaintext columns are restored AND the blob columns are untouched.
- After running on production, the privacy export for all pre-fix rows returns non-NULL `device_id` and `ip_hash`.

## Estimated effort

Small. 1 file (the script, ~80 lines), 1 test file (~60 lines), 1 PR.

## Not in scope for the original 2026-06-24 fix

The 2026-06-24 fix unblocks the user-visible bug (new submissions can be tracked/listed/appended). The data-rescue is a separate compliance hygiene task that pre-existed the 2026-06-24 fix (PR #448 already broke the privacy export for those rows) and is not made worse by the fix — it just becomes addressable now.
EOF
)" --label "needs-triage,good-first-issue"
```

Expected: `gh issue create` prints the new issue URL. Copy it.

- [ ] **Step 3: Append a one-line cross-reference to `system-wiki/log.md`**

Open `system-wiki/log.md`. Find the section added in Task 5 (the `## 2026-06-24 — Civilian device_id ownership restoration` section). At the end of that section, add:

```markdown
- **Follow-up issue:** <paste the URL from step 2>
```

- [ ] **Step 4: Commit the log cross-reference**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add system-wiki/log.md && git commit -m "chore(docs): log follow-up task for privacy export data-rescue"
```

---

### Task 7: CI pre-flight (per `docs/agents/ci-preflight.md`)

The four-gate CI routine. All four must be green before declaring done.

**Files:** (no file changes — verification only)

**Interfaces:**
- Consumes: all changes from Tasks 1-6
- Produces: a green CI run

- [ ] **Step 1: Backend ruff lint**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/backend && ruff check api/routes/civilian.py tests/integration/test_civilian_api.py
```

Expected: clean (no output, exit code 0). If violations, fix with `ruff check --fix` then re-verify.

- [ ] **Step 2: Backend ruff format check**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/backend && ruff format . --check
```

Expected: clean. If violations, run `ruff format .` (auto-fix) then re-verify. The most common CI blocker.

- [ ] **Step 3: Backend pytest (full suite)**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose run --rm backend pytest -v
```

Expected: all tests pass. Pay attention to:
  - `tests/integration/test_civilian_api.py` (must include the 2 new tests passing)
  - `tests/test_privacy.py` (witness PII encrypt/decrypt canary)
  - Any other test that touches `wims.citizen_reports` (no regressions allowed)

  If a test fails, investigate. The most likely regression class is a test that asserted `device_id IS NULL` post-submit (which is now false post-fix). Fix the assertion, not the code.

- [ ] **Step 4: Frontend lint**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/frontend && npm run lint
```

Expected: clean. The frontend has no changes from this fix; this is a sanity check.

- [ ] **Step 5: Frontend vitest**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/frontend && npx vitest run
```

Expected: all tests pass. Sanity check; the form's `getDeviceId()` behavior is unchanged and its tests should pass.

- [ ] **Step 6: Frontend build (with dummy env vars per the live-notifications Task 13)**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/frontend && NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth NEXT_PUBLIC_BASE_URL=http://localhost:3000 npm run build
```

Expected: build succeeds. Sanity check; the frontend has no changes from this fix.

- [ ] **Step 7: If any gate failed, fix and re-run the failing gate**

Common issues and fixes:
  - `ruff check` failure → `ruff check --fix` then re-run
  - `ruff format` failure → `ruff format .` then re-run
  - `pytest` failure in a new test → re-read the test, ensure the test was correctly written, re-run
  - `pytest` failure in an OLD test → the test is asserting the post-#448 broken behavior. Update the assertion to match the new (correct) behavior. This is acceptable per the spec; document the test change in the relevant commit message.
  - `npm` failure → unlikely; no frontend changes were made.

  After fixing, return to the failing step and re-run all subsequent steps.

---

### Task 8: Push and verify

Final step. Push the branch, verify CI on the remote, then surface the result to the user.

**Files:** (no file changes — git operations only)

- [ ] **Step 1: Confirm the branch state**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git status && echo "---" && git log --oneline -10
```

Expected: 6 commits ahead of `master` at `25d5eca` (one per Task 1, 2, 3, 4, 5, 6), working tree clean. The exact commit order:
  1. `test(civilian): add failing test for device_id track round-trip`
  2. `test(civilian): add failing test for device_id list round-trip`
  3. `fix(civilian): stop nulling device_id and ip_hash after PII encryption`
  4. `refactor(test): rename _insert_report to make encryption-bypass explicit`
  5. `docs(wiki): document device_id ownership fix; close PR #448 regression gap`
  6. `chore(docs): log follow-up task for privacy export data-rescue`

  If the order is different, the implementer should re-read the task instructions. If the count is wrong (e.g. 5 or 7 commits), one task was probably skipped or doubled — investigate.

- [ ] **Step 2: Push the branch**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git push -u origin HEAD
```

Expected: branch is pushed. Note the remote branch name (likely `master` if working directly on master, or a feature branch if a worktree is in use). The handoff did not mandate a worktree for this fix; working on `master` is acceptable for such a small change, but a feature branch is preferable per the project's normal flow. If a feature branch is preferred, create one first:

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git checkout -b fix/civilian-device-id-ownership && git push -u origin fix/civilian-device-id-ownership
```

- [ ] **Step 3: Verify CI on the remote**

If the project's CI runs on push (e.g. GitHub Actions), check the run status:

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && gh run list --limit 1
```

Expected: the most recent run is associated with the push from Step 2. Watch for completion (`gh run watch <id>`) and confirm the four CI gates (backend ruff, backend ruff format, backend pytest, frontend lint/test/build) all pass.

If CI is not configured to run on push, this step is a no-op — the local CI pre-flight in Task 7 is the source of truth.

- [ ] **Step 4: Surface the result to the user**

Report:
  - Total commits and the commit list (from Step 1)
  - Local CI pre-flight result (from Task 7)
  - Remote CI result (from Step 3, if applicable)
  - The new follow-up issue URL (from Task 6, Step 2)
  - Any deviations from the plan and why

The task is complete when: all 6 commits are pushed, local CI is green, and the follow-up issue exists.

---

## Self-Review

**1. Spec coverage:**
  - Spec "Files Changed" row 1 (civilian.py encryption fix) → Task 3 ✓
  - Spec "Files Changed" row 2 (track round-trip test) → Task 1 ✓
  - Spec "Files Changed" row 3 (list round-trip test) → Task 2 ✓
  - Spec "Files Changed" row 4 (helper rename + docstring) → Task 4 ✓
  - Spec "Verification" steps 1-4 (ruff, pytest) → Task 7 steps 1-3 ✓
  - Spec "Verification" step 5 (frontend sanity check) → Task 7 steps 4-6 ✓
  - Spec "Verification" step 6 (system wiki update) → Task 5 ✓
  - Spec "Follow-up Task" (data-rescue script) → Task 6 (GitHub issue, not script itself) ✓
  - Spec "Test Helper Foot-Gun" (WARNING docstring) → Task 4 Step 3 ✓

  Gaps: none. The spec's "Follow-up Task" is explicitly out of plan scope per the spec ("NOT in this fix"); it is tracked as a GitHub issue in Task 6.

**2. Placeholder scan:**
  - No TBDs, no TODOs (the only `TODO` reference in the plan is a literal "TODO" in the warning docstring in Task 4 Step 3, which is intentional).
  - No "similar to Task N" — each test is fully written.
  - No "add appropriate error handling" — error handling is unchanged from the spec.
  - Every step has either an exact command, an exact code block, or both.

**3. Type consistency:**
  - Test 1 (Task 1) returns 200 with a report body that has `report_id`, `category`, `reporting_context`, `safety_status`. These fields are verified to exist in `CivilianReportResponse` schema (`schemas/civilian.py`).
  - Test 2 (Task 2) asserts `report_id` in the list response. The `MyReportItem` schema has `report_id: int` — consistent.
  - The renamed helper signature matches the original (only the name changes) — no call site needs argument changes.
  - The GitHub issue labels (`needs-triage,good-first-issue`) match the project's triage label scheme per `docs/agents/triage-labels.md`.

**4. Risk check:**
  - The 30-call-site rename could miss something — Step 4 has a verification (`rg -c "\b_insert_report\b" ... || echo ...`) that catches missed renames.
  - The fix in Task 3 could regress an existing test — Task 3 Step 5 explicitly calls this out and instructs the implementer to investigate rather than skip.
  - The wiki update in Task 5 is small and reversible — easy to fix if the wording is wrong.
  - The follow-up issue in Task 6 depends on `gh` being authenticated — Step 1 has an explicit check.

No issues found in self-review. Plan is ready to execute.
