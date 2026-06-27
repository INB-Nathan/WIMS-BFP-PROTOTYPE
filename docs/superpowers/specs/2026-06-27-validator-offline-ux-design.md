# National Validator Offline UX Improvements — Design

## Purpose

Improve the National Validator dashboard offline UX so validators clearly understand what actions are queued, what actions remain online-only, how to sync pending work, and which incidents already have a pending queued action. These are small UX improvements that keep the existing offline architecture (read-cache + queued single verification/archive actions) and do not expand offline mutation parity.

## Scope

In scope:

- Derive per-incident queued state from `getPendingIncidents()` filtered by `opType: 'verify' | 'archive_action'` and display queued-action badges on matching table rows.
- Disable conflicting row-level action buttons while a queued action exists for that incident (prevent duplicate queueing).
- Disable or label bulk approve, delete, and forced duplicate "Accept as New" while offline with a clear tooltip/state.
- Add an explicit "Sync queued actions" affordance when `queuedValidatorOpsCount > 0` using `autoSync.syncNow()`.
- Add explicit queued-action feedback banners when an action is queued offline.
- Improve cache-miss empty state on initial load.

Out of scope:

- Offline bulk approve (remains online-only).
- Offline delete (remains online-only).
- Offline forced duplicate "Accept as New" (remains online-only).
- Caching full validator incident detail/history for offline viewing.
- Changes to `offlineValidator.ts`, `syncEngine.ts`, or `offlineStore.ts`.
- Changes to backend APIs.

## Current Problem

The National Validator has correct offline logic but insufficient UX feedback. Four specific issues:

1. **Per-row queued state is invisible.** After queueing an Accept or Archive while offline, the table row still shows actionable Accept/Reject/Archive buttons. A validator could click the same row multiple times offline, queueing duplicate actions.

2. **Online-only actions are not marked while offline.** Bulk approve, delete, and forced duplicate "Accept as New" remain visibly clickable while offline, but they will fail with a network error or never succeed.

3. **No explicit queued feedback.** When an Accept or Archive queues offline, the page silently refreshes via `fetchQueue()` but does not clearly tell the user "This was queued."

4. **No manual sync affordance.** `queuedValidatorOpsCount` is shown as a badge, but there is no button to trigger `syncNow()` when the user comes back online.

## Design

### 1. Derive per-incident queued state

Compute a `Set<number>` of incident IDs that have a pending queued `verify` or `archive_action` op. Derive this from `getPendingIncidents()` alongside the existing `refreshQueuedValidatorOpsCount`.

```
const queuedIncidentIds = new Set(
  pending.filter((op) => {
    const payload = op.payload as { incident_id?: number };
    return payload.incident_id != null;
  }).map((op) => (op.payload as { incident_id: number }).incident_id)
);
```

Pass `queuedIncidentIds` to `IncidentTableRow`.

### 2. Disable conflicting row actions

In `IncidentTableRow`, when an incident ID exists in `queuedIncidentIds`:

- For pending incidents: disable Accept and Reject buttons, show a "Queued" badge instead of or alongside the existing action row.
- For verified/rejected incidents: disable Archive button, show a "Queued" badge.

Disabled buttons should have `title="This action is already queued for sync"` and reduced opacity.

### 3. Mark online-only actions while offline

In `IncidentTableRow` and the bulk-approve button in `ValidatorPageHeader`:

- When `isOnline = false`, disable the Delete button and the bulk-approve button with `title="Go online to bulk approve/delete"`.
- The forced duplicate override path in `ActionModal` (the `force=true` path) should also check offline state and show a message when attempted offline.

No functional change — these paths already use direct `apiFetch()` and cannot queue.

### 4. Explicit sync affordance

In `ValidatorPageHeader`, when `queuedValidatorOpsCount > 0` and the user is online and not already syncing, add a "Sync queued actions" button that calls `syncNow()`.

The existing `autoSync.syncNow` is exposed via the `useAutoSync()` hook already consumed on the validator page.

### 5. Queued-action feedback

When `doArchive`, `doUnarchive`, or `handleDirectAccept` / `submitAction` return `result.queued = true`, set a brief sticky banner or toast indicating the action was queued and will sync when online.

Current behavior: `result.queued` causes a `fetchQueue()` call without feedback.

New behavior: `setSyncNotification('Accept queued — will sync when online.')` (or Reject/Archive/Unarchive respectively).

### 6. Better cache-miss empty state

When the queue is served from cache (`cacheMeta` is set) and it's the initial load, replace the generic "Showing cached data" with a more informative message:
"Showing cached data — this may not reflect the latest server state. Go online to refresh and queue offline actions."

### 7. Per-component changes summary

| Component | Change |
|-----------|--------|
| `page.tsx` | Derive `queuedIncidentIds` from `getPendingIncidents()`, pass to `IncidentTableRow` and `ValidatorPageHeader`; set descriptions per `result.queued` in archive/accept handlers |
| `IncidentTableRow` | Accept `queuedIncidentIds` prop; disable Accept/Reject/Archive when queued; show "Queued" badge; disable Delete while offline |
| `ValidatorPageHeader` | Accept `syncNow` and `isOnline` props; show "Sync queued actions" button when count > 0 && online; disable bulk-approve while offline |
| `ActionModal` | Show offline message when attempted in forced-duplicate path |

No other files require changes.

## Accessibility

- Disabled buttons must have `aria-disabled="true"` where the visual state is `disabled`.
- "Queued" badges should use `aria-label="Queued"`.
- The sync-now button should have `aria-label="Sync queued validator actions"`.

## Testing Plan

Update `src/frontend/src/app/dashboard/validator/page.test.tsx` and `src/frontend/src/components/validator/IncidentTableRow.test.tsx` (if exists) or `operations-board.test.tsx`:

1. **Per-incident queued state:** Mock `getPendingIncidents` to return a verify op for incident X; verify the corresponding row shows a "Queued" indicator and the Accept/Reject buttons are disabled.
2. **Online-only actions while offline:** Mock `networkStatus.isOnline = false`; verify bulk-approve and delete buttons are disabled with correct tooltip.
3. **Sync affordance:** Mock `queuedValidatorOpsCount > 0` and `isOnline = true`; verify "Sync queued actions" button is rendered.
4. **Queued feedback:** Simulate offline Accept; verify a queued feedback banner appears.

## Acceptance Criteria

- When offline, Accept/Reject/Archive/Unarchive queue via existing wrappers and the row shows a "Queued" indicator.
- Previously queued actions on re-login show "Queued" state on matching rows.
- Bulk approve, delete, and force duplicate accept are visibly disabled while offline with clear messaging.
- "Sync queued actions" button is visible when offline ops exist and user is online.
- Cached data state has clearer empty/initial-load messaging.
- 80+ existing validator/offline/sync tests continue to pass.
- Targeted tests for the new UX pass.

## Spec Self-Review

- Placeholder scan: clean.
- Scope check: limited to frontend UX; no backend or offline store changes.
- Ambiguity check: queuedIncidentIds derivation, button labels, and test expectations are explicit.

