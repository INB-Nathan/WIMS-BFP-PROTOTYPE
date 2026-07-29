# Frontend Instructions

## Scope and Context

Applies to `src/frontend/` and descendants. It supplements the root and
`src/AGENTS.md`; backend authorization, RLS, PII, and audit boundaries remain
non-negotiable.

Read on demand:

- `src/app/` — Next.js App Router pages, layouts, and route handlers
- `src/components/` — reusable and domain UI
- `src/lib/api/` plus `src/lib/api.ts` — browser/server transport and domain clients
- `src/types/` — shared frontend API types
- `src/context/` and `src/hooks/` — auth and reusable state
- `src/lib/offlineStore.ts`, `src/lib/syncEngine.ts`, `src/lib/connectivity.ts` — offline state machine
- `public/sw.js` and `public/manifest.webmanifest` — PWA runtime
- `package.json`, `eslint.config.mjs`, `vitest.config.ts`, `tsconfig.json` — gates

Discover routes from the live tree: `find src/app/ -name 'page.tsx' -o -name 'route.ts' | sort`.
PWA/offline design is documented inline in the offline store, sync engine, and
connectivity modules under `src/lib/`.

## App and Data Boundaries

- Prefer Server Components unless browser APIs, event handlers, or client state
  require `"use client"`. Keep the client boundary as narrow as the existing route
  pattern allows.
- Presentational components receive data/actions through props. Put reusable data
  access and stateful behavior in established API modules, hooks, or domain libs.
- Application API calls belong in `src/lib/api/` (or the existing compatibility
  facade), not as new component-local `fetch()` calls. Existing callback, health,
  public transport, or App Router server-boundary exceptions are not general
  patterns to copy.
- Keep transport behavior centralized: credentials/cookies, CSRF, error mapping,
  auth refresh, base URLs, and response parsing must remain consistent.
- Coordinate backend contract changes with frontend types, API clients, callers,
  loading/error/empty states, and tests. Do not duplicate security-critical backend
  validation; client validation exists for UX only.
- Frontend role checks control navigation and visibility, never authorization.
- Never connect to PostgreSQL or expose server credentials through `NEXT_PUBLIC_*`.

## Offline/PWA Contract

Read the adjacent offline-store tests and the sync-engine source before any
offline change.

- Preserve IndexedDB upgrade migrations and existing stores; never delete or rename
  a store/version path without an explicit migration and compatibility test.
- Preserve per-user cache/queue namespacing, logout/account-switch cleanup, and the
  encryption boundary for sensitive cached data.
- Do not make every request offline-capable by default. Use the established wrapper
  for the operation class: cacheable read, queued/idempotent mutation, or explicitly
  online-only action.
- Keep queued operations ordered, idempotent, conflict-aware, and retry-safe. Do not
  remove a compatibility path merely because the newer queue works in one test.
- `navigator.onLine` is only a hint; use the shared connectivity monitor/probe and
  existing network-error classification.
- Service workers must not replay authenticated mutations without the page-owned
  auth/ordering path. Keep auth/API routes out of unsafe caches and never cache PII
  in plaintext.
- When changing cache keys, TTL, schema, replay, service-worker routes, or role
  prefetch, add regression coverage for offline, reconnect, account switch, stale
  cache, and failure behavior as applicable.

## UI and Accessibility

- Follow the nearest established component/test/style pattern; avoid repo-wide
  visual or formatting churn.
- Preserve keyboard access, focus behavior, labels, semantic controls, loading and
  error announcements, reduced-motion expectations, and responsive layouts when
  modifying interactive UI.
- Use native controls before custom interaction primitives where they satisfy the
  design. Do not weaken guarded destructive/terminal actions for convenience.
- Map components and browser-only libraries may require the existing dynamic-import
  split; verify SSR and production build behavior before changing it.

## Tests and Validation

Test placement is mixed intentionally: some tests are adjacent, others live in the
nearest `__tests__/`. Follow the closest domain convention rather than moving tests
unrelated to the change.

Run from `src/frontend/`:

```bash
# Reproducible install when dependencies/lockfile or a clean environment matters
npm ci

# Fast targeted loop
npx vitest run path/to/changed.test.tsx
npm run lint

# Full frontend gate
npx vitest run
npm run build
```

The production build performs the strict TypeScript/Next.js check. Safe local build
placeholders matching CI are:

```bash
NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth/realms/bfp \
NEXT_PUBLIC_BASE_URL=http://localhost \
NEXT_PUBLIC_MAPBOX_TOKEN= \
npm run build
```

Also:

- Do not edit `node_modules/`, `.next/`, generated type files, coverage, or build
  output.
- Treat lint warnings as review input even when only errors block CI; identify new
  warnings caused by the change.
- For PWA/service-worker changes, run focused offline tests plus the production
  build; jsdom unit success alone does not prove browser caching behavior.
- Before a push/PR, use `.github/workflows/ci.yml` and
  `docs/agents/ci-preflight.md` for the exact clean-install lint/test/build gate.
