# Implementation Plan

## Goal
Improve the regional encoder offline experience by fixing two P0 state bugs first, then adding clearer per-incident offline status, a unified offline work center, better conflict resolution UX, global cancel/withdraw controls, and lower-priority progress/navigation/mobile polish.

## Tasks

### Item 1: Clear `offline_enabled` on encoder/user switch (P0)
1. **Export or centralize the offline-mode localStorage clear helper**
   - File: `src/frontend/src/lib/offlineEnable.ts`
   - Changes: Ensure `clearOfflineModeEnabled()` remains exported and is safe to call from non-component library code. If circular imports become a risk, move `OFFLINE_ENABLED_KEY`, `OFFLINE_BANNER_DISMISSED_KEY`, `isOfflineModeEnabled()`, `markOfflineModeEnabled()`, and `clearOfflineModeEnabled()` into a small new `src/frontend/src/lib/offlineModeFlags.ts`, then update `offlineEnable.ts` and `OfflineModeManager.tsx` imports.
   - Acceptance: `clearOfflineModeEnabled()` or the moved equivalent removes both `wims:offline_enabled` and `wims:offline_banner_dismissed` and has no dependency on React/browser-only modules other than guarded `localStorage` access.
2. **Clear offline mode flag when active offline user changes**
   - File: `src/frontend/src/lib/offlineStore.ts`
   - Changes: In `setActiveOfflineUser(userId)`, inside the `if (prev && prev !== userId)` branch, call `clearOfflineModeEnabled()` after/before `wipeAllOfflineData()` so the new user sees the offline setup prompt again.
   - Acceptance: Reading `setActiveOfflineUser()` shows `clearOfflineModeEnabled()` is called only on different-user switch, not on same-user relogin.
3. **Clear offline mode flag during manual offline-data clear**
   - File: `src/frontend/src/lib/offlineStore.ts`
   - Changes: In `clearAllOfflineData()`, also call `clearOfflineModeEnabled()` so manual clearing does not leave the UI in a false enabled state.
   - Acceptance: Reading `clearAllOfflineData()` shows it removes active user key and clears offline mode flags.
4. **Add regression tests for flag clearing**
   - File: `src/frontend/src/lib/__tests__/offlineStore.logout.test.ts` or new `src/frontend/src/lib/__tests__/offlineModeFlags.test.ts`
   - Changes: Add tests that seed `localStorage` with `wims:offline_enabled=true` and `wims:offline_banner_dismissed=true`, call `setActiveOfflineUser('user-A')`, then `setActiveOfflineUser('user-B')`, and assert both flags are removed. Add same-user test proving flags survive `setActiveOfflineUser('user-A')` followed by same user.
   - Acceptance: Test fails before the code change and passes after.

**Passing criteria**
1. `setActiveOfflineUser()` clears `wims:offline_enabled` when `prev && prev !== userId`.
2. `setActiveOfflineUser()` does not clear `wims:offline_enabled` for same-user relogin.
3. `clearAllOfflineData()` clears `wims:offline_enabled` and `wims:offline_banner_dismissed`.
4. A Vitest test covers different-user switch, same-user relogin, and manual clear behavior.
5. `cd src/frontend && npx vitest run src/frontend/src/lib/__tests__/offlineStore.logout.test.ts` or the exact updated test file passes.

---

### Item 2: Split sync status counts and fix hidden conflicts/failed work (P0)
1. **Add a typed offline queue-count API**
   - File: `src/frontend/src/lib/offlineStore.ts`
   - Changes: Add `export interface OfflineOpsCounts { pendingCount: number; failedCount: number; conflictCount: number; totalActionableCount: number; }` and `export async function getOfflineOpsCounts(encoderId: string): Promise<OfflineOpsCounts>`. Count `pendingCount` as `syncStatus === 'pending' || syncStatus === 'error'`; `failedCount` as `syncStatus === 'failed'`; `conflictCount` as `syncStatus === 'conflict'`; exclude `draft`, `synced`, and `syncing` unless a product decision explicitly wants syncing in `pendingCount`.
   - Acceptance: `getOfflineOpsCounts()` exists and uses mutually exclusive count buckets.
