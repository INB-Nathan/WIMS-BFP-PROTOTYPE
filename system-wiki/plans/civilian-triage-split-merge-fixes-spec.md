---
title: Civilian Triage — Split & Merge Fix Specification
created: 2026-06-29
updated: 2026-06-29
type: spec
tags: [wims-bfp, triage, split, merge, bugfix, spec]
sources:
  - src/backend/services/civilian_triage/workflow.py
  - src/backend/services/civilian_triage/repository.py
  - src/backend/services/civilian_triage/policies.py
  - src/backend/services/civilian_triage/queue_projection.py
  - src/backend/services/civilian_triage/models.py
  - src/backend/api/routes/triage.py
  - src/postgres-init/35_citizen_report_clusters.sql
  - system-wiki/plans/architecture-refactor-phase-4-civilian-triage-workflow.md
  - system-wiki/operations/civilian-triage-hci-polish.md
status: draft
---

# Civilian Triage — Split & Merge Fix Specification

## 1. Purpose

Fix cluster split and merge commands in the Civilian Triage Workflow so they
produce correct, consistent database state and survive concurrent queue
materialization without data loss.

## 2. Isolation Context

All database sessions in this system run under PostgreSQL **READ COMMITTED**
isolation (the default). No code path sets `SERIALIZABLE` or `REPEATABLE READ`.
Every correctness argument in this document is made within READ COMMITTED
semantics.

Key property: `SELECT ... FOR UPDATE` locks only rows that **exist at the
moment the lock is acquired**. A concurrent `INSERT` of a new row that matches
the WHERE clause after the lock is acquired is **not blocked** — the new row
is invisible to the locking SELECT. This is not a bug; it is the expected
READ COMMITTED behavior.

This context is essential for SPEC-3 (the merge TOCTOU fix), where the
root cause and the remedy are both framed around this isolation model.

## 3. Scope

### In Scope

1. `split_cluster_command` — anchor re-anchoring, empty-cluster guard,
   deterministic anchor selection
2. `merge_clusters_command` — atomic member move to prevent TOCTOU data loss
3. Existing integration and unit tests pass after changes
4. `system-wiki/log.md` and FRS gap register updated after merge

### Out of Scope

- `claim_cluster_command`, `refresh_cluster_activity_command`,
  `apply_terminal_action_command`, `correct_terminal_report_command` — unchanged
- Queue projection materialization CTEs — unchanged (preserves existing
  materialization behavior; the merge fix is fully contained in `workflow.py`)
- Notification behavior, audit logging behavior — unchanged
- Frontend UI for split/merge — unchanged
- Database schema migrations — no new tables or columns; no constraint changes
- `linked_by` provenance preservation in merge — design note only (SPEC-6)

## 4. Background

Six defects were discovered during a structured code review of the split and
merge workflow commands. Three are correctness issues requiring code changes;
two are structural improvements; one is a design note.

### Defect Summary

| # | Severity | Command | Title | Code Change Needed? |
|---|----------|---------|-------|---------------------|
| 1 | BLOCKER | split | Source cluster `anchor_report_id` not updated when anchor is moved | Yes |
| 2 | BLOCKER | split | Split can empty source cluster → zombie with 0 members | Yes |
| 3 | MAJOR | merge | Non-atomic member move allows phantom data loss under concurrent INSERT | Yes |
| 4 | MINOR | split | Derivative of #1 — duplicate `anchor_report_id` across clusters | Folded into #1 |
| 5 | MINOR | split | New-cluster anchor selection non-deterministic (no ORDER BY) | Yes |
| 6 | NOTE | merge | `linked_by` provenance overwritten on merge | Documented only |

Defects 1, 2, 3, and 5 are independent code changes. Defect 4 is a consequence
of Defect 1 and requires no separate change. Defect 6 is a design observation
with no change in this batch.

### Common Pattern: DELETE Scope

The split and merge commands differ in how they delete members from the
source cluster — and this difference, not `FOR UPDATE` presence, determines
their safety under concurrent INSERT:

| Operation | DELETE clause | Phantom-safe? |
|-----------|--------------|---------------|
| Split | `WHERE cluster_id = :cid AND report_id = ANY(:ids)` | ✅ Yes — scoped to known IDs; cannot delete unseen rows |
| Merge | `WHERE cluster_id = :cid` (blind delete-all) | ❌ No — deletes every member, including rows that appeared after the initial read |

