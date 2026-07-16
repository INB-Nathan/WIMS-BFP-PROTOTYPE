# Implementation Plan — Unified auth-aware navbar + `ps-*` theme toggle (#654)

**Spec:** `2026-07-17-public-header-theme-unify-design.md` (approved 2026-07-17)
**Branch:** `feat/654-public-header-theme-unify` (base `5bb7f458`)

## Dependency order (must follow)
1. **Step 0 (LayoutShell provider)** MUST land first — `PublicHeader` cannot call
   `usePublicTheme()` until it is wrapped by `PublicThemeProvider`.
2. **Step 3 (global CSS)** MUST land before Step 1 removes `PublicHeader`'s `<style jsx>`,
   otherwise the header is unstyled.
3. Steps 1, 2, 4, 5 can follow in any order after 0 + 3.
4. Step 6 (tests) last.

---

## Step 0 — `LayoutShell.tsx`: single public-theme owner (BLOCKER fix)
**File:** `src/frontend/src/components/LayoutShell.tsx`
**Anchor:** import block `~8` + public-route return `~84-93`.
**Change:**
- Add `import { PublicThemeProvider } from './public/PublicThemeProvider';`
- Replace the public-route return:
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
**Why:** makes `usePublicTheme()` context + `.public-surface` token scope reach `PublicHeader`
and landing `/`. `showHeader={false}` suppresses the provider's own `ps-header` chrome.
**Verify:** `PublicHeader` and landing now render inside `<div className="public-surface">`.

## Step 1 — `PublicHeader.tsx`: rewrite as `.landing-header` (retire `.public-header`)
**File:** `src/frontend/src/components/PublicHeader.tsx`
**Anchor:** full file — `.public-header` DOM `~33-110`, `<style jsx>` `~113-227`.
**Change:**
- Add `import { usePublicTheme } from '@/components/public/PublicThemeProvider';`
- Keep `useAuth()` + `isStaff` → `return null` logic.
- Render `.landing-header` DOM (BFP `<img>` logo, title, right cluster) — same markup as
  `page.tsx:79-104`.
- Anonymous: `btn-theme-toggle` + Register (`btn-ghost`→/register) + Sign In (`btn-outline`→/login)
  + Report a Fire (`btn-primary`→/report).
- Civilian: `btn-theme-toggle` + Home (`btn-ghost`→/) + Dashboard (`btn-ghost`→/contributor)
  + Information (`btn-ghost`→/information) + avatar + Report a Fire (`btn-primary`→/report,
  hidden when `pathname === '/report'`).
- Avatar: `user.preferred_username?.[0]?.toUpperCase()` / `user.email?.[0]` / `user.sub?.[0]`;
  `aria-label` = email or username.
- Theme toggle: `className="btn-theme-toggle"`, `data-testid="theme-toggle"`,
  `onClick={toggleTheme}`, label `🌙 Dark`/`☀️ Light` from `const { theme, toggleTheme } = usePublicTheme();`
- DELETE the entire `<style jsx>` block (styling now from global `public-header.css`).

## Step 2 — `page.tsx`: landing consumes provider theme
**File:** `src/frontend/src/app/page.tsx`
**Anchor:** `useState` theme `~62-67`, `useEffect` persist `~69-71`, `toggleTheme` `~73-75`,
`btn-theme-toggle` JSX `~97-101`, `<style>` block `.landing-header*` `~322-419` + light
overrides `~726-742`.
**Change:**
- Remove local `useState`/`useEffect` theme + `toggleTheme`; `import { usePublicTheme } from '@/components/public/PublicThemeProvider';`
  and `const { theme, toggleTheme } = usePublicTheme();`
- Keep `.landing-header` JSX as anonymous state; `btn-theme-toggle` reads provider `theme`/`toggleTheme`.
- Keep `.scene-landing` wrapper + `data-theme={theme}`.
- In the `<style>` block: DELETE base `.landing-header*` rules (now global); KEEP
  `.scene-landing .landing-header { position: absolute; ... }` overlay override + scene-specific
  tweaks.

## Step 3 — New global `public-header.css` (BLOCKER fix)
**File (new):** `src/frontend/src/styles/public-header.css`
**Import:** add `import "./public-header.css";` in `src/frontend/src/app/layout.tsx` after
`import "./globals.css";` (`layout.tsx:3`).
**Content:** move from `page.tsx` `<style>` block:
- `.landing-header` base: `position: sticky; top:0; z-index:100; height:52px; padding:0 20px;
  background: var(--bg-deep,#0a0a0e); border-bottom:1px solid var(--border-strong,...); display:flex;
  justify-content:space-between; align-items:center;`