2. **Preserve or deprecate old count API safely**
   - File: `src/frontend/src/lib/offlineStore.ts`
   - Changes: Either update `getPendingOpsCount()` to return only pending+error, or keep it for compatibility and switch all regional encoder UI to `getOfflineOpsCounts()`. Prefer updating comments so it no longer claims conflict/failed are included.
   - Acceptance: No UI relies on `getPendingOpsCount()` to infer conflicts or failures.
3. **Update auto-sync state model**
   - File: `src/frontend/src/lib/useAutoSync.ts`
   - Changes: Import `getOfflineOpsCounts()`; replace `refreshPendingCount()` with `refreshOpsCounts()` that sets `pendingCount`, `failedCount`, and `conflictCount` from IndexedDB. Add `failedCount` to `AutoSyncState`. After every sync, refresh all counts instead of incrementing `conflictCount` manually.
   - Acceptance: `AutoSyncState` includes `pendingCount`, `failedCount`, and `conflictCount`; all three are populated from IndexedDB.
4. **Update `SyncStatusBar` to render independent statuses**
   - File: `src/frontend/src/components/SyncStatusBar.tsx`
   - Changes: Read `failedCount` from `useAutoSync()`. Render conflict and failed callouts even when `pendingCount > 0`. Suggested order: auth failure > syncing > failed/conflict actionable row > queued row > all synced. Provide links: conflicts to `/dashboard/regional/conflicts`, failed/pending to the Offline Work center once Item 4 exists; before Item 4 use `/dashboard/regional` or no link with clear text.
   - Acceptance: Conflicts are visible whenever `conflictCount > 0`, regardless of pending count.
5. **Update tests/mocks for new state shape**
   - Files: `src/frontend/src/lib/__tests__/useAutoSync.test.ts`, `src/frontend/src/lib/__tests__/SyncStatusBar.test.tsx`, and any tests mocking `useAutoSync()` under `src/frontend/src/app/**`
   - Changes: Add `failedCount` and `conflictCount` to mocks. Add tests for `pending=2, conflict=1` showing both queued and conflict indicators; `failed=1` showing failed retry/action indicator; `pending=0, conflict=2` link to conflicts page.
   - Acceptance: Existing and new Vitest tests pass.

**Passing criteria**
1. `getOfflineOpsCounts()` returns separate `pendingCount`, `failedCount`, and `conflictCount` values.
2. `pendingCount` excludes `conflict` and `failed` ops.
3. `useAutoSync()` exposes `failedCount` and refreshes all count buckets from IndexedDB after sync.
4. `SyncStatusBar` shows a conflict callout/link when `conflictCount > 0` even if `pendingCount > 0`.
5. `SyncStatusBar` shows failed work distinctly when `failedCount > 0`.
6. `cd src/frontend && npx vitest run src/lib/__tests__/useAutoSync.test.ts src/lib/__tests__/SyncStatusBar.test.tsx` passes after path correction if needed.

---

### Item 3: Per-incident pending-operation overlays for server incidents (P1)
1. **Create a helper to summarize queued op state by incident**
   - New File: `src/frontend/src/lib/regionalOfflineStatus.ts`
   - Changes: Add helper types such as `RegionalIncidentOfflineStatus = { serverId: number; labels: string[]; severity: 'pending' | 'failed' | 'conflict'; operations: OfflineOperation[]; localIds: string[] }`. Add `buildOfflineStatusByServerId(ops: OfflineOpDecrypted[]): Map<number, RegionalIncidentOfflineStatus>`. Use `op.serverId` first; fallback to numeric `payload.incident_id` for archive/delete/submit payloads.
   - Acceptance: Helper maps pending update/submit/delete/archive_action operations to their server incident ID.
2. **Load all non-draft actionable ops for dashboard card overlays**
   - File: `src/frontend/src/app/dashboard/regional/page.tsx`
   - Changes: Existing dashboard already calls `getPendingOps(encoderId)` for pending/error. Extend to also fetch `getConflictOps()` and `getFailedOps()` or use a new `getActionableOps()` helper. Build `offlineStatusByServerId` with `useMemo` and pass each incident's status into `IncidentCard`.
   - Acceptance: Dashboard state includes statuses for pending/error/conflict/failed ops, not just offline-created local cards.