The split command is safe because it only deletes reports it explicitly
selected. The merge command is unsafe because it deletes `ALL` members of the
source cluster, including any inserted concurrently between the SELECT and
the DELETE. The fix (SPEC-3) must address this structural gap, not add a lock.

## 5. Requirement Specifications

### SPEC-1: Split preserves source cluster anchor integrity

**Requirement ID:** SPLIT-ANCHOR-REANCHOR

**Description:**
After `split_cluster_command` removes selected reports from the source
cluster, the source cluster's `anchor_report_id` MUST point to a report that
is still a member of that cluster. If the old `anchor_report_id` was among
the moved reports, the command MUST reassign it to the smallest `report_id`
among the remaining members.

**Rationale:**
`get_merge_candidates_command` joins on `anchor_report_id` to compute spatial
distance and location for merge suggestions. A dangling anchor (pointing to a
report no longer in the cluster) produces incorrect merge candidates computed
from the wrong location. The queue display also uses `anchor_report_id` as
the cluster's representative report; a dangling anchor shows a report from a
different cluster.

**Acceptance Criteria:**

- **AC1.1:** Cluster with `anchor_report_id=5`, members `{1,2,3,4,5}`.
  Split moves `{1,5}`. Source cluster's `anchor_report_id` MUST become `2`
  (lowest remaining `report_id`). New cluster's `anchor_report_id` MUST be `1`
  (lowest moved `report_id`).
- **AC1.2:** Cluster with `anchor_report_id=3`, members `{1,2,3}`.
  Split moves `{1,2}` (anchor stays). Source cluster's `anchor_report_id`
  MUST remain `3`.
- **AC1.3:** The re-anchor check MUST execute AFTER the DELETE (so remaining
  members are known) but BEFORE the source cluster UPDATE, inside the same
  transaction.

**Phantom exposure acknowledged:**
Reading `min(report_id)` of remaining members after the DELETE, without
locking the remaining rows, could in theory miss a concurrently-inserted
member. In practice the stakes are low (worst case: a stale-but-valid anchor
rather than a dangling one), and the window is narrow (the materialization
CTE would need to insert into this specific cluster mid-split). Accepting
this risk; a locked read would add complexity for negligible gain.

**Error States:**
No additional error states beyond existing 404/409/422 guards.

**Tests:**

- Parametrized integration test with anchor-moved and anchor-stays cases.
  Assert source cluster `anchor_report_id` via raw SQL read after commit.
- Assert new cluster's `anchor_report_id` equals the minimum moved `report_id`.

---

### SPEC-2: Split cannot leave the source cluster empty

**Requirement ID:** SPLIT-EMPTY-GUARD

**Description:**
`split_cluster_command` MUST prevent a split that would leave the source
cluster with zero members. After the DELETE of selected members, if zero
members remain, the command MUST raise HTTP 422 with a clear message and
roll back the transaction.

**Rationale:**
A `citizen_report_clusters` row with 0 members, status `CLUSTER_UNDER_REVIEW`,
and a dangling `anchor_report_id` has concrete harms:

1. **Dead weight** — never appears in the queue (`latest_clusters` CTE uses
   LEFT JOIN on `cluster_members`, producing no rows for an empty cluster),
   but never cleaned up (no `closed_at`, no `CLUSTER_CLOSED` status).
2. **Visible as an empty merge candidate** — `get_merge_candidates_command`
   filters on `status != 'CLUSTER_CLOSED'` and joins on the anchor report.
   A 0-member cluster appears with `member_count = 0`, confusing validators.

**Acceptance Criteria:**

- **AC2.1:** Cluster with members `{1,2,3}`. Split attempts to move all 3.
  Command MUST raise HTTP 422 and roll back.
- **AC2.2:** Cluster with members `{1,2,3}`. Split moves `{1,2}` (2 of 3).
  Command MUST succeed; 1 member remains.
- **AC2.3:** The empty-cluster check MUST execute AFTER the DELETE (when
  remaining count is known) and BEFORE the re-anchor check (SPEC-1). This
  ordering is mandatory: SPEC-2 must guard before SPEC-1's `min()` runs,
  because `min()` over an empty set returns NULL.
