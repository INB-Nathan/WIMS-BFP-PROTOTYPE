# Contributor Dashboard Redesign — Design

**Date:** 2026-07-18
**Branch:** `feat/contributor-dashboard-redesign`
**Worktree:** `.worktrees/feat/contributor-dashboard-redesign`
**Issue context:** User reported the current contributor dashboard "is shit" and asked for a
full overhaul. They explicitly set `prototypes/public-surface/index.html` (contributor scene)
as the quality bar — the merged React version "pales in comparison."

## Decision

**Direction A ("Elevated translation"), strengthened.** Rebuild the *same* dashboard structure
to match the prototype's visual language, strictly within the repo's public-surface design
system (`.ps-*` classes, CSS variables, dark/light themes, BFP red accent, JetBrains Mono,
warm-paper light theme, single-column LayoutShell-owned chrome). No new data sources, no new
API fields, no invented UI.

Oracle advisory review confirmed Direction A and surfaced two hard constraints that are folded
into this spec:

1. **Report rows must NOT deep-link to `/tracking/v2/{report_id}`.** That route requires BOTH
   `report_id` and `tracking_token` (`src/frontend/src/app/tracking/v2/[report_id]/[tracking_token]/page.tsx:107-108`),
   and `ContributorReport` exposes no token (`src/frontend/src/lib/api/contributor.ts:24-32`).
   Report rows become card-like and keyboard-accessible but **not clickable** until a real
   tracking-url contract exists.
2. **Exactly two stat cards**, with labels "Reports you filed" and "Verification status".
   Existing `page.test.tsx` enforces this and rejects the old 4-card labels ("Trust score",
   "Total reports", "Actioned", "Pending") and "Trust breakdown"/"Monthly reports". This is
   preserved.

## Root-cause gap (why the current UI is weak)

The merged React version (PR #691) is a flattened translation of the prototype. Versus the
prototype it is missing/weaker:

- **No trust badge pill** — it derives a plain text badge from report counts and *ignores the
  API `badge` / `trust_score` fields* (`page.tsx` reporter-badge logic ~220-243). The prototype
  shows a "✓ Verified Reporter" pill.
- **Status bar is lifeless** — no legend, no trend sub-line. Prototype has segmented bar + legend.
- **Activity is a flat `<li>` list**, not the prototype's real vertical timeline (left rule +
  colored nodes + timestamps), grouped by report.
- **Report rows are a 5-column grid**, not clickable cards.
- **No motion, no focal hierarchy**; the red CTA is a full-width bar competing with everything.

## Target design (component order, top → bottom)

1. **Header** — `Welcome back, {name}` + **trust badge pill** sourced from API `profile.badge`
   (fallback to current count-derived label only when `badge` is empty). Location/role line.
2. **Report CTA** — BFP-red, compact/right-aligned (prototype style), links `/report`; hover
   arrow nudge + lift. Keep copy "Submit a report" (test asserts it).
3. **Two stat cards** (preserve classes + labels + 75% text + breakdown counts):
   - Card 1 "Reports you filed": mono value + detail (`{active_months} mo active` / "Lifetime").
   - Card 2 "Verification status": value + `({pct}%)` + **segmented status bar + legend**
     (Verified / Awaiting review / Rejected), using existing `verified/awaitingReview/rejected`.
4. **Impact strip** — keep, tighten to prototype (icon + strong counts).
5. **Activity** — real **vertical timeline**: left rule, colored nodes per status, relative
   time. Bounded to first 3–5 loaded reports. Preserve "Report received" + "Current status: X"
   text the test asserts.
6. **Your reports** — **card-style rows** (status dot + title + meta + status pill + date),
   keyboard-accessible, **not clickable**. Preserve `ps-contributor-report-list` class on the
   `<ul>`, `span.ps-contributor-report-title`, and `Verified` pill (`selector: 'span'`). Keep
   filter tabs (all/pending/resolved) + pagination.
7. **Nearby activity** — keep `PublicFireMap` wrapped in a framed card (prototype style).
8. **Motion** — staggered fade/slide-in on mount; hover lifts on cards. Honor
   `prefers-reduced-motion` (disable transforms/animations).
9. **Empty / new-reporter state** — restyle to prototype's centered empty card; preserve copy.

## Constraints honored

- Same data sources (`fetchContributorProfile`, `fetchContributorReports`); no new endpoints.
- `.ps-*` classes + CSS variables only; edits live in `src/styles/public-surface.css`.
- LayoutShell supplies header/footer/theme — page adds no chrome, theme toggle, or nav.
- Single-column public-surface layout preserved.
- Existing `src/frontend/src/app/contributor/page.test.tsx` stays green; update selectors only
  where markup/testid changes, keeping all current behavioral assertions (2 stat cards, CTA →
  /report, status breakdown counts, activity snapshot, report list class, map reuse).

## Out of scope (honest limitations)

- **Drafts section** — no API endpoint; omitted (prototype data is demo-only).
- **Click-to-tracking with token** — list has no token; omitted per oracle constraint #1.
- **Numeric "Trust score" card** — tests reject it; `trust_score` surfaced only via the badge
  pill text from `profile.badge`. No new product semantics invented.

## Files changed

- `src/frontend/src/app/contributor/page.tsx` — restructure markup (trust pill from `badge`,
  timeline activity, card rows, motion wrappers, stable testids).
- `src/frontend/src/styles/public-surface.css` — contributor section: trust pill, segmented bar
  legend polish, timeline styling, card rows, entrance animation + reduced-motion.
- `src/frontend/src/app/contributor/page.test.tsx` — adapt selectors to new markup; keep all
  behavioral assertions.

## Verification

- `npx vitest run src/app/contributor/page.test.tsx` — pass.
- `npx eslint` on changed files — 0 errors.
- `npm run build` (with CI env vars) — pass.
- Manual: light + dark theme, desktop + 320px, reduced-motion.