3. **Render badge/overlay on server incident cards**
   - File: `src/frontend/src/components/regional/IncidentCard.tsx`
   - Changes: Add optional prop `offlineStatus?: RegionalIncidentOfflineStatus`. Render badges near `StatusBadge`, e.g. `Update queued`, `Submit queued`, `Archive queued`, `Delete queued`, `Conflict`, `Sync failed`. Use distinct colors: amber pending, orange conflict, red failed. Ensure badge text is accessible and does not replace verification status.
   - Acceptance: Incident cards show overlay badges for matching server incidents while preserving existing `StatusBadge` and `Go online to view` badge.
4. **Handle archive buttons during queued archive state**
   - File: `src/frontend/src/components/regional/IncidentCard.tsx`
   - Changes: If `offlineStatus.operations` includes `archive_action`, disable archive/unarchive button or relabel as `Archive queued`/`Restore queued` to prevent duplicate queued archive actions.
   - Acceptance: User cannot enqueue duplicate archive/unarchive for same visible incident without explicit future product decision.
5. **Add dashboard/card tests**
   - Files: `src/frontend/src/components/regional/IncidentCard.test.tsx` and/or `src/frontend/src/app/dashboard/regional/page.test.tsx`
   - Changes: Test card renders each badge type from `offlineStatus`. Test dashboard passes status for a server incident with pending update op.
   - Acceptance: Tests verify server incident with `serverId=42` and pending update op shows `Update queued`.

**Passing criteria**
1. A helper maps offline ops to server incident IDs for update, submit, delete, and archive_action.
2. Dashboard combines pending/error, conflict, and failed ops before building card overlays.
3. Server incident cards display `Update queued`, `Submit queued`, `Delete queued`, `Archive queued`/`Restore queued`, `Conflict`, or `Sync failed` as applicable.
4. Existing local create cards with `PENDING_SYNC` still render as before.
5. A test asserts a server incident card shows `Update queued` when an update op for its server ID exists.

---

### Item 4: Build unified “Offline Work” center (P1)
1. **Choose route over modal for deep-linking and mobile**
   - New File: `src/frontend/src/app/dashboard/regional/offline-work/page.tsx`
   - Changes: Implement as a dedicated page rather than modal to support refresh, direct links from `SyncStatusBar`, sidebar badges, and mobile layout.
   - Acceptance: `/dashboard/regional/offline-work` route exists and is regional encoder protected by existing dashboard layout/auth patterns.
2. **List all offline work buckets**
   - File: `src/frontend/src/app/dashboard/regional/offline-work/page.tsx`
   - Changes: Load `getDraftOps()`, `getPendingOps()`, `getConflictOps()`, `getFailedOps()` for current encoder. Render tabs or sections: Drafts, Queued, Failed, Conflicts. Show operation type, incident/server/local ID, created/updated time, last error, retry count, and primary action.
   - Acceptance: Page shows counts for each bucket and an empty state for each empty bucket.
3. **Add primary actions**
   - File: `src/frontend/src/app/dashboard/regional/offline-work/page.tsx`
   - Changes: Draft row: open local draft/detail/edit path. Queued row: open incident if possible and allow cancel via Item 6. Failed row: `Retry now` by calling `syncPendingIncidents(encoderId, { bypassBackoff: true })` after resetting failed op if needed, or initially link to detail with clear text. Conflict row: link to `/dashboard/regional/conflicts`.
   - Acceptance: Each row has a deterministic action, and destructive actions require confirmation.
4. **Link from dashboard/header/status bar**
   - Files: `src/frontend/src/components/SyncStatusBar.tsx`, `src/frontend/src/app/dashboard/regional/page.tsx`, optionally `src/frontend/src/components/regional/RegionalPageHeader.tsx`
   - Changes: Add `Offline Work` button/link with total actionable count badge (`pending + failed + conflict + draft count if loaded`). Use this route for failed and pending links in `SyncStatusBar`.
   - Acceptance: Regional encoder can navigate to Offline Work from dashboard without knowing URL.
5. **Add tests**
   - New File: `src/frontend/src/app/dashboard/regional/offline-work/page.test.tsx`
   - Changes: Mock offlineStore and auth; assert sections/counts render, conflict link exists, queued row action exists, empty states render.
   - Acceptance: Route component tests pass.

**Passing criteria**
1. `/dashboard/regional/offline-work` renders Drafts, Queued, Failed, and Conflicts sections or tabs.
2. Each section displays an accurate count from offlineStore APIs.
3. Conflicts link to `/dashboard/regional/conflicts`.
4. Dashboard or regional layout includes a visible `Offline Work` entry with badge when any bucket is non-zero.
5. Tests cover non-empty and empty Offline Work states.

