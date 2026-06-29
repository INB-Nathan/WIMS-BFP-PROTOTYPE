---
title: Civilian Triage — Split & Merge Fix Implementation Plan
created: 2026-06-29
updated: 2026-06-29
type: plan
tags: [wims-bfp, triage, split, merge, bugfix, implementation]
sources:
  - src/backend/services/civilian_triage/workflow.py
  - src/backend/services/civilian_triage/repository.py
  - src/backend/services/civilian_triage/policies.py
  - system-wiki/plans/civilian-triage-split-merge-fixes-spec.md
status: draft
---

# Civilian Triage — Split & Merge Fix Implementation Plan

## Prerequisite

This plan implements the specification at
`system-wiki/plans/civilian-triage-split-merge-fixes-spec.md`.
Read that document first for acceptance criteria, runtime ordering
constraints, and isolation context.

---

## Step 1: SPEC-5 — Deterministic anchor via ORDER BY

**File:** `src/backend/services/civilian_triage/workflow.py`
**Function:** `split_cluster_command`
**Change:** Trivial — one SQL clause addition.

### Current code

```python
members = db.execute(
    text("""
        SELECT report_id
        FROM wims.citizen_report_cluster_members
        WHERE cluster_id = :cid AND report_id = ANY(CAST(:report_ids AS integer[]))
        FOR UPDATE
    """),
    {"cid": cluster_id, "report_ids": report_ids},
).fetchall()
found_ids = [row.report_id for row in members]
```

### Change

Append `ORDER BY report_id ASC` **before** `FOR UPDATE`:

```python
members = db.execute(
    text("""
        SELECT report_id
        FROM wims.citizen_report_cluster_members
        WHERE cluster_id = :cid AND report_id = ANY(CAST(:report_ids AS integer[]))
        ORDER BY report_id ASC
        FOR UPDATE
    """),
    {"cid": cluster_id, "report_ids": report_ids},
).fetchall()
found_ids = [row.report_id for row in members]
```

PostgreSQL requires `ORDER BY` before `FOR UPDATE` in the SQL grammar.
`found_ids[0]` is now reliably the smallest `report_id` among the moved
reports, used as the new cluster's anchor.

### Verification

Assert `new_cluster.anchor_report_id == min(body.report_ids)` after split.

---

## Step 2: SPEC-3 — Atomic merge member move

**File:** `src/backend/services/civilian_triage/workflow.py`
**Function:** `merge_clusters_command`
**Change:** Structural — replace three separate SQL statements (SELECT,
INSERT, DELETE) with one atomic `WITH moved AS (DELETE ... RETURNING)
INSERT ... SELECT FROM moved`.

### Current code (annotated)

```python
# Step 3a: ensure_cluster_claim / fetch_cluster_for_update — keep these
target = ensure_cluster_claim(db, target_cluster_id, user)
source = fetch_cluster_for_update(db, body.source_cluster_id)
if source is None:
    raise HTTPException(status_code=404, detail="Source cluster not found")
if source[1] == "CLUSTER_CLOSED":
    raise HTTPException(status_code=409, detail="Source cluster is already closed")

# Step 3b: READ source members (NO LOCK — TOCTOU window)
source_members = db.execute(
    text("SELECT report_id FROM wims.citizen_report_cluster_members WHERE cluster_id = :cid"),
    {"cid": body.source_cluster_id},
).fetchall()
report_ids = [row.report_id for row in source_members]

# Step 3c: INSERT into target
db.execute(
    text("""
        INSERT INTO wims.citizen_report_cluster_members (cluster_id, report_id, linked_by)
        SELECT :target_cid, unnest(CAST(:report_ids AS integer[])), :uid
        ON CONFLICT (cluster_id, report_id) DO NOTHING
    """),
    {"target_cid": target_cluster_id, "report_ids": report_ids, "uid": user_id},
)

# Step 3d: DELETE from source (BLIND — deletes rows that appeared after step 3b)
db.execute(
    text("""
        DELETE FROM wims.citizen_report_cluster_members
        WHERE cluster_id = :source_cid
    """),
    {"source_cid": body.source_cluster_id},
)
```

### Replace steps 3b–3d entirely

