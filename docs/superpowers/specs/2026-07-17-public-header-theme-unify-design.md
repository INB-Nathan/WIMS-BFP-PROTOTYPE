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

## Current state (verified this session)

- `PublicHeader.tsx` (`src/frontend/src/components/PublicHeader.tsx`) renders `.public-header`
  with OLD glass chrome (`backdrop-filter: blur(10px)`, hardcoded `rgba`/hex) and NO theme
  toggle. Mounted by `LayoutShell.tsx:90` as `{pathname !== '/' && <PublicHeader />}`.
- Landing `page.tsx` renders its own `.landing-header` (anonymous-only, `position: absolute`
  overlay) using LOCAL `useState` theme (lines 62-67) — NOT `PublicThemeProvider`.
- `PublicThemeProvider.tsx` renders its OWN `ps-header` + `ps-theme-toggle` and is wrapped
  around `/report` and `/tracking` content → those routes currently show **two** headers
  (`ps-header` + `PublicHeader`). This is a bug to fix.
- `PublicHeader.test.tsx` already exists with anonymous/civilian/staff assertions.
- `landing.test.tsx` asserts `header-register`/`header-signin`/`header-report` +
  `theme-toggle` on the landing header (16 passing pre-change).

## Implementation

### 1. `PublicHeader.tsx` → rewrite as `.landing-header` component
- Import `usePublicTheme` from `@/components/public/PublicThemeProvider`.
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
- Replace local `useState` theme + `toggleTheme` with `usePublicTheme()`
  (import from `PublicThemeProvider`).
- Keep the `.landing-header` JSX as the anonymous state. `btn-theme-toggle` now reads
  `theme`/`toggleTheme` from the provider context.
- Keep `position: absolute` overlay inline in `page.tsx`'s `<style jsx>` (landing-only).
- Remove the duplicated `.landing-header*` base CSS that moves to `public-surface.css` (#3);
  keep only the landing-specific `position: absolute` + scene overrides.

### 3. Hoist `.landing-header` CSS to `public-surface.css`
- Extract the base `.landing-header`, `.landing-header-left/-logo/-bfp-logo/-title`,
  `.landing-header-right`, `.btn-ghost/-outline/-primary` (+ hover/focus-visible) and the
  `[data-theme="light"]` overrides from `page.tsx` (`page.tsx:322-419`, `726-742`) into
  `src/frontend/src/styles/public-surface.css` near the shared chrome section (line 242+),
  scoped under `.landing-header` (NOT `.scene-landing`). Base rule uses `position: sticky`.
- `page.tsx` keeps an inline override `.scene-landing .landing-header { position: absolute; ... }`
  for the immersive overlay.

### 4. `PublicThemeProvider.tsx` — add `showHeader` prop
- Add `showHeader = true` prop. When `false`, render theme context + `.ps-content` + footer
  but NOT the `ps-header` (so `/report` & `/tracking` don't double up with `PublicHeader`).
- `usePublicTheme` export unchanged.

### 5. `report/page.tsx` & `tracking/page.tsx`
- Pass `showHeader={false}` to `<PublicThemeProvider>` — `PublicHeader` (now `.landing-header`)
  from `LayoutShell` is the single chrome.

### 6. Tests
- `landing.test.tsx`: keep asserting `.landing-header`, `header-register`/`header-signin`/
  `header-report`, `theme-toggle` (now driven by `usePublicTheme` — wrap render in provider or
  keep local; adjust import). Update if class changes.
- `PublicHeader.test.tsx`: extend existing civilian assertions to verify Home/Dashboard/
  Information links + avatar + `theme-toggle` present; verify staff `null`; verify anonymous
  Register/Sign In present.

## Acceptance criteria
- [ ] `PublicHeader` renders `.landing-header` DOM (BFP `<img>` logo, title, `btn-*` buttons).
- [ ] Anonymous: Register/Sign In/Report a Fire + theme toggle, opaque `var(--bg-deep)` chrome.
- [ ] Civilian: Home/Dashboard/Information + avatar + Report a Fire + theme toggle, same chrome.
- [ ] Staff: `PublicHeader` returns `null`; `Sidebar` shown.
- [ ] `/report` & `/tracking` show ONE header (no `ps-header` duplicate).
- [ ] Theme toggle is the single `ps-*` widget backed by `landing-theme`; persists on refresh.
- [ ] Landing `/` keeps immersive `position: absolute` overlay; other routes `sticky`.
- [ ] `eslint` clean, `npm run lint` 0 new errors, `npm run build` passes,
      `vitest run landing.test.tsx PublicHeader.test.tsx` green.

## Out of scope
- New navbar component (explicitly NOT built).
- Replacing the emoji toggle with an icon (separate design-system decision).
- Promoting `PublicThemeProvider` to app-wide theme owner (bigger refactor).
- Staff dashboard navbar (existing `Sidebar` untouched).

## Verification plan
1. `npx eslint src/frontend/src/components/PublicHeader.tsx src/frontend/src/app/page.tsx
   src/frontend/src/components/public/PublicThemeProvider.tsx`
2. `npx vitest run src/app/__tests__/landing.test.tsx src/components/__tests__/PublicHeader.test.tsx`
3. `npm run lint` (0 new errors) and `npm run build` (passes)
4. Manual: `/` anonymous → canonical opaque navbar + `ps-theme-toggle`; log in as civilian →
   Home/Dashboard/Information + avatar, SAME opaque style; toggle persists across refresh;
   staff login → `PublicHeader` absent, `Sidebar` present; `/report` shows single header.
