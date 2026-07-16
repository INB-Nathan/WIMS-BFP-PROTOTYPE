# Unified auth-aware navbar + `ps-*` theme toggle (landing-canonical)

**Date:** 2026-07-17
**Issue:** #654 (new, separate from #652 Register/Login migration)
**Branch:** `feat/654-public-header-theme-unify` (based on `origin/master` `5bb7f458`, post-#661)
**Author:** handoff `@/tmp/handoff-navbar-theme-toggle.md` + design dialogue

## Goal

Make the public navbar (a) visually uniform with the landing page's canonical chrome
and (b) auth-aware: anonymous vs authenticated-civilian show different button sets, while
staff keep their existing `Sidebar`. The landing page `.landing-header` is the **style
authority** — its exact DOM and CSS tokens are reused everywhere; `PublicHeader` is retired
as a separate styled component and re-rendered using the `.landing-header` markup.

## Non-negotiable decisions (from user)

1. **Canonical DOM is the landing `.landing-header`.** Keep its exact structure:
   BFP `<img>` logo (`.landing-header-bfp-logo`), `.landing-header-title` = `WIMS-BFP`,
   `.landing-header-right` containing `btn-theme-toggle` + `btn-ghost`/`btn-outline`/
   `btn-primary`. Do NOT keep the `.public-header` markup from `PublicHeader.tsx`.
2. **Authenticated swap, same chrome.** When authenticated as `CIVILIAN_REPORTER`, replace
   Register/Sign In with **Home / Dashboard / Information** (nav links) + profile avatar,
   keep Report a Fire, keep the `ps-*` theme toggle. Staff roles return `null`.
3. **Landing styling stays canonical; authenticated navbar inherits it.** No reverse
   styling.
4. **Immersive overlay only on `/`.** The landing page header is `position: absolute`
   (floats over the full-screen map). On all other public/civilian routes the shared
   `.landing-header` is `position: sticky` (normal top bar). Confirmed by user 2026-07-17.
5. **One toggle, one store.** Use `usePublicTheme()` from `PublicThemeProvider`
   (`landing-theme` localStorage). Retire the landing page's local `useState` theme; retire
   the duplicate `ps-header` chrome rendered by `PublicThemeProvider` on `/report` &
   `/tracking`.

## Prototype reference (verified)

`prototypes/public-surface/index.html` confirms the canonical authenticated-state pattern:
- `ah-primary-nav`: Home / Dashboard / Information (lines 1304-1309).
- `ah-actions-loggedin`: Report a Fire (`btn-primary`) + `.ah-avatar` initials (lines 1321-1323).
- Theme toggle persists in the right cluster in both states.
- `.landing-header` CSS authority: lines 332-362, light overrides 130 / 418 / 726-742.

## Architecture constraints (verified — drive the plan)

Two facts about the current code force a specific structure:

- **`PublicHeader` mounts OUTSIDE any theme provider.** `LayoutShell.tsx:87-92` renders
  `{pathname !== '/' && <PublicHeader />}` as a *sibling* of `children`, and `PublicHeader`
  is not wrapped by `PublicThemeProvider`. `usePublicTheme()` returns a **no-op default** when
  no provider ancestor exists (`PublicThemeProvider.tsx:8-14`). So a `PublicHeader` that calls
  `usePublicTheme()` today would get an inert toggle.
- **Design tokens live INSIDE `.public-surface`.** `public-surface.css:19-36` defines
  `--bg-deep`/`--border-strong`/`--text-primary`/`--red` on the `.public-surface` selector, not
  `:root`. `globals.css:6` `:root` has *different* (old dashboard) tokens. `PublicHeader`
  mounted outside `.public-surface` cannot read the public tokens and would fall back to the
  wrong `:root` values. `public-surface.css` is explicitly scoped to `.public-surface`
  (`public-surface.css:5-14`) and imported only by `report/page.tsx` + `tracking/page.tsx`.
- **`PublicHeader` mounts on 11 route patterns** (`routeUtils.ts:7-38`): `/login`, `/register`,
  `/report`, `/callback`, `/verify*`, `/tracking*`, `/fire-stations*`, `/privacy*`,
  `/contributor`, `/information`. Any shared CSS must reach all of them, so it cannot live in
  the `.public-surface`-scoped file alone.
- **Landing uses a plain global `<style>` block** (`page.tsx:205+`), scoped via `.scene-landing`
  selectors — NOT styled-jsx, NOT `.public-surface`. The `.landing-header` base CSS currently
  lives only there.

Consequence: the canonical `.landing-header` chrome + the `usePublicTheme()` context must both
be available to `PublicHeader` on every public route. The clean way is to make `LayoutShell`
the single owner of the public theme wrapper.

## Current state (verified this session)

- `PublicHeader.tsx` renders `.public-header` with OLD glass chrome and NO theme toggle.
  Mounted by `LayoutShell.tsx:90` as `{pathname !== '/' && <PublicHeader />}` (outside provider).
- Landing `page.tsx` renders its own `.landing-header` (anonymous-only, `position: absolute`
  overlay) using LOCAL `useState` theme (lines 62-67) — NOT `PublicThemeProvider`.
- `PublicThemeProvider.tsx` renders its OWN `ps-header` + `ps-theme-toggle` and is wrapped
  around `/report` and `/tracking` content → those routes currently show **two** headers.
- `PublicHeader.test.tsx` exists with `.public-header` selectors (staff ~:201-287, FAB ~:148-179)
  that become invalid after retiring that markup.
- `landing.test.tsx` asserts ONLY `header-register`/`header-signin`/`header-report` (lines
  121-127) — there is NO theme-toggle assertion today (corrects an earlier misstatement).

## Implementation

### 0. `LayoutShell.tsx` — single public-theme owner (fixes both BLOCKERs)
- For public/civilian routes, wrap BOTH `<PublicHeader />` and `{children}` in
  `<PublicThemeProvider showHeader={false}>` so the React theme context AND the
  `.public-surface` token scope reach `PublicHeader`:
  ```tsx
  if (isPublicRoute(pathname) || isCivilianRoute(pathname)) {
    return (
      <PublicThemeProvider showHeader={false}>
        {pathname !== '/' && <PublicHeader />}
        {children}
      </PublicThemeProvider>
    );
  }
  ```
- `PublicThemeProvider` keeps rendering `<div className="public-surface" data-theme>` so the
  public tokens are in scope for `PublicHeader` and all public pages. Landing `/` is a public
  route, so it is also inside this provider → it drops local theme state (step 2).
- `showHeader={false}` suppresses the provider's `ps-header` chrome everywhere; the new
  `PublicHeader`/landing header is the single chrome.

### 1. `PublicHeader.tsx` → rewrite as `.landing-header` component
- Import `usePublicTheme` from `@/components/public/PublicThemeProvider` (now reachable via
  step 0).
- Keep `useAuth()` + `isStaff` → `return null` logic unchanged.
- Render the SAME `.landing-header` DOM as `page.tsx` (BFP logo `<img>`, title, right cluster).
- Anonymous: `[btn-theme-toggle] [Register btn-ghost→/register] [Sign In btn-outline→/login]
  [Report a Fire btn-primary→/report]`.
- Civilian: `[btn-theme-toggle] [Home btn-ghost→/] [Dashboard btn-ghost→/contributor]
  [Information btn-ghost→/information] [avatar] [Report a Fire btn-primary→/report]`.
  Avatar shows `user.preferred_username?.[0]` / `user.email?.[0]` / `user.sub?.[0]` uppercased,
  `aria-label` = email or username. Hide Report a Fire when `pathname === '/report'`.
- Theme toggle button: `className="btn-theme-toggle"`, `data-testid="theme-toggle"`,
  `aria-label` from `theme`, `onClick={toggleTheme}`, label `🌙 Dark`/`☀️ Light`
  (reuse the current `ps-*` system look — emoji is the canonical widget).
- Remove the `<style jsx>` glass block. Styling comes from shared `.landing-header` rules
  (see #3).

### 2. `page.tsx` landing header
- Remove local `useState` theme + `toggleTheme` + the `window.localStorage` effect; import
  `usePublicTheme` and read `theme`/`toggleTheme` from it (provider now wraps `/` via step 0).
- Keep the `.landing-header` JSX as the anonymous state. `btn-theme-toggle` reads `theme`/
  `toggleTheme` from the provider context.
- Keep `position: absolute` overlay inline in `page.tsx`'s `<style>` block (landing-only),
  scoped `.scene-landing .landing-header`. Remove the base `.landing-header*` rules that move
  to the global stylesheet (step 3); keep only landing-specific overrides.

### 3. Hoist `.landing-header` CSS to a GLOBAL stylesheet
- Create `src/frontend/src/styles/public-header.css` (global, NOT `.public-surface`-scoped) and
  import it in `layout.tsx` alongside `globals.css`. Move the base `.landing-header`,
  `.landing-header-left/-logo/-bfp-logo/-title`, `.landing-header-right`,
  `.btn-ghost/-outline/-primary` (+ hover/focus-visible) and `[data-theme="light"]` overrides
  from `page.tsx` (`page.tsx` `<style>` block, lines ~322-419 + ~726-742) into this file.
  Base rule uses `position: sticky` so non-`/` routes are normal top bars.
- Add explicit civilian-nav + avatar rules here (prototype `ah-primary-nav` + `ah-avatar`,
  `prototypes/public-surface/index.html:1304-1309, 1171-1180`): civilian nav links visible
  ≥768px, hidden on mobile (where anonymous Register/Sign In are also hidden per
  `page.tsx:892-893`); avatar always visible. Prevents the responsive regression where reusing
  `.btn-ghost` would hide the civilian links on mobile.
- `page.tsx` keeps a more-specific override `.scene-landing .landing-header { position: absolute;
  top:0; left:0; right:0; z-index:100; }` for the immersive overlay — it wins over the global
  `sticky` base by specificity.
- Do NOT put these in `public-surface.css` (it is `.public-surface`-scoped and would not reach
  `PublicHeader` on `/login`, `/register`, `/contributor`, etc.).

### 4. `PublicThemeProvider.tsx` — add `showHeader` prop
- Add `showHeader = true` prop. When `false`, render theme context + `.public-surface` wrapper
  + `.ps-content` + footer but NOT the `ps-header`. `usePublicTheme` export unchanged.

### 5. `report/page.tsx` & `tracking/page.tsx`
- Remove the direct `import '@/styles/public-surface.css'` (provider now owns it) and the
  `<PublicThemeProvider>` wrapper (already provided by `LayoutShell`). Keep page content only.
- Result: ONE header on these routes (the `PublicHeader`/landing header from `LayoutShell`).

### 6. Tests
- `landing.test.tsx`: currently asserts only `header-register`/`header-signin`/`header-report`
  (lines 121-127) — there is NO theme-toggle assertion today. After step 2 the landing header
  still renders those 3 links + `theme-toggle`; add a `theme-toggle` presence assertion and
  keep the 3 link assertions. The landing page is now inside `LayoutShell`'s provider at
  runtime; if testing `<LandingPage />` in isolation, wrap in `<PublicThemeProvider>`.
- `PublicHeader.test.tsx`: existing `.public-header` selectors (staff ~:201-287, FAB ~:148-179)
  become invalid after retiring that markup. Update selectors to `.landing-header`; add
  civilian nav (Home/Dashboard/Information) + avatar + `theme-toggle` presence; verify staff
  `null`; verify anonymous Register/Sign In present.
- Add route-level one-header tests: render `/report` and `/tracking` and assert exactly one
  `header` (no `ps-header` duplicate).

## Acceptance criteria
- [ ] `PublicHeader` renders `.landing-header` DOM (BFP `<img>` logo, title, `btn-*` buttons).
- [ ] `LayoutShell` wraps public/civilian routes in `PublicThemeProvider` so `PublicHeader`
  gets `usePublicTheme()` context + `.public-surface` token scope (no inert toggle, correct
  dark tokens on all 11 public route patterns).
- [ ] Anonymous: Register/Sign In/Report a Fire + theme toggle, opaque `var(--bg-deep)` chrome.
- [ ] Civilian: Home/Dashboard/Information + avatar + Report a Fire + theme toggle, same chrome.
- [ ] Staff: `PublicHeader` returns `null`; `Sidebar` shown.
- [ ] `/report` & `/tracking` show ONE header (no `ps-header` duplicate; pages no longer wrap
  in their own provider).
- [ ] Theme toggle is the single `ps-*` widget backed by `landing-theme`; persists on refresh.
- [ ] Landing `/` keeps immersive `position: absolute` overlay; other routes `sticky`.
- [ ] Civilian nav + avatar have explicit responsive rules (no mobile hide regression).
- [ ] `eslint` clean, `npm run lint` 0 new errors, `npm run build` passes,
      `vitest run landing.test.tsx PublicHeader.test.tsx` green.

## Reviewer findings (openai-codex/gpt-5.6-terra, fresh context — 2026-07-17)

Verdict: REVISE. Two BLOCKERs drove the architectural correction above (now steps 0 + 3):

- **BLOCKER — theme context unreachable by `PublicHeader`.** `LayoutShell` mounts
  `PublicHeader` outside any provider; `usePublicTheme()` would return the no-op default.
  *Fixed by step 0:* `LayoutShell` now wraps public routes in `<PublicThemeProvider
  showHeader={false}>`, so context + `.public-surface` tokens reach `PublicHeader`.
- **BLOCKER — CSS scope gap.** `public-surface.css` is `.public-surface`-scoped and imported
  only by report/tracking; `PublicHeader` mounts on 11 route patterns outside that wrapper,
  so hoisting `.landing-header` there would be invisible. *Fixed by step 3:* new global
  `public-header.css` imported in `layout.tsx`, reaching every public route.
- **WARNING — incomplete extraction / responsive regression.** `page.tsx:892-893` hides every
  `.btn-ghost`/`.btn-outline` on mobile, which would hide the civilian Home/Dashboard/
  Information links. *Fixed by step 3:* explicit civilian-nav + avatar responsive rules.
- **WARNING — test plan misstated coverage.** `landing.test.tsx` asserts only 3 links (no
  theme-toggle); `PublicHeader.test.tsx` `.public-header`/FAB selectors become invalid.
  *Fixed by step 6:* corrected assertions + one-header route tests.
- **INFO — prototype nav also has Incidents + Profile.** Deliberately narrowed to Home/
  Dashboard/Information per user intent; recorded as intentional deviation.

## Out of scope
- New navbar component (explicitly NOT built).
- Replacing the emoji toggle with an icon (separate design-system decision).
- Promoting `PublicThemeProvider` to app-wide theme owner (bigger refactor).
- Staff dashboard navbar (existing `Sidebar` untouched).

## Verification plan
1. `npx eslint src/frontend/src/components/PublicHeader.tsx src/frontend/src/app/page.tsx
   src/frontend/src/components/public/PublicThemeProvider.tsx src/frontend/src/components/LayoutShell.tsx`
2. `npx vitest run src/app/__tests__/landing.test.tsx src/components/__tests__/PublicHeader.test.tsx`
3. `npm run lint` (0 new errors) and `npm run build` (passes)
4. Manual: `/` anonymous → canonical opaque navbar + `ps-theme-toggle`; log in as civilian →
   Home/Dashboard/Information + avatar, SAME opaque style; toggle persists across refresh;
   staff login → `PublicHeader` absent, `Sidebar` present; `/report` & `/tracking` show single
   header; `/login`, `/register`, `/contributor`, `/information` all show the same chrome.