- **AC2.4:** The guard must be a post-DELETE count, not a pre-DELETE check.
  A pre-check (`count(selected) == count(total)`) would have its own TOCTOU
  race: between counting and deleting, a concurrent insertion could change
  the total. A post-DELETE count inside the same transaction is accurate.

**Error States:**

| Condition | HTTP Status | Detail |
|-----------|-------------|--------|
| After DELETE, 0 members remain | 422 | "Split would leave source cluster empty" |

**Tests:**

- Parametrized test: cluster with N members, split attempts N, N-1, N-2.
  N → 422, N-1 → success, N-2 → success.
- After 422, assert via raw SQL that source cluster still has N members
  (verifying rollback).
- Assert that a zombie cluster (if created outside the test) appears in
  `get_merge_candidates_command` results with `member_count = 0`.

---

### SPEC-3: Merge must use atomic DELETE-RETURNING-INSERT to prevent data loss

**Requirement ID:** MERGE-ATOMIC-MOVE

**Description:**
`merge_clusters_command` MUST move source-cluster members to the target
cluster using a single atomic SQL statement that deletes from source and
inserts into target in one round-trip, eliminating the race window between
the current separate SELECT → INSERT → DELETE steps.

**Root Cause (not lock absence):**

Under READ COMMITTED isolation, the current three-step sequence is:

```
# Step 1 (no lock): SELECT report_id FROM members WHERE cluster_id = :source
#                    → returns [1, 2]
#        ═══ concurrent INSERT of report 3 into source cluster ═══
# Step 2: INSERT ... SELECT :target, unnest([1, 2]), :uid
#         → adds 1, 2 to target (skips 3 — it wasn't in the SELECT)
# Step 3: DELETE FROM members WHERE cluster_id = :source
#         → deletes 1, 2, 3  ← report 3 is LOST
```

Adding `FOR UPDATE` to Step 1 would lock rows `[1, 2]` but would **not**
block the concurrent INSERT of row `3`. Row `3` does not exist yet, so there
is nothing to lock. This is correct READ COMMITTED behavior, not a missing
lock — and the meta-narrative "split has FOR UPDATE, merge doesn't" is a
**misdiagnosis**. The split command is safe because its `DELETE` is scoped
to specific `report_id` values (`WHERE cluster_id = :cid AND report_id = ANY(:ids)`),
not because it has `FOR UPDATE`.

The correct fix is to eliminate the window entirely by making the move atomic:

```sql
WITH moved AS (
    DELETE FROM wims.citizen_report_cluster_members
    WHERE cluster_id = :source_cid
    RETURNING report_id
)
INSERT INTO wims.citizen_report_cluster_members
    (cluster_id, report_id, linked_by)
SELECT :target_cid, report_id, :uid
FROM moved
ON CONFLICT (cluster_id, report_id) DO NOTHING
```

This guarantees that the set of rows deleted from source is **exactly**
the set of rows inserted into target — no phantom can slip between them
because both operations happen in a single statement execution.

**Acceptance Criteria:**

- **AC3.1:** The separate SELECT for source members must be removed; the
  DELETE and INSERT must be combined into a single `WITH moved AS (DELETE ...
  RETURNING) INSERT ... SELECT FROM moved` statement.
- **AC3.2:** `ON CONFLICT (cluster_id, report_id) DO NOTHING` must be
  preserved — a report already in the target must not be duplicated.
- **AC3.3:** `ensure_cluster_claim(target_cluster_id)` must still execute
  before the atomic move (guards the target cluster).
- **AC3.4:** The source cluster `fetch_cluster_for_update` and the
  `CLUSTER_CLOSED` check must still execute before the atomic move.

**Error States:** (none new — this is a structural change, not a validation change)

**Tests:**

- **Survival test (requires two concurrent connections):** Connection A begins
  a merge transaction. Connection B INSERTs a new member into the source
  cluster. Connection A commits the merge. Assert the new member exists in
  the target cluster (not lost). Use `pg_sleep` or a NOTIFY/PG advisory lock
  to ensure the INSERT happens within the merge's race window.
- **Regression test:** Standard (non-concurrent) merge works as before.
- **Data integrity:** After merge, source cluster has 0 members in its
  members table (verified by raw SQL). All former source members exist in
  target's members table.

---

### SPEC-4: No two active clusters share the same `anchor_report_id` (local invariant)

**Requirement ID:** SPLIT-NO-DUPLICATE-ANCHOR

