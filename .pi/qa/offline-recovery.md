# Scenario: offline-recovery

**Scope:** PWA offline-store recovery — the app should recover queued
device-local public operations that were stranded in `syncing` after a tab
close/reopen, after the 5-minute stale threshold (PR #722 / #733).
**Auth:** `encoder_ncr` (REGIONAL_ENCODER) — authenticated write path.
**Capabilities:** `browser_start`, `browser_navigate`, `browser_offline`,
`browser_online`, `browser_tab_close`, `browser_tab_select`, `browser_reload`,
`browser_console`, `browser_network`, `browser_close`.

## Prerequisites

- `encoder_ncr` seeded (see [synthetic-identities.md](./synthetic-identities.md)).
- The local stack is running and the PWA service worker registration is
  **blocked** by the browser extension by design (`serviceWorkers: "block"`).
  This scenario therefore exercises the **runtime degradation/recovery path**
  (failed sync, stale-marker recovery on reconnect), not the SW-based offline
  store directly. Document this limitation in the report.
- Review PR #733's manual E2E note (tab-kill / reopen-after-5-minutes) — this
  scenario approximates it within the tool surface.

## Steps

1. `browser_start`; `browser_navigate http://localhost`; log in as
   `encoder_ncr` (see dispatcher-triage.md steps 1-3 for the login flow).
2. `browser_navigate` to the public report or queue view that triggers a
   device-local sync operation.
3. `browser_offline` (context set offline; the loopback guard aborts
   requests with `BLOCKED(offline)` evidence — fail-closed).
4. Trigger an operation that would be queued offline (e.g. start a public
   report submission, or an encoder action that writes to the offline store).
   Verify it is accepted locally while offline (no crash).
5. `browser_tab_close` the current tab (simulate tab-kill). If it is the last
   tab, instead close and restart the browser run:
   `browser_close` → `browser_start` → `browser_navigate http://localhost`.
6. `browser_online` (reconnect). Wait for the next mount/reconnect/sync
   trigger. Use `browser_wait_for` for a visible recovery indicator or
   `browser_network` for a sync request.
7. Verify the previously-stranded operation is recovered (sync marker clears,
   operation completes). `browser_network` should show the sync request
   succeeding (`2xx`).
8. `browser_console` / `browser_network` / `browser_screenshot`.
9. `browser_close`.

## Expected behavior

- Offline operations are accepted locally without an unhandled error.
- After reconnect, the stranded `syncing` operation recovers (per #722/#733):
  the stale-sync threshold prompts a recovery-before-read, and the operation
  syncs successfully.
- No operation is silently lost or duplicated.

## Defects to report

- An offline operation throws an unhandled error.
- After reconnect, a stranded operation stays in `syncing` indefinitely
  (recovery did not trigger).
- A recovered operation is duplicated or lost.
- Sync requests fail with `5xx` after reconnect.

## Note

Because service workers are blocked in the extension, this scenario cannot
verify the SW-based offline cache. It verifies the app's runtime offline
handling and the recovery path. A full SW-based offline test would require a
non-extension Chromium run (out of scope for `browser-qa`).