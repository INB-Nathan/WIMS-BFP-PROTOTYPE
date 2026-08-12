# Scenario: smoke-public

**Scope:** Verify all public-facing pages render, navigate, and produce no
unexpected console errors or HTTP failures.
**Auth:** none.
**Capabilities:** `browser_start`, `browser_navigate`, `browser_snapshot`,
`browser_click`, `browser_console`, `browser_network`, `browser_screenshot`,
`browser_close`.

## Steps

1. `browser_start` (fresh headless run, trace optional).
2. `browser_navigate http://localhost`.
3. `browser_snapshot` the landing page. Record the intent modal refs.
4. Click each intent affordance and the nav links in order:
   - intent button (e.g. "View Active Fires") to dismiss the modal
   - Home → `/` (or `/home`)
   - Active fires → `/incidents`
   - Information → `/information`; cycle Emergencies / Announcements / Reporting Guide tabs
   - Fire stations → `/fire-stations`; type "manila" in search; select a station toggle
   - Report a Fire → `/report`; verify wizard Step 1 renders
   - Sign In → `/login`; follow through to the Keycloak login page (do not enter credentials)
   - return to `/`
   - `/privacy` and `/register` render
5. `browser_console` at `warning` threshold (all navigations).
6. `browser_network` (HTTP errors + `BLOCKED`).
7. `browser_screenshot` at the landing page and any page with visible issues.
8. `browser_trace_stop` (if tracing); `browser_close`.

## Expected behavior

- All pages render with a visible title and primary landmark.
- The one-time intent modal closes after selecting an intent and does not
  reappear in the same session.
- `Sign In` redirects to Keycloak with a `code_challenge` (PKCE) in the URL.
- `401` on `/api/auth/session` and `/api/auth/refresh` is **expected**
  (unauthenticated), not a defect.
- `BLOCKED(loopback-guard)` for `tile.openstreetmap.org` / `fonts.googleapis.com`
  is **environmental** (loopback-only invariant), not an app defect. The
  fire-stations page should gracefully degrade ("Map tiles are unavailable…").

## Defects to report

- Any page that fails to render or throws an unhandled error.
- Any nav link that 404s or navigates to a blank/error state.
- Any HTTP `5xx` from a local endpoint.
- Unexpected console errors (not the expected auth/SW-blocked/tile-blocked set).
- Any control that is visually present but unclickable/intercepted (e.g. map
  zoom controls overlapped by another element).