**Description:**
`split_cluster_command` MUST guarantee that the source and new clusters do
**not** share the same `anchor_report_id`.

**Scope caveat:**
This invariant is **local**: it only covers the two clusters directly involved
in a single split operation. It does **not** guarantee global uniqueness
across all active clusters. A global invariant would require either:

- A partial unique index on `(anchor_report_id) WHERE status != 'CLUSTER_CLOSED'`
  (deferred — requires schema migration).
- A modification to the queue materialization CTE to avoid re-using an
  `anchor_report_id` already taken by another cluster (out of scope — §2).

SPEC-1's re-anchor logic ensures local disjointness because the moved set and
the remaining set are, by definition, disjoint. As long as SPEC-1 correctly
re-anchors the source cluster to a remaining member, the two clusters cannot
collide within this single operation. This is sufficient for correctness of
the split command itself.

**Acceptance Criteria:**

- **AC4.1:** For any successful split, `SELECT anchor_report_id` from source
  and new clusters returns different values.
- **AC4.2:** The invariant is asserted in the split integration test via
  a post-commit raw SQL query on both cluster rows.

**Design Decision:**
A partial unique index would make this invariant global and database-enforced.
It is deferred because (a) the spec is already large, (b) it requires a
schema migration (new bootstrap file + startup DDL patch), and (c) the
application-level fix in SPEC-1 covers the only code path that can create
a duplicate. Revisit if a duplicate `anchor_report_id` is observed in
production.

---

### SPEC-5: New cluster anchor is deterministically the lowest `report_id`

**Requirement ID:** SPLIT-ANCHOR-DETERMINISTIC

**Description:**
The `SELECT` that reads candidate members for a split MUST include
`ORDER BY report_id ASC` so that `found_ids[0]` (used as the new cluster's
anchor) is deterministic.

**Rationale:**
Without `ORDER BY`, physical row order (heap order, not logical) determines
which report becomes the anchor. This varies across query plans, index state,
`VACUUM`, and database restarts. A deterministic anchor makes the operation
predictable and testable.

**Acceptance Criteria:**

- **AC5.1:** The source-member SELECT in `split_cluster_command` MUST append
  `ORDER BY report_id ASC` to the existing WHERE clause.
- **AC5.2:** The new cluster's `anchor_report_id` MUST equal `found_ids[0]`
  (which, after the ORDER BY, is the smallest `report_id` among moved reports).

**Error States:** (none)

**Tests:**

- Assert that new cluster's `anchor_report_id == min(body.report_ids)` after split.

---

### SPEC-6: Design Note — `linked_by` provenance on merge

**Requirement ID:** MERGE-LINKED-BY-NOTE

**Status:** DOCUMENTED ONLY — no code change in this batch.

**Description:**
When the atomic merge (SPEC-3) inserts source members into the target cluster,
it writes the merging user's `user_id` as `linked_by`. Reports that were
already in the target cluster retain their original `linked_by` (via
`ON CONFLICT DO NOTHING`). The original `linked_by` values from the source
cluster are lost.

**Decision:**
This is acceptable for the current release. The merge action itself is audited
via `log_system_audit` as `CLUSTER_MERGE_TARGET` and `CLUSTER_MERGE_SOURCE`
events with a full audit trail. If provenance preservation is needed in the
future, the INSERT can use `ON CONFLICT DO UPDATE SET linked_by =
EXCLUDED.linked_by` to preserve the source's original value, at the cost of
losing the audit of who performed the merge on each individual row.

---

## 6. Runtime Execution Order (Mandatory)

Within `split_cluster_command`, the fix steps MUST execute in this order,
inside a single transaction:

```
1. Validate inputs (existing guards: empty ids, too-few ids, non-members)
2. DELETE moved members from source cluster
3. COUNT remaining members in source cluster
   ├─ If 0 → RAISE 422, ROLLBACK   ← SPEC-2 (guards before re-anchor)
   └─ If > 0 → continue
4. SELECT remaining members; compute min(report_id) for anchor
   ├─ If old anchor was moved → UPDATE source cluster anchor  ← SPEC-1
   └─ If old anchor stayed → no-op
5. INSERT moved members into new cluster
6. UPDATE source cluster internal_note, updated_at, acted_by
7. Log audit events
8. COMMIT
```

