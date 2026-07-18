# Contributor Dashboard Redesign — Implementation Plan

**Branch:** `feat/contributor-dashboard-redesign`
**Spec:** `docs/superpowers/specs/2026-07-18-contributor-dashboard-redesign-design.md`

## Principle
Elevated translation of the prototype's visual language into the repo's `.ps-*` public-surface
system. No new data, no new API calls, no new routes. Keep `page.test.tsx` green.

## Step 1 — `page.tsx` markup restructure (content-only, no chrome)
Scope: only the rendered JSX in the success branch (and the new-reporter branch). Loading /
sign-in / forbidden / error states stay as-is.

1. **Header trust pill.** Replace `ps-contributor-reporter-badge` (text only) with a pill that
   reads `profile.badge` (e.g. "TRUSTED" → display "Verified Reporter" via a small map, or show
   the raw `badge` string). Keep `IconShieldCheckFilled` when a badge exists. Fallback to the
   current count-derived label (`reporterBadge`) only when `profile.badge` is empty. Preserve
   `data-testid`/`role` expectations — no test asserts badge text, so this is safe.
2. **Report CTA.** Keep `<Link href="/report">` + "Submit a report" copy (test asserts). Add a
   `ps-contributor-report-cta` compact variant class; keep arrow + plus icons. No behavioral
   change.
3. **Two stat cards.** Keep classes `ps-contributor-stat-card`, labels "Reports you filed" and
   "Verification status", `({pct}%)`, and the segmented bar + legend (Verified / Awaiting review
   / Rejected). Add a sub-line (`{active_months} mo active` / "Lifetime") per prototype.
4. **Impact strip.** Keep text + `IconFlameFilled`; minor copy tighten, keep `ps-contributor-impact`.
5. **Activity → vertical timeline.** Wrap each report's two status lines in a timeline with a
   left rule + colored node. Preserve text "Report received {date}" and "Current status: {label}"
   (test asserts). Bounded to first 3–5 reports. Keep `ps-contributor-timeline` class on the list.
6. **Your reports → card rows.** Keep `<ul class="ps-contributor-report-list">` and
   `span.ps-contributor-report-title`; render each `<li>` as a card (status dot + title + meta +
   status pill + date). Make the row `role="listitem"` and keyboard-focusable but **not** an
   `<a>`/click handler (no token). Add `data-testid="contributor-report-row"` for stability.
7. **Map.** Keep `PublicFireMap height={220}`; wrap section already exists. Add framed-card
   styling in CSS only.
8. **Motion.** Add `ps-contributor-reveal` class to top-level blocks; CSS staggers fade/slide on
   mount; `@media (prefers-reduced-motion: reduce)` disables transforms/animation.
9. **New-reporter / empty state.** Keep copy; restyle to centered card (CSS).

## Step 2 — `public-surface.css` contributor section
- Trust pill: rounded pill, green bg tint, shield icon.
- Stat cards: hover lift already exists; add subtle entrance + keep.
- Timeline: `.ps-contributor-timeline` left border rule, `.ps-contributor-timeline-item::before`
  colored node using existing tone vars; relative-time handled in JS or kept as formatted date.
- Report rows: card padding/shadow polish; focus-visible ring; not clickable.
- Reveal animation: `@keyframes psContribReveal` + stagger via `:nth-child` / `--reveal-i`;
  `prefers-reduced-motion` guard.
- Nearby map frame: card border + radius already present; minor polish.

## Step 3 — `page.test.tsx` adaptation
- No behavioral assertion should break (verified against current test). Add stable testids where
  markup changed: `data-testid="contributor-report-row"` on each `<li>`; `data-testid="trust-badge"`
  on the pill. Keep all existing `getByText`/`queryByText` assertions. If a class selector the
  test relies on moves, update the test to the new stable class/testid (same behavior).
- Confirm: 2 stat cards, CTA→/report, "9 Verified/3 Awaiting review/0 Rejected", activity
  snapshot, report list class, map height 220.

## Step 4 — Verification (in worktree)
- `cd src/frontend && npx vitest run src/app/contributor/page.test.tsx` → pass.
- `npx eslint src/app/contributor/page.tsx src/app/contributor/page.test.tsx` → 0 errors.
- `NEXT_PUBLIC_AUTH_API_URL=... NEXT_PUBLIC_MAPBOX_TOKEN= NEXT_PUBLIC_BASE_URL=http://localhost npm run build` → pass.
- Manual light/dark, desktop/320px, reduced-motion (visual self-check).

## Commit + PR
- Commit: `feat(frontend): redesign contributor dashboard to prototype visual language (#654)`.
- Push branch, open PR to `master` (NOT direct push — auto-deploy on master).

## Risks
- Selector-based test assertions: mitigated by keeping classes/labels and adding stable testids.
- Motion accessibility: `prefers-reduced-motion` guard mandatory.
- No scope creep: Drafts / tracking-token deep-link / numeric trust-score card explicitly omitted.