---

### Item 5: Improve existing conflict resolution UX (P1)
1. **Retain existing conflict route and resolution APIs**
   - Files: `src/frontend/src/app/dashboard/regional/conflicts/page.tsx`, `src/frontend/src/components/IncidentConflictMergePanel.tsx`
   - Changes: Do not replace conflict persistence or `resolveConflictOp()` behavior. Improve UI only unless bugs are found.
   - Acceptance: Existing keep-local/use-server/discard flows still call existing offlineStore functions.
2. **Add field grouping to merge panel**
   - File: `src/frontend/src/components/IncidentConflictMergePanel.tsx`
   - Changes: Replace flat `MERGE_FIELDS` rendering with grouped metadata, e.g. Incident Basics, Location, Impact/Damage, Casualties, Narrative, Contacts, Complex Details. Only render groups with at least one conflicting field.
   - Acceptance: Conflict fields are visually grouped by section headings.
3. **Add smart default choices**
   - File: `src/frontend/src/components/IncidentConflictMergePanel.tsx`
   - Changes: Initial choices should select `server` when client value is empty and server value is non-empty; select `client` when client value is non-empty and server empty; otherwise default to client to preserve encoder edits.
   - Acceptance: Unit test proves empty client/non-empty server defaults to server.
4. **Add quick-select buttons**
   - File: `src/frontend/src/components/IncidentConflictMergePanel.tsx`
   - Changes: Add `Use all my changes` and `Use all server values` buttons. Optional group-level quick-select buttons if complexity is acceptable.
   - Acceptance: Clicking buttons updates all field choices and merged submission respects them.
5. **Improve responsive/accessibility behavior**
   - File: `src/frontend/src/components/IncidentConflictMergePanel.tsx`
   - Changes: On small screens stack client/server choices vertically instead of two columns. Add `role="dialog"`, `aria-modal="true"`, labeled heading, clear focusable buttons, and visible selected states.
   - Acceptance: Panel is usable at mobile widths and has dialog semantics.
6. **Add tests for merge behavior**
   - New or existing file: `src/frontend/src/components/__tests__/IncidentConflictMergePanel.test.tsx`
   - Changes: Test grouped rendering, smart defaults, quick-select all client/server, and final merged payload including `force_update` and absence of `client_updated_at`.
   - Acceptance: Tests pass.

**Passing criteria**
1. Conflict panel renders section headings and only groups with actual conflicts.
2. Empty client values default to server when server has data.
3. `Use all my changes` selects client for every conflict field.
4. `Use all server values` selects server for every conflict field.
5. Submitted merged payload has `force_update: true` and excludes `client_updated_at`.
6. Panel has `role="dialog"` and `aria-modal="true"`.

---

### Item 6: Dashboard/global cancel/withdraw queued operations (P1)
1. **Create a reusable cancellation helper**
   - New File: `src/frontend/src/lib/offlineOpActions.ts`
   - Changes: Add `cancelOfflineOperation(op, { syncing }: { syncing: boolean })` or narrower helpers. If op is `create`, call `deleteOfflineOpCascade(localId)` to remove linked submit/update ops. Otherwise call `deleteOfflineOp(localId)`. Reject/throw if sync is currently active or op.syncStatus is `syncing`.
   - Acceptance: Helper prevents cancellation of currently syncing ops and cascades create ops.
2. **Expose cancel controls in Offline Work center**
   - File: `src/frontend/src/app/dashboard/regional/offline-work/page.tsx`
   - Changes: Add `Cancel queued change` button for queued/failed ops where safe. Use confirmation dialog explaining local data loss/behavior. Refresh lists after success.
   - Acceptance: User can cancel queued update/archive/submit/delete from Offline Work center.
3. **Expose cancel/withdraw on dashboard card overlays**
   - Files: `src/frontend/src/app/dashboard/regional/page.tsx`, `src/frontend/src/components/regional/IncidentCard.tsx`
   - Changes: For incidents with `offlineStatus`, provide a small action menu or secondary button to cancel queued operation(s). For multiple ops, link to Offline Work rather than trying to cancel inline.
   - Acceptance: Single pending op on a server incident has an obvious cancel path; multiple ops link to Offline Work.