SPEC-2 (empty guard) MUST execute before SPEC-1 (re-anchor) because
`min()` over an empty set returns NULL, which would write a NULL into
`anchor_report_id` (violating the column's NOT NULL constraint).

Within `merge_clusters_command`, the fix replaces the separate SELECT +
INSERT + DELETE with a single atomic statement:

```
1. ensure_cluster_claim(target)      ← guards target
2. fetch_cluster_for_update(source)  ← guards source
3. If source is CLUSTER_CLOSED → 409
4. ATOMIC: DELETE ... RETURNING → INSERT ... SELECT FROM moved  ← SPEC-3
5. UPDATE source cluster status to CLUSTER_CLOSED
6. UPDATE target cluster internal_note
7. Log audit events
8. COMMIT
```

## 7. Implementation Order (Recommended)

| Step | Spec | Change | Complexity | Test Required |
|------|------|--------|------------|---------------|
| 1 | SPEC-5 | Add `ORDER BY report_id ASC` to split member SELECT | Trivial (1 line) | Deterministic anchor assertion |
| 2 | SPEC-3 | Replace merge's separate SELECT+INSERT+DELETE with atomic `WITH moved AS (DELETE ... RETURNING) INSERT ... SELECT FROM moved` | Moderate (rewrite one SQL section) | Concurrent survival test |
| 3 | SPEC-1 | Re-anchor source cluster after DELETE | Moderate (~10 lines of Python + one SQL UPDATE) | Parametrized anchor-moved/stays tests |
| 4 | SPEC-2 | Empty-cluster guard after DELETE | Small (~5 lines of Python) | Parametrized empty/surviving tests |

Each step can be a separate commit with its own test(s). Steps 1 and 2 are
independent and can be parallelized. Step 4 must merge after Step 3 (due to
runtime ordering requirement). Step 2 has the highest risk and the most
valuable test (concurrent survival).

## 8. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SPEC-3 atomic CTE causes regression (wrong report_ids in WorkflowResult) | Medium | The atomic CTE does not RETURNING in a way visible to Python in the current code structure; `report_ids` variable must be populated from the moved set. Use a second `RETURNING` step or capture `report_ids` from the `source_members` query *before* the atomic move (with FOR UPDATE to freeze the set). Actually, the atomic move replaces the old pattern — the `report_ids` for the response must come from the `RETURNING` clause of the CTE. |
| SPEC-3 atomic CTE and existing `ensure_cluster_claim`/`fetch_cluster_for_update` `FOR UPDATE` on `citizen_report_clusters` create deadlock | Low | The atomic CTE locks `cluster_members` rows; `ensure_cluster_claim` locks the `clusters` row. Different tables, different lock queues. Deadlock possible only if another transaction locks `cluster_members` then `clusters` in reverse order — unlikely given the access patterns. |
| SPEC-1 re-anchor `min()` over remaining members misses a concurrently-inserted member | Very Low | Acknowledged phantom exposure (see SPEC-1). Accepting the risk. |
| Integration test for SPEC-3 concurrent survival is flaky | Medium | Use explicit `pg_sleep()` in a second connection to widen the race window deterministically. If the test cannot be made reliable, add a unit test that asserts the SQL text contains the `WITH moved AS (DELETE ... RETURNING)` pattern, and document the race test as manual. |

## 9. Related Documents

- [Architecture Refactor Phase 4](/home/computa/Projects/WIMS-BFP/WIMS-BFP-PROTOTYPE/system-wiki/plans/architecture-refactor-phase-4-civilian-triage-workflow.md)
- [Triage API Reference](/home/computa/Projects/WIMS-BFP/WIMS-BFP-PROTOTYPE/system-wiki/subsystems/references/triage-api-ref.md)
- [Validator Triage Shortcuts](/home/computa/Projects/WIMS-BFP/WIMS-BFP-PROTOTYPE/system-wiki/frontend/validator-triage-shortcuts.md)
- [Civilian Triage HCI Polish](/home/computa/Projects/WIMS-BFP/WIMS-BFP-PROTOTYPE/system-wiki/operations/civilian-triage-hci-polish.md)
- [Database Schema: `citizen_report_clusters` index](/home/computa/Projects/WIMS-BFP/WIMS-BFP-PROTOTYPE/src/postgres-init/35_citizen_report_clusters.sql)
