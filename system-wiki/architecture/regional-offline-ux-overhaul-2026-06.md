# Regional Offline UX Overhaul (2026-06)

## Scope

PR #466 improves the regional encoder offline workflow. It keeps the existing IndexedDB + sync-engine architecture, but makes queued work, failed work, conflicts, and setup progress visible and actionable from the UI.

## Key Changes

- `src/frontend/src/lib/offlineStore.ts` now exposes split operation counts via `getOfflineOpsCounts()`:
  - `pendingCount` for queued retryable work
  - `failedCount` for permanently failed work
  - `conflictCount` for merge/duplicate-review work
  - `totalActionableCount` for navigation badges
- `src/frontend/src/lib/offlineModeFlags.ts` holds the localStorage offline-mode flags independently of `offlineEnable.ts`, avoiding circular imports with offline API wrappers.
- `src/frontend/src/lib/regionalOfflineStatus.ts` maps pending/failed/conflict operations to server incident cards so encoders see per-incident overlays such as Update queued, Archive queued, Conflict, and Sync failed.
- `src/frontend/src/app/dashboard/regional/offline-work/page.tsx` adds the Offline Work center at `/dashboard/regional/offline-work` for Drafts, Queued, Failed, and Conflicts.
- `src/frontend/src/lib/offlineOpActions.ts` centralizes queued-operation cancellation and re-checks the current IndexedDB op before deletion to avoid cancelling work that has started syncing.

## User-Switch Flag Semantics

`setActiveOfflineUser()` clears the `wims:offline_enabled` flag only when the active user changes. A same-user relogin keeps the enabled flag. `clearAllOfflineData()` also clears the enabled flag. This prevents a stale enabled flag from hiding the offline setup prompt for a different user.

## Sync Status UX

`useAutoSync()` consumes `getOfflineOpsCounts()` and exposes `pendingCount`, `failedCount`, `conflictCount`, and `syncProgress`. `SyncStatusBar` renders active sync progress and shows conflict and failed callouts independently so one state does not hide the other.

## Conflict Merge UX

`IncidentConflictMergePanel` groups fields by incident category, defaults empty client values to the server value, supports quick-select buttons for all-client/all-server choices, and labels the dialog for assistive technology.

## Offline Setup UX

`enableOfflineMode()` accepts an `AbortSignal` and reports granular setup phases. `OfflineModeManager` exposes cancellation while setup is in progress.

## Related Non-Offline UX Changes in the Same PR

The PR also includes small UX/reference-data fixes that were developed on the same branch:

- `/fire-stations` centers on browser geolocation when available while preserving the national fallback.
- `IncidentForm` reverse-geocode fill now populates city/province/address context when possible.
- PSGC reference data moves Negros Occidental, Negros Oriental, and Siquijor to NIR and removes Baguio City from the CAR province list.
- Dashboard freshness UI no longer renders a "Live" badge for null freshness.

## Validation Notes

Primary validation lives in frontend Vitest suites for `offlineStore.logout`, `useAutoSync`, `SyncStatusBar`, `IncidentCard`, `OfflineModeManager`, `offlineOpActions`, `Offline Work`, `IncidentConflictMergePanel`, `Sidebar`, and `/fire-stations` map behavior.
