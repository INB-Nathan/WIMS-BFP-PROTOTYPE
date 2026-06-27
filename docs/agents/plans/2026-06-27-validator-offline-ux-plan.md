# Implementation Plan: National Validator Offline UX Improvements

## Overview

7 changes to `src/frontend/src/app/dashboard/validator/page.tsx`, `src/frontend/src/components/validator/IncidentTableRow.tsx`, `src/frontend/src/components/validator/ValidatorPageHeader.tsx`, and their tests. No backend, offline store, or sync engine changes.

## Order of Changes

### Step 1: Derive queuedIncidentIds in page.tsx

**File:** `src/frontend/src/app/dashboard/validator/page.tsx`

**Change:** Add new state for queued incident IDs alongside the existing `queuedValidatorOpsCount`:

```ts
const [queuedIncidentIds, setQueuedIncidentIds] = useState<Set<number>>(new Set());
```

In the existing `refreshQueuedValidatorOpsCount` callback, also derive the set:

```ts
const pending = await getPendingIncidents();
setQueuedValidatorOpsCount(
  pending.filter((op) => op.opType === 'verify' || op.opType === 'archive_action').length,
);
setQueuedIncidentIds(new Set(
  pending
    .filter((op) => (op.opType === 'verify' || op.opType === 'archive_action') && (op.payload as { incident_id?: number })?.incident_id != null)
    .map((op) => (op.payload as { incident_id: number }).incident_id)
));
```

**Prop pass:** Pass `queuedIncidentIds={queuedIncidentIds}` and `onSyncNow={autoSync.syncNow}` to `ValidatorPageHeader`. Pass `queuedIncidentIds={queuedIncidentIds}` and `isOnline={networkStatus.isOnline}` down to each `IncidentTableRow`.

### Step 2: IncidentTableRow — queued badge + disabled conflicting actions

**File:** `src/frontend/src/components/validator/IncidentTableRow.tsx`

**Change:**
1. Add `queuedIncidentIds: Set<number>` and `isOnline: boolean` to the Props interface.
2. Compute `const isQueued = queuedIncidentIds.has(inc.incident_id);` at the top of the component body.
3. For pending incidents: when `isQueued`, replace the entire action cell content with a single "Queued" badge (amber pill with "Queued" text). This prevents any conflicting second action from being queued for the same incident.
4. For archived view: when `isQueued`, replace the action cell with a "Queued" badge instead of Archive/Delete buttons.
5. For verified/rejected: when `isQueued`, replace the action cell with a "Queued" badge instead of the Archive button.
6. For Delete button (archived view) on non-queued rows: when `!isOnline`, add `disabled` + `title="Go online to delete"`.
7. Bulk approve offline handling is done in `ValidatorPageHeader`.

### Step 3: ValidatorPageHeader — sync affordance + offline controls

**File:** `src/frontend/src/components/validator/ValidatorPageHeader.tsx`

**Change:**
1. Add `onSyncNow?: () => void` to the Props interface.
2. After the existing `queuedValidatorOpsCount > 0` badge span, add a "Sync queued actions" button when `queuedValidatorOpsCount > 0 && isOnline && !syncing`.
3. For the Bulk Approve button: when `!isOnline`, add `disabled` + `title="Go online to bulk approve"`.

### Step 4: Queued-action feedback banners

**File:** `src/frontend/src/app/dashboard/validator/page.tsx`

**Change:** Each handler (doArchive, doUnarchive, handleDirectAccept, submitAction) already has an `if (result.queued) { await fetchQueue(); return; }` block. Modify that existing branch to set a specific syncNotification:

- `doArchive` (page.tsx:277): `setSyncNotification('Archive queued — will sync when online.');`
- `doUnarchive` (page.tsx:292): `setSyncNotification('Unarchive queued — will sync when online.');`
- `handleDirectAccept` (page.tsx:322): `setSyncNotification('Accept queued — will sync when online.');`
- `submitAction` (page.tsx:550): uses `effectiveAction` variable, so: `` setSyncNotification(`${effectiveAction === 'accept' ? 'Accept' : effectiveAction === 'reject' ? 'Reject' : effectiveAction === 'accept_replace' ? 'Accept (replace)' : 'Action'} queued — will sync when online.`); ``

Reuses the existing `syncNotification` state and green `StickyBanner` already rendering at page.tsx:645-660.

### Step 5: Cache-messaging text

**File:** `src/frontend/src/app/dashboard/validator/page.tsx`

**Change:** The cache banner (page.tsx:662-679) renders text as children, not via a `message` prop. Edit the child text to:

```
Showing cached data from {cacheMeta.cachedAt ? new Date(cacheMeta.cachedAt).toLocaleTimeString() : 'earlier'}. This may not reflect the latest server state. Go online to refresh and queue offline actions.
```

### Step 6: Update page.test.tsx

**File:** `src/frontend/src/app/dashboard/validator/page.test.tsx`

Add test cases in the existing `describe('Validator dashboard page — offline wiring')` block:

1. **Queued badge on row:** Mock `getPendingIncidents` to return a verify op with `incident_id` matching an incident in the queue response. Verify a "Queued" element/text exists.
2. **Sync affordance:** Mock `queuedValidatorOpsCount > 0` and `networkStatus.isOnline = true`. Verify "Sync queued actions" button is rendered.
3. **Bulk approve disabled offline:** Mock `networkStatus.isOnline = false`. Verify bulk-approve button is disabled.
4. **Delete disabled offline:** Mock `networkStatus.isOnline = false`. In archived view, verify Delete button has `disabled` attribute.

### Step 7: Add IncidentTableRow tests

Create `src/frontend/src/components/validator/__tests__/IncidentTableRow.test.tsx` with:
1. **Render queued badge:** Pass `queuedIncidentIds` containing the incident's ID. Verify Accept/Reject buttons are replaced by "Queued" text.
2. **Disable delete offline:** Pass `isOnline={false}`. Verify Delete button has `disabled` attribute.

## Execution Order

1. `ValidatorPageHeader.tsx` — add sync button + offline disable (self-contained)
2. `IncidentTableRow.tsx` — add queued/offline logic
3. `page.tsx` — wire queuedIncidentIds, pass props, add feedback, update cache text
4. `page.test.tsx` — add targeted tests
5. `IncidentTableRow.test.tsx` — new component tests
6. Run lint and tests on all changed files

## Validation

```bash
npx eslint src/app/dashboard/validator/page.tsx src/components/validator/ValidatorPageHeader.tsx src/components/validator/IncidentTableRow.tsx
npx vitest run src/app/dashboard/validator/page.test.tsx
npx vitest run src/lib/__tests__/offlineValidator.test.ts src/lib/__tests__/syncEngine.test.ts
```
