## Summary

Three FRS compliance items implemented as a standalone batch on top of the merged Admin Hub + FRS Tier 3 work.

| Module | Item | FRS Ref |
|--------|------|---------|
| M2c | User notification of sync success/failure | ISSUE#142 |
| M2b | Full CRUD operations in offline mode | ISSUE#140 |
| M8d | Structured HITL decision buttons + JSONB audit log | M8d |

---

## M2c — Sync Success/Failure Notification (ISSUE#142)

Users are now notified via toast when a background sync completes.

**Files**
- `package.json` — added `sonner` (lightweight toast library)
- `src/frontend/src/app/layout.tsx` — mounted `<Toaster position="top-right" richColors />`
- `src/frontend/src/lib/useAutoSync.ts` — `doSync()` now fires:
  - `toast.success` when all queued incidents sync
  - `toast.warning` on partial success (some synced, some failed — will retry)
  - `toast.error` when all fail
  - no toast when there is nothing to sync

**Tests** — `useAutoSync.test.ts`: success / warning / error / no-toast cases (sonner mocked).

---

## M2b — Full CRUD in Offline Mode (ISSUE#140)

Explicit read-by-id, update, and delete of queued drafts added to the offline store, completing the CRUD set (Create/Read already existed).

**Files** — `src/frontend/src/lib/offlineStore.ts`
- `getQueuedIncident(id)` — read a single queued draft
- `updateQueuedIncident(id, payload)` — edit a not-yet-synced draft (throws if already synced)
- `deleteQueuedIncident(id)` — user-initiated draft deletion

**Tests** — `offlineStore.test.ts`: read-by-id, update preserves id+status, update rejects synced, delete removes item.

---

## M8d — Human-in-the-Loop Decision Audit (M8d)

Replaced the free-text admin action note with structured HITL decision buttons, logged as JSONB with reviewer attribution.

**Migration** — `src/postgres-init/39_hitl_decision.sql`
- Adds `hitl_decision JSONB` column to `wims.security_threat_logs` (idempotent)

**Backend** — `src/backend/api/routes/admin.py`
- `SecurityLogUpdate` schema extended with `action` + `note`
- `PATCH /admin/security-logs/{log_id}` now accepts structured actions:
  - `CONFIRM_THREAT` → "Confirmed Threat"
  - `FALSE_POSITIVE` → "False Positive (Dismissed)"
  - `REQUEST_MORE_INFO` → "More Info Requested"
- Each decision writes `hitl_decision` JSONB (action, note, reviewed_by, reviewed_at)
- `reviewed_by` records the acting admin
- `resolved_at` set only for terminal decisions (Confirm / False Positive); not for Request More Info
- Invalid action → HTTP 400
- Legacy flat-text path preserved for backward compatibility

**Frontend** — `src/frontend/src/app/admin/system/page.tsx`, `src/frontend/src/lib/api/legacy.ts`
- Security log modal now shows three decision buttons instead of a textarea
- "Request More Info" reveals an optional note field
- `updateAdminSecurityLog` signature accepts the structured body

**Tests**
- Backend `test_admin_new_routes.py` — `TestPatchSecurityLogHitl` (6 cases): action mapping, JSONB write, reviewer, resolved_at behavior, invalid action 400
- Frontend `admin-system-hitl.test.tsx` (6 cases): button rendering + dispatch

---

## CI

| Layer | Result |
|-------|--------|
| Backend ruff check + format | All checks passed |
| Backend pytest (security suite) | 41 passed |
| Frontend ESLint | 0 errors |
| Frontend Vitest | 129 passed |

---

## Notes

- `sonner` adds one runtime dependency (small bundle footprint)
- `hitl_decision` migration is idempotent (ADD COLUMN IF NOT EXISTS)
- M2b `updateQueuedIncident` synced-guard is correct but unreachable in practice, since `markSynced` deletes synced rows — kept as a safety check