4. **Race protection with auto-sync**
   - Files: `src/frontend/src/lib/useAutoSync.ts`, `src/frontend/src/app/dashboard/regional/offline-work/page.tsx`, `src/frontend/src/app/dashboard/regional/page.tsx`
   - Changes: Use `syncing` from `useAutoSync()` to disable cancel buttons while syncing. Re-read op before delete if helper can access current store state.
   - Acceptance: Cancel buttons are disabled or blocked during active sync.
5. **Add tests**
   - Files: `src/frontend/src/lib/__tests__/offlineOpActions.test.ts`, `src/frontend/src/app/dashboard/regional/offline-work/page.test.tsx`, optional dashboard card test
   - Changes: Test create cascades, update deletes single op, syncing op is not deleted, UI asks confirmation.
   - Acceptance: Tests pass.

**Passing criteria**
1. Cancellation of `create` ops uses `deleteOfflineOpCascade()`.
2. Cancellation of non-create ops uses `deleteOfflineOp()`.
3. Cancellation is disabled or rejected while `useAutoSync().syncing` is true or the op status is `syncing`.
4. UI shows a destructive confirmation before deleting queued work.
5. Offline Work page refreshes counts after cancellation.

---

### Item 7: Improve enable-offline-mode progress feedback and cancellation (P2)
1. **Add abort support to offline enable flow**
   - File: `src/frontend/src/lib/offlineEnable.ts`
   - Changes: Extend `enableOfflineMode()` options with `signal?: AbortSignal`. Check `signal.aborted` before/after major steps and inside detail loop. Where fetch wrappers do not accept signals, at least stop before the next detail request.
   - Acceptance: Aborting exits with `{ ok: false, error: 'Offline setup cancelled.' }` or throws a controlled cancellation handled by UI.
2. **Add richer progress data**
   - File: `src/frontend/src/lib/offlineEnable.ts`
   - Changes: Extend `OfflineEnableProgress` with optional `phase`, `currentLabel`, and `estimatedRemainingMs` if feasible. Keep backward compatibility for `step`, `done`, `total`.
   - Acceptance: Existing `OfflineModeManager` still compiles, and new fields are displayed where available.
3. **Update OfflineModeManager UI**
   - File: `src/frontend/src/components/regional/OfflineModeManager.tsx`
   - Changes: Show a determinate progress bar when `total > 1`, current phase, cached counts, and a Cancel button during setup. Cancel button aborts the controller and resets `busy`.
   - Acceptance: User can cancel setup without leaving busy spinner stuck.
4. **Tests**
   - Files: `src/frontend/src/components/regional/OfflineModeManager.test.tsx` or existing profile tests
   - Changes: Test progress display and cancellation behavior with mocked `enableOfflineMode()`.
   - Acceptance: Tests pass.

**Passing criteria**
1. `enableOfflineMode()` accepts an `AbortSignal` or equivalent cancellation mechanism.
2. Detail caching loop stops after cancellation.
3. Offline setup UI has a Cancel button while busy.
4. Cancelled setup does not call `markOfflineModeEnabled()`.

---

### Item 8: Background sync progress indicator (P2)
1. **Add sync progress callback support**
   - File: `src/frontend/src/lib/syncEngine.ts`
   - Changes: Extend `syncPendingIncidents(encoderId, options?)` options with `onProgress?: (p: { done: number; total: number; currentOperation?: string }) => void`. Call before/after each op in the pending ops loop.
   - Acceptance: Existing callers continue to work without passing `onProgress`.
2. **Surface progress in `useAutoSync()`**
   - File: `src/frontend/src/lib/useAutoSync.ts`
   - Changes: Add `syncProgress` to `AutoSyncState`, set it during `doSync()`, clear after completion/abort.
   - Acceptance: `useAutoSync()` returns progress while syncing.
3. **Render progress bar**
   - File: `src/frontend/src/components/SyncStatusBar.tsx`
   - Changes: When syncing and progress total > 0, render `Syncing X of Y…` and a progress bar.
   - Acceptance: SyncStatusBar has visible determinate progress during sync.
4. **Tests**
   - Files: `src/frontend/src/lib/__tests__/syncEngine.test.ts`, `src/frontend/src/lib/__tests__/useAutoSync.test.ts`, `src/frontend/src/lib/__tests__/SyncStatusBar.test.tsx`
   - Changes: Test callbacks and UI output.
   - Acceptance: Tests pass.

