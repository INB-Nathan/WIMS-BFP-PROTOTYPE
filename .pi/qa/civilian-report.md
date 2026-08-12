# Scenario: civilian-report

**Scope:** Guest report-wizard flow, including location/geolocation and the
coordinate-vs-landmark validation expectation.
**Auth:** none.
**Capabilities:** `browser_start`, `browser_navigate`, `browser_snapshot`,
`browser_type`, `browser_set_geolocation`, `browser_clear_geolocation`,
`browser_set_permissions`, `browser_click`, `browser_console`,
`browser_network`, `browser_screenshot`, `browser_close`.

## Prerequisites

- The local stack is running and `/report` is reachable.
- **Safe default policy (approved):** a map pin / coordinates are required to
  advance; a landmark alone must NOT be sufficient.

## Steps

1. `browser_start`; `browser_navigate http://localhost/report`.
2. `browser_snapshot` Step 1 ("Location"). Record refs.
3. `browser_set_permissions` deny `geolocation` (test graceful fallback).
4. If there is a "Use my location" control, click it. Expect a graceful
   "Location access denied / showing national map" fallback (no crash).
5. `browser_type` only the optional "Nearby landmark" field. **Attempt
   `Continue` — it must remain disabled** (safe default: coordinates required).
6. `browser_clear_geolocation` reset; `browser_set_geolocation` to a
   deterministic coordinate within the Philippines (e.g. latitude 14.5995,
   longitude 120.9842 — Manila). `browser_set_permissions` grant
   `geolocation`.
7. "Use my location" should now resolve. Verify a map pin appears and
   `Continue` becomes enabled.
8. Advance through the wizard steps (Category, Details, Contact,
   Review) without submitting. `browser_snapshot` each step.
9. `browser_console` / `browser_network`; `browser_screenshot` at each step.
10. `browser_close`. Do not submit.

## Expected behavior

- Step 1 landmark-only does not enable `Continue` (safe default).
- Geolocation denial degrades gracefully without an unhandled error.
- Each wizard step renders its fields; `Continue`/`Back` are enabled only when
  the step's required inputs are satisfied.
- No submission is attempted or completes in this scenario.

## Defects to report

- `Continue` enabled by a landmark alone (violates the safe default).
- Geolocation denial throws an unhandled error or leaves a stuck state.
- Any wizard step that renders blank, errors, or loses previously entered data.
- Any HTTP `5xx` or unhandled console error.