- `.landing-header-left/-logo/-bfp-logo/-title`, `.landing-header-right`,
  `.landing-header-right .btn-ghost/-outline/-primary` (+ `:hover`/`:focus-visible`) using
  `var(--text-secondary)`, `var(--text-primary)`, `var(--border-strong)`, `var(--red)`,
  `var(--red-deep)` — exact values from `page.tsx:362-419`.
- `[data-theme="light"]` overrides (from `page.tsx:726-742`).
- Civilian nav + avatar (prototype `ah-primary-nav`/`ah-avatar`,
  `prototypes/public-surface/index.html:1304-1309, 1171-1180`):
  `.landing-header-nav { display:none } @media(min-width:768px){ .landing-header-nav{display:flex} }`
  `.landing-header-avatar { width:32px;height:32px;border-radius:50%;background:var(--bg-surface);
  color:var(--text-secondary);... }`
- **Responsive guard:** civilian nav links use their own class (not bare `.btn-ghost`) OR add
  explicit `.landing-header-nav .btn-ghost { display:inline }` on mobile so `page.tsx:892-893`
  (which hides `.btn-ghost`/`.btn-outline` in `.landing-header-right`) does NOT hide them.
**Verify:** `PublicHeader` (outside `.public-surface`? no — it's now inside provider wrapper)
resolves `var(--*)` and shows correct dark chrome on `/login`, `/register`, `/contributor`, etc.

## Step 4 — `PublicThemeProvider.tsx`: add `showHeader` prop
**File:** `src/frontend/src/components/public/PublicThemeProvider.tsx`
**Anchor:** signature `~31`, `ps-header` JSX `~54-72`.
**Change:** `export function PublicThemeProvider({ children, showThemeToggle = true, showHeader = true }: ...)`.
Conditionally render `{showHeader && (<header className="ps-header">...</header>)}`.
Keep `usePublicTheme` export + `.public-surface` wrapper + footer unchanged.

## Step 5 — `report/page.tsx` & `tracking/page.tsx`: drop own provider + css import
**Files:** `src/frontend/src/app/report/page.tsx`, `src/frontend/src/app/tracking/page.tsx`
**Anchor:** `report/page.tsx:4-5,15-17`; `tracking/page.tsx:9-10,52-108`.
**Change:**
- Delete `import { PublicThemeProvider } ...` and `import '@/styles/public-surface.css';`.
- Return `<ReportWizard />` / page content directly (no `<PublicThemeProvider>` wrapper —
  `LayoutShell` now provides it).
**Verify:** `/report` and `/tracking` render exactly ONE header (no `ps-header` duplicate).

## Step 6 — Tests
**File:** `src/frontend/src/components/__tests__/PublicHeader.test.tsx`
- Replace all `.public-header` selectors with `.landing-header` (staff asserts ~:201-287,
  FAB tests ~:148-179 → remove FAB expectations or convert to `.landing-header` report link).
- Add civilian assertions: Home/Dashboard/Information links present + `.landing-header-avatar`
  present + `theme-toggle` present.
- Add anonymous: Register/Sign In present.
- Staff: header absent (`queryByRole('banner')` / `.landing-header` null).

**File:** `src/frontend/src/app/__tests__/landing.test.tsx`
- Keep `header-register`/`header-signin`/`header-report` assertions (~121-127).
- Add `theme-toggle` presence assertion.
- If `<LandingPage />` rendered in isolation, wrap in `<PublicThemeProvider>` (it is inside
  `LayoutShell`'s provider at runtime).

**New (route-level one-header):**
- Render `/report` and `/tracking` (mocked) and assert exactly one `<header>` element present.

---

## Verification checklist
1. `npx eslint src/frontend/src/components/PublicHeader.tsx src/frontend/src/app/page.tsx
   src/frontend/src/components/public/PublicThemeProvider.tsx src/frontend/src/components/LayoutShell.tsx`
2. `npx vitest run src/app/__tests__/landing.test.tsx src/components/__tests__/PublicHeader.test.tsx`
3. `npm run lint` (0 new errors)
4. `npm run build` (passes)
5. Manual: `/` anon → opaque `.landing-header` + `ps-theme-toggle`; civilian login →
   Home/Dashboard/Information + avatar, same chrome; toggle persists on refresh; staff →
   `PublicHeader` absent, `Sidebar` present; `/report` + `/tracking` single header;
   `/login`,`/register`,`/contributor`,`/information` same chrome; landing `/` immersive
   `position:absolute` overlay intact.