**Passing criteria**
1. Sync engine emits progress for each queued op.
2. `useAutoSync()` exposes current sync progress.
3. `SyncStatusBar` displays `X of Y` during active sync.
4. Existing sync behavior and result counts remain unchanged.

---

### Item 9: Expand offline import support (P2)
1. **Audit current import offline behavior before changing**
   - File: `src/frontend/src/app/afor/import/page.tsx`
   - Changes: Read existing flow around preview rows and `queueOfflineOp()` before implementation. Identify which steps require network/reference data/geocoding.
   - Acceptance: Implementation issue/notes explicitly list current import actions that already work offline and those that do not.
2. **Cache required import reference data**
   - Files: `src/frontend/src/lib/offlineEnable.ts`, `src/frontend/src/lib/offlineStore.ts`, import page
   - Changes: Ensure region/province/city/fire-station reference data needed for import validation is cached per user/region during offline setup using `reference-cache`.
   - Acceptance: Import validation can use cached reference data offline.
3. **Queue import rows with visible partial-failure handling**
   - File: `src/frontend/src/app/afor/import/page.tsx`
   - Changes: Allow valid parsed rows to queue create ops offline. Keep invalid rows in preview with clear reasons. Avoid network-only geocoding while offline or mark coordinate fields unresolved.
   - Acceptance: Offline import queues valid rows and does not lose invalid rows.
4. **Tests**
   - File: `src/frontend/src/app/afor/import/__tests__/page.test.tsx`
   - Changes: Add offline import tests with valid and invalid preview rows.
   - Acceptance: Tests pass.

**Passing criteria**
1. Offline import uses cached reference data and does not require live API for validation paths selected for P2.
2. Valid rows can be queued as create ops while offline.
3. Invalid rows remain visible with validation errors.
4. UI clearly states map/geocoding may need online correction if coordinates/address cannot be resolved offline.

---

### Item 10: Global nav badge for offline work (P2)
1. **Expose count source for navigation**
   - Files: `src/frontend/src/lib/useAutoSync.ts` or new `src/frontend/src/lib/useOfflineWorkCounts.ts`
   - Changes: Prefer a small hook `useOfflineWorkCounts()` that reads `getOfflineOpsCounts()` and optionally `getDraftOps()` for current encoder. Avoid duplicating IndexedDB polling in sidebar and SyncStatusBar.
   - Acceptance: Hook returns stable counts for pending, failed, conflict, drafts, total.
2. **Update sidebar/topbar**
   - Files: `src/frontend/src/components/Sidebar.tsx`, `src/frontend/src/components/Header.tsx`
   - Changes: For `REGIONAL_ENCODER`/`ENCODER`, show badge near dashboard/offline work navigation item. Badge should not render for other roles.
   - Acceptance: Encoder sees count badge; validator/admin roles do not.
3. **Tests**
   - Files: `src/frontend/src/components/Sidebar.test.tsx`, optional `Header.test.tsx`
   - Changes: Mock hook and assert badge visibility/role scoping.
   - Acceptance: Tests pass.

**Passing criteria**
1. Encoder sidebar/topbar shows total offline work count when count > 0.
2. Badge links or navigates to `/dashboard/regional/offline-work` where applicable.
3. Non-encoder roles do not see encoder offline-work badge.
4. Tests cover encoder and non-encoder roles.

---

### Item 11: Mobile and accessibility polish for offline surfaces (P2)
1. **Audit offline surfaces at mobile widths**
   - Files: `src/frontend/src/components/SyncStatusBar.tsx`, `src/frontend/src/components/regional/OfflineModeManager.tsx`, `src/frontend/src/components/regional/IncidentCard.tsx`, `src/frontend/src/components/IncidentConflictMergePanel.tsx`, `src/frontend/src/app/dashboard/regional/offline-work/page.tsx`
   - Changes: Check layouts for 320px/375px widths. Fix wrapping, overflow, tap target size, and sticky action bars.
   - Acceptance: No horizontal overflow in main offline workflows at mobile widths.
2. **Add accessible labels and status announcements**
   - Files: same as above
   - Changes: Add `aria-live="polite"` to sync/progress statuses, explicit labels for badges/buttons, keyboard-accessible card actions, focus management for dialogs.
   - Acceptance: Screen readers can identify status, count, and action purpose.
