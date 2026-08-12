# Scenario: accessibility-structure

**Scope:** Verify page structure, landmark semantics, no nested duplicate
landmarks, and no unhandled console errors across the public surface. This is
a structural pass, not a full WCAG audit (the tool has no screen reader).
**Auth:** none.
**Capabilities:** `browser_start`, `browser_navigate`, `browser_snapshot`,
`browser_console`, `browser_network`, `browser_screenshot`, `browser_close`.

## Steps

1. `browser_start`; optionally `browser_viewport` to test a mobile width
   (e.g. 390x844) and a desktop width (1440x960) in two passes.
2. For each route below, `browser_navigate` then `browser_snapshot` and
   inspect the ARIA snapshot for landmark structure:
   - `/` (landing)
   - `/incidents`
   - `/information`
   - `/fire-stations`
   - `/report`
   - `/privacy`
   - `/register`
3. `browser_console` at `warning` threshold on each page.
4. `browser_network` (HTTP errors + `BLOCKED`).
5. `browser_screenshot` the landing page at mobile and desktop widths.
6. `browser_close`.

## Expected behavior

- Each page has exactly one top-level `<main>` landmark (no nested `<main>`
  inside `<main>`).
- Headings are present and in a logical order (no skipped levels).
- The one-time intent modal (if present) exposes its controls in the snapshot.
- No unhandled console errors beyond the expected auth/SW-blocked/tile-blocked
  set.
- The layout reflows at mobile width without horizontal overflow or hidden
  controls.

## Defects to report

- Nested `<main>` landmarks (e.g. `/privacy` previously had
  `<main class="ps-content"><main>…` — verify fixed).
- Missing top-level landmark or heading on any page.
- Layout breaks at mobile width (horizontal scroll, clipped controls).
- Unhandled console errors.

## Known deferred findings (browser QA follow-up — no code change this layer)

- **D2 — Leaflet `_leaflet_pos` console error** after toggling the fire-station
  marker layer on the landing map. Appears tile/environment-dependent; left as
  a documented finding for a follow-up decision.
- **D3 — Intent modal has no Escape/dismiss path.** Per the approved safe
  default, intent selection remains mandatory — do NOT add an Escape/close
  bypass; improved accessibility is a separate follow-up.