The SELECT + INSERT + DELETE must be replaced with a single atomic CTE
that both deletes from source and inserts into target in one statement.
The key insight (from the spec's §2 isolation context): under READ COMMITTED,
`FOR UPDATE` on the member SELECT would not block a concurrent INSERT of a
new row — the lock only applies to rows that already exist. The real fix is
to eliminate the window entirely: `DELETE ... RETURNING` captures *every*
row that existed at DELETE execution time (including any phantom inserted
concurrently), and `INSERT ... SELECT FROM moved` moves exactly that set.

```python
# Atomic move: DELETE ... RETURNING → INSERT ... SELECT FROM moved
# The set deleted == the set inserted; no phantom can escape.
result = db.execute(
    text("""
        WITH moved AS (
            DELETE FROM wims.citizen_report_cluster_members
            WHERE cluster_id = :source_cid
            RETURNING report_id
        ),
        inserted AS (
            INSERT INTO wims.citizen_report_cluster_members
                (cluster_id, report_id, linked_by)
            SELECT :target_cid, report_id, :uid
            FROM moved
            ON CONFLICT (cluster_id, report_id) DO NOTHING
            RETURNING report_id
        )
        SELECT COALESCE(json_agg(moved.report_id ORDER BY moved.report_id), '[]'::json) AS moved_ids
        FROM moved
    """),
    {
        "source_cid": body.source_cluster_id,
        "target_cid": target_cluster_id,
        "uid": user_id,
    },
).fetchone()

report_ids = json.loads(result[0]) if isinstance(result[0], str) else (result[0] or [])
```

**Why this works (specifically under READ COMMITTED):**
- The `DELETE` inside the CTE scans for all rows matching
  `cluster_id = :source_cid` at execution time. Any concurrent INSERT that
  committed before the scan point is visible and included in the deleted set.
  Any INSERT still in-flight blocks on the row lock and is seen when the
  lock releases.
- The `RETURNING` clause captures every row actually deleted, including any
  concurrently-inserted phantoms.
- The `INSERT ... SELECT FROM moved` inserts exactly those rows into target.
- `ON CONFLICT DO NOTHING` preserves reports already in target.
- The json_agg captures the full moved set for the `WorkflowResult` response.

**Why the old code was wrong (and FOR UPDATE wouldn't help):**
The old three-step sequence had a SELECT (returning [1,2]), then an INSERT,
then a blind `DELETE WHERE cluster_id = :source_cid`. A phantom row 3
inserted between SELECT and DELETE would be deleted but never inserted
into target — data loss.

**`split_cluster_command` doesn't have this bug** because its DELETE is
scoped to specific `report_id` values (`WHERE ... AND report_id = ANY(:ids)`),
not a blind cluster-wide delete.

### Dependency

Add `import json` at the top of `workflow.py` if not already present.

### Verification

- Concurrent survival test: two connections, insert into source cluster
  within the merge transaction, assert row exists in target after commit.
- Regression: standard merge returns correct `report_ids` in response.

---

## Step 3: SPEC-1 — Re-anchor source cluster after split

**File:** `src/backend/services/civilian_triage/workflow.py`
**Function:** `split_cluster_command`
**Change:** New logic block between the DELETE and the source-cluster UPDATE.

### Where to insert

After the DELETE of moved members (which is currently the first operation
after creating the new cluster), and before the source cluster UPDATE.

Current flow (simplified):

```
# 1. Create new cluster                      (lines ~289-295)
# 2. DELETE moved members from source         (lines ~296-299)
# 3. INSERT moved members into new cluster    (lines ~300-304)
# 4. UPDATE source cluster internal_note      (lines ~307-309)
# 5. Log audit, commit                        (lines ~310-318)
```

### Add: re-anchor logic after step 2

```python
# 2a. Re-anchor source cluster if anchor was moved
remaining = db.execute(
    text("""
        SELECT COUNT(*) FROM wims.citizen_report_cluster_members
        WHERE cluster_id = :cid
    """),
    {"cid": cluster_id},
).scalar()
```

Wait — the spec says SPEC-2 (empty guard) must run BEFORE SPEC-1
(re-anchor). So the order should be:

```
# 2. DELETE moved members from source
# 2a. COUNT remaining → if 0, raise 422 (SPEC-2, guards before SPEC-1)
# 2b. If old anchor was moved → UPDATE source cluster anchor (SPEC-1)
# 3. INSERT moved members into new cluster
```

But there's a problem: the current code creates the new cluster FIRST
(before the DELETE). Let me re-read the current split flow carefully.

Current `split_cluster_command` flow:

```
1. Validate inputs (not empty, all are members, ≥ 2 selected)
2. INSERT new cluster, get new_cluster_id       ← line ~289-295
3. DELETE members from source cluster            ← line ~296-299
4. INSERT members into new cluster               ← line ~300-304
5. UPDATE source cluster (internal_note)         ← line ~307-309
6. Log audit events                              ← line ~310-318
7. COMMIT
```

The new cluster is created BEFORE the DELETE. So the order must be:

```
1. Validate inputs
2. INSERT new cluster, get new_cluster_id
3. DELETE members from source cluster
4. COUNT remaining members
   ├─ If 0 → RAISE 422, ROLLBACK       ← SPEC-2
   └─ If > 0 → continue
5. Check if old anchor was moved → UPDATE if needed  ← SPEC-1
6. INSERT members into new cluster
7. UPDATE source cluster (internal_note + anchor if needed)
8. Log audit
9. COMMIT
```

Wait, but the INSERT of members into the new cluster (step 6) currently
happens between the DELETE and the source UPDATE. The re-anchor check
needs to happen before the INSERT into new cluster? No — the re-anchor
is about the SOURCE cluster, not the new one. The new cluster already
has its anchor set at creation time (from `found_ids[0]`).

The re-anchor only needs to:
1. Check if the source cluster's `anchor_report_id` is in the moved set
2. If yes, update source cluster's `anchor_report_id` to `min(report_id)` of remaining members

This can happen between the DELETE and the source UPDATE. Let me be precise.

### Implementation

After the DELETE (step 3) and after the empty-guard (SPEC-2, step 4),
but before the source cluster UPDATE (step 7). The INSERT into new
cluster (step 6) is independent and can stay where it is.

Here's the new sequence:

```python
# ── Step 3: DELETE moved members from source ──
db.execute(
    text("""
        DELETE FROM wims.citizen_report_cluster_members
        WHERE cluster_id = :cid AND report_id = ANY(CAST(:report_ids AS integer[]))
    """),
    {"cid": cluster_id, "report_ids": found_ids},
)

# ── Step 4: SPEC-2 — Guard against empty source cluster ──
remaining_count = db.execute(
    text("SELECT COUNT(*) FROM wims.citizen_report_cluster_members WHERE cluster_id = :cid"),
    {"cid": cluster_id},
).scalar()
if remaining_count == 0:
    raise HTTPException(status_code=422, detail="Split would leave source cluster empty")

# ── Step 5: SPEC-1 — Re-anchor source cluster if anchor was moved ──
# Read old anchor from the cluster row (already fetched at start of function)
# We need the old anchor_report_id. Currently the function uses `cluster_id`
# but never reads the source cluster's anchor. We need to fetch it.
```

Hmm, the current `split_cluster_command` doesn't read the source cluster's
`anchor_report_id`. Let me check what it has access to.

Looking at the current code flow:
- `cluster = ensure_cluster_claim(db, cluster_id, user)` — this returns
  the cluster tuple from `fetch_cluster_for_update` which has
  `(cluster_id, status, assigned_to, review_started_at, updated_at, internal_note, assigned_username)`.
  It does NOT include `anchor_report_id`.

So I need to either:
(a) Add `anchor_report_id` to the SELECT in `fetch_cluster_for_update`, or
(b) Do a separate query for the old anchor.

Option (a) is cleaner. `fetch_cluster_for_update` currently returns 7 fields.
Adding `anchor_report_id` makes it 8. But this affects ALL callers — every
`cluster[N]` index would shift. That's risky.

Option (b) is safer and more isolated. A simple query inside the split
function:

```python
old_anchor = db.execute(
    text("SELECT anchor_report_id FROM wims.citizen_report_clusters WHERE cluster_id = :cid"),
    {"cid": cluster_id},
).scalar()
```

Then check if it was moved:

```python
if old_anchor in found_ids and remaining_count > 0:
    new_anchor = db.execute(
        text("""
            SELECT MIN(report_id) FROM wims.citizen_report_cluster_members
            WHERE cluster_id = :cid
        """),
        {"cid": cluster_id},
    ).scalar()
    db.execute(
        text("""
            UPDATE wims.citizen_report_clusters
            SET anchor_report_id = :new_anchor
            WHERE cluster_id = :cid
        """),
        {"cid": cluster_id, "new_anchor": new_anchor},
    )
```

This is safe because:
- `remaining_count > 0` is guaranteed by SPEC-2 (which already ran)
- `old_anchor in found_ids` checks if the anchor was among the moved reports
- `MIN(report_id)` of remaining members is deterministic
- The UPDATE only affects `anchor_report_id`, no other fields

### Integration with existing flow

The re-anchor UPDATE (step 5) and the existing source cluster UPDATE
(step 7, which updates `internal_note`, `updated_at`, `acted_by`) are
separate SQL statements. They could be combined, but keeping them
separate minimizes risk. If combined later, ensure the combined UPDATE
sets all four columns (`anchor_report_id`, `internal_note`, `updated_at`,
`acted_by`).

### Verification

- AC1.1: Anchor-moved case — assert old anchor != new anchor via raw SQL
- AC1.2: Anchor-stays case — assert anchor unchanged via raw SQL
- AC1.1 also verifies SPEC-4 (no duplicate between source and new clusters)
- Assert new cluster's `anchor_report_id == min(found_ids)` (from SPEC-5)

---

## Step 4: SPEC-2 — Empty source cluster guard

**File:** `src/backend/services/civilian_triage/workflow.py`
**Function:** `split_cluster_command`
**Change:** New guard block between DELETE and INSERT into new cluster.

### Implementation

Already shown above in Step 3's flow. The guard is:

```python
remaining_count = db.execute(
    text("SELECT COUNT(*) FROM wims.citizen_report_cluster_members WHERE cluster_id = :cid"),
    {"cid": cluster_id},
).scalar()
if remaining_count == 0:
    raise HTTPException(status_code=422, detail="Split would leave source cluster empty")
```

### Runtime ordering (MANDATORY)

This MUST execute BEFORE the re-anchor logic (SPEC-1). See §6 of the spec
for the full execution order and rationale.

### Rollback behavior

The `try/except HTTPException: db.rollback(); raise` block at the end of
`split_cluster_command` handles this. The HTTPException propagates up,
rollback happens, and the entire transaction (including the already-created
new cluster) is discarded.

Note: This means the new cluster's `cluster_id` sequence is consumed even
on a failed split. That's acceptable — sequence gaps are normal in PostgreSQL
and do not affect correctness.

### Verification

- AC2.1: Attempt to split all N members of an N-member cluster → 422
- AC2.2: Split N-1 members → success
- Rollback verification: raw SQL read after 422 shows source cluster still
  has N members and new cluster does not exist

---

## Step 5: Update `system-wiki/log.md` and FRS gap register

After all four commits are merged, update:

- `system-wiki/log.md` with the date and summary of changes
- `system-wiki/gaps/frs-codebase-gap-register.md` if any FRS alignment
  changed (unlikely — this is a bug fix, not a feature change)

---

## Commit Strategy

```
1. fix(triage): deterministically order split member SELECT (SPEC-5)
2. fix(triage): atomic merge member move via DELETE RETURNING (SPEC-3)
3. fix(triage): re-anchor source cluster after split (SPEC-1)
4. fix(triage): guard against empty source cluster on split (SPEC-2)
```

Hashes above are illustrative — actual hashes determined at commit time.

Each commit includes its test(s). Commit 4 must be after commit 3 (ordering
dependency). Commits 1 and 2 are independent and can be in any order.

---

## Test Files

Add tests to:
- `src/backend/tests/integration/test_triage_queue.py` (existing integration
  test file for triage workflow)

Or create a new test module:
- `src/backend/tests/test_civilian_triage_split_merge.py` (focused unit/integration
  tests for split and merge specifically)

The concurrent survival test for SPEC-3 may need a separate test file if it
requires `pg_sleep` or connection multiplexing not present in the existing
test infrastructure.

---

## Rollback Plan

If any commit causes test failures:

1. **SPEC-5** (ORDER BY): Safest to revert — pure readability/non-determinism
   change, no logic impact.
2. **SPEC-3** (atomic merge): Revert and restore original SELECT+INSERT+DELETE
   with `FOR UPDATE` as a partial mitigation (not a complete fix).
3. **SPEC-1** (re-anchor): Revert and leave the anchor-dangling bug in place.
   Document the known limitation.
4. **SPEC-2** (empty guard): Revert and leave the zombie-cluster bug in place.
   Document the known limitation.