3. **Tests where feasible**
   - Files: component tests for affected components
   - Changes: Assert key ARIA roles/labels and keyboard behavior.
   - Acceptance: Tests pass.

**Passing criteria**
1. Offline status/progress components use `aria-live` or equivalent status semantics.
2. Destructive/cancel actions have explicit accessible names.
3. Conflict dialog traps/returns focus or at minimum exposes `role="dialog"`, `aria-modal`, and labeled heading.
4. Component tests assert key roles/labels for SyncStatusBar, Offline Work, and Conflict Merge Panel.

## Files to Modify
- `src/frontend/src/lib/offlineStore.ts` - clear offline flag on user switch/manual clear; add separated offline op counts.
- `src/frontend/src/lib/offlineEnable.ts` - keep/export flag helpers; later add abort/progress improvements.
- `src/frontend/src/lib/useAutoSync.ts` - consume separated counts, expose failed/conflict/progress state.
- `src/frontend/src/components/SyncStatusBar.tsx` - render separate queued/failed/conflict states and later progress.
- `src/frontend/src/app/dashboard/regional/page.tsx` - load actionable ops and pass per-card offline status; add Offline Work link/cancel hooks.
- `src/frontend/src/components/regional/IncidentCard.tsx` - render per-incident offline badges/actions.
- `src/frontend/src/app/dashboard/regional/conflicts/page.tsx` - improve navigation/flow around conflict resolution as needed.
- `src/frontend/src/components/IncidentConflictMergePanel.tsx` - group fields, smart defaults, quick-select, responsive/ARIA polish.
- `src/frontend/src/components/regional/OfflineModeManager.tsx` - progress/cancel UI for offline setup.
- `src/frontend/src/components/Sidebar.tsx` - global offline work badge for encoders.
- `src/frontend/src/components/Header.tsx` - optional topbar badge if sidebar is insufficient.
- `src/frontend/src/app/afor/import/page.tsx` - P2 offline import expansion.
- Existing tests under `src/frontend/src/lib/__tests__/`, `src/frontend/src/components/**/__tests__/`, and `src/frontend/src/app/**/__tests__/` - update mocks and add coverage.

## New Files
- `src/frontend/src/lib/regionalOfflineStatus.ts` - maps offline ops to server incident card status badges.
- `src/frontend/src/lib/offlineOpActions.ts` - reusable safe cancellation/withdraw helper for queued operations.
- `src/frontend/src/app/dashboard/regional/offline-work/page.tsx` - unified Offline Work center route.
- `src/frontend/src/app/dashboard/regional/offline-work/page.test.tsx` - tests for Offline Work center.
- `src/frontend/src/components/__tests__/IncidentConflictMergePanel.test.tsx` - tests for conflict panel improvements, if no suitable existing test file exists.
- `src/frontend/src/lib/__tests__/offlineOpActions.test.ts` - tests for queued operation cancellation helper.
- Optional `src/frontend/src/lib/offlineModeFlags.ts` - only if needed to avoid circular imports when sharing localStorage flag helpers.
- Optional `src/frontend/src/lib/useOfflineWorkCounts.ts` - shared count hook for sidebar/header/offline work badge.

## Dependencies
1. Item 1 is independent and should be implemented first.
2. Item 2 should be implemented before Items 3, 4, 6, 8, and 10 because they need accurate pending/failed/conflict counts.
3. Item 3 depends on Item 2 if it uses the same separated status model; it can be implemented before Item 4.
4. Item 4 depends on Item 2 counts and benefits from Item 6 actions, but the page shell can land before cancellation actions.
5. Item 5 is mostly independent after Item 2, but conflict links/counts from Item 2 should be fixed first.
6. Item 6 depends on Item 4 for the global management UI and on Item 3 if inline card cancellation is included.
7. Items 7 and 8 are independent P2 enhancements but should not start until P0 count/flag fixes are stable.
8. Item 9 depends on a separate audit of current import behavior and cached reference data assumptions.
9. Item 10 depends on Item 2 and preferably Item 4 route existing.
10. Item 11 should be applied across completed P1/P2 UI surfaces, not before they exist.

## Risks
- **Circular imports:** Importing `clearOfflineModeEnabled()` from `offlineEnable.ts` into `offlineStore.ts` may create or risk a cycle because `offlineEnable.ts` imports offline-aware API wrappers that import `offlineStore.ts`. If that happens, create `offlineModeFlags.ts` and import it from both modules.
- **Count semantics drift:** Existing tests/mocks assume `pendingCount` means all unsynced work. Update comments and tests so `pendingCount` means syncable pending/error only, while conflict/failed have separate fields.
- **Sync race:** Cancel actions can conflict with active sync. Disable during `syncing` and re-read op status before deletion.
- **Multiple queued ops for one incident:** A server incident may have update + submit or archive + failed operations. Card overlay should summarize and link to Offline Work for detailed management rather than overcrowding cards.
- **Offline import scope:** Import may rely on network-only parsing/geocoding/reference APIs. Do an audit before committing to full offline import behavior.
- **Mobile complexity:** Conflict panel field grouping and side-by-side diffs can still be dense. Prefer stacked mobile layout and progressive disclosure.
- **Tests with IndexedDB/localStorage:** Existing offlineStore tests likely use fake-indexeddb and localStorage mocks. Reuse their setup to avoid brittle tests.

## Validation Strategy
- Run targeted Vitest suites after each item rather than waiting until all work is complete.
- Minimum P0 verification commands:
  - `cd src/frontend && npx vitest run src/lib/__tests__/offlineStore.logout.test.ts src/lib/__tests__/useAutoSync.test.ts src/lib/__tests__/SyncStatusBar.test.tsx`
  - If paths differ, run the exact updated test files.
- After P1 UI work:
  - `cd src/frontend && npx vitest run src/components/regional/IncidentCard.test.tsx src/app/dashboard/regional/offline-work/page.test.tsx src/components/__tests__/IncidentConflictMergePanel.test.tsx`
- Before final merge:
  - `cd src/frontend && npm run lint`
  - `cd src/frontend && npm run build` with required OIDC/Next env vars set; if env vars are unavailable, document the known `OIDC Authority URL is undefined` prerender blocker and rely on targeted tests plus TypeScript compilation result.

## Acceptance Checklist for Verifier
- P0 is not complete until Item 1 and Item 2 passing criteria all pass.
- P1 is not complete until card overlays, Offline Work center, conflict panel improvements, and cancel/withdraw controls each have tests and visible UI paths.
- P2 items should be implemented only after P0/P1 or explicitly split into separate follow-up issues.
- Any implementation that changes API contracts, offlineStore schema version, or sync operation semantics must include migration/compatibility notes and tests.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Produced a scoped implementation plan only; no application code changes were made."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Plan names exact files, ordered tasks, dependencies, risks, and binary passing criteria for every requested P0/P1/P2 item."
    }
  ],
  "changedFiles": [
    "plan.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read src/frontend/src/lib/offlineStore.ts around setActiveOfflineUser/getPendingOpsCount",
      "result": "passed",
      "summary": "Confirmed current user-switch behavior and conflated pending/conflict/failed count implementation."
    },
    {
      "command": "grep SyncStatusBar/pendingCount/conflictCount usages under src/frontend/src",
      "result": "passed",
      "summary": "Confirmed SyncStatusBar currently gates conflict callout behind pendingCount === 0 and tests/mocks reference pendingCount shape."
    },
    {
      "command": "read src/frontend/src/app/dashboard/regional/conflicts/page.tsx, src/frontend/src/components/regional/IncidentCard.tsx, src/frontend/src/lib/useAutoSync.ts, src/frontend/src/lib/offlineEnable.ts, src/frontend/src/components/IncidentConflictMergePanel.tsx",
      "result": "passed",
      "summary": "Confirmed existing conflict route, card status rendering, auto-sync state, offline mode flag helpers, and flat conflict merge panel."
    }
  ],
  "validationOutput": [
    "Plan written to /home/computa/Projects/WIMS-BFP/WIMS-BFP-PROTOTYPE/plan.md as required.",
    "No tests were run because this task is planning-only."
  ],
  "residualRisks": [
    "Actual implementation may need to adjust test paths/names after reading the full test tree.",
    "Potential circular import between offlineStore.ts and offlineEnable.ts should be resolved with optional offlineModeFlags.ts if encountered."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added a detailed implementation plan in plan.md; no source code modified.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "This is a planning deliverable. The changedFiles field lists only plan.md, and no staging was performed by this subagent."
}
```