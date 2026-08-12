# Scenario: dispatcher-triage

**Scope:** Authenticated regional-encoder triage workflow (report intake,
queue, proximity policy).
**Auth:** `encoder_ncr` (REGIONAL_ENCODER) or `encoder_car`. Password from
[synthetic-identities.md](./synthetic-identities.md) — confirm seeded first.
**Capabilities:** `browser_start`, `browser_navigate`, `browser_snapshot`,
`browser_type`, `browser_click`, `browser_console`, `browser_network`,
`browser_screenshot`, `browser_close`. Totp/HOTP flow is out of scope unless
the identity has `SKIP_MFA`.

## Prerequisites

- Synthetic `encoder_ncr` (or `encoder_car`) is seeded in the local Keycloak
  realm `bfp` (imported from `src/keycloak/import/bfp-realm.json` by the
  `keycloak` Compose service on first start). Both placeholder passwords are
  documented in `synthetic-identities.md`.
- The local stack is running.

## Steps

1. `browser_start`; `browser_navigate http://localhost/login`.
2. `browser_snapshot` the login page; follow "Continue to secure sign-in" to
   Keycloak.
3. Type the seeded encoder username and placeholder password. Submit.
   - If `SKIP_MFA` is set on the identity, expect to land back on the WIMS app
     authenticated (e.g. `/dashboard` or `/contributor`). If an MFA step
     appears, stop and report — the identity was not the `SKIP_MFA` variant.
4. `browser_snapshot` the authenticated landing/dashboard.
5. Navigate to the encoder workflow (e.g. `/incidents` queue / triage view per
   current routes — confirm via DOM snapshot, do not assume exact paths).
6. Exercise **read-only** triage actions: select a report, view proximity/time
   policy values, view the queue. Do not mutate state (no assign/close/merge
   in this scenario — those belong in a dedicated write-scenario with
   teardown).
7. `browser_console` / `browser_network`; verify authenticated API calls
   return `2xx` (not `401`).
8. `browser_screenshot` the authenticated dashboard and triage view.
9. `browser_close`. Do not sign out destructively — closing the browser
   discards the session.

## Expected behavior

- Login completes and the app recognizes the `REGIONAL_ENCODER` role (no
  redirect loop, no `401` on authenticated API calls).
- The triage queue loads reports scoped to the encoder's region.
- Proximity/time policy values are visible and consistent with the frozen
  constants in `src/backend/services/civilian_triage/policies.py`
  (`CLAIM_STALE_MINUTES`, `RELATED_REPORT_RADIUS_METERS`,
  `RELATED_REPORT_WINDOW_HOURS`, `MERGE_CANDIDATE_RADIUS_METERS`,
  `AGING_MINUTES`, `TIMEOUT_RISK_MINUTES`, `DANGER_MINUTES`,
  `GPS_MISMATCH_METERS` — no stale or contradictory values).
- No unhandled console errors.

## Defects to report

- `401` on authenticated API calls after a successful login.
- Triage queue shows reports outside the encoder's region (RLS bypass).
- Proximity/time policy values missing or inconsistent.
- Any unhandled error or stuck loading state.
- MFA step for a `SKIP_MFA` identity (seeding mismatch).