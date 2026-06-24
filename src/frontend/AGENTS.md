# frontend Agent Instructions

## Read First

- `frontend/src/app/` — Next.js App Router pages
- `frontend/src/components/` — React components
- `frontend/src/lib/` — client libraries, API wrappers, offline stores
- `frontend/src/lib/api/offline*.ts` — offline-aware read wrappers
- `frontend/src/lib/offlineStore.ts` — IndexedDB stores
- `frontend/src/lib/syncEngine.ts` — offline sync engine

Architecture references:
- `system-wiki/frontend/route-map.md` — Next.js route surface map
- `system-wiki/architecture/pwa-tests-cicd.md` — offline/PWA design

## Frontend Rules

- **Components stay presentational.** Data fetching and state management live in custom hooks or client libraries (`src/lib/`), not in component bodies.
- **API calls go through the client layer.** Use the API wrappers in `src/lib/api/`. Never call `fetch()` directly from a component.
- **No duplicated backend validation.** Frontend validation is for UX (inline errors, format hints). Security-critical validation is server-side only.
- **Offline-aware pattern.** All data-fetching hooks should handle `navigator.onLine === false` gracefully, using IndexedDB fallbacks from `offlineStore.ts`.
- **Role checks are UI-only.** Role-based rendering (`if (role === 'admin')`) controls what the user sees, not what they can access. Security is enforced server-side.
- **Colocate tests.** Place `Component.test.tsx` and `Component.test.ts` next to the source file.

## Build & Test

| Action | Command |
|--------|---------|
| Dev server | `npm run dev` (from `src/frontend/`) |
| Production build | `npm run build` (from `src/frontend/`) |
| Lint | `npm run lint` (ESLint — errors block, warnings OK) |
| Tests | `npx vitest run` (Vitest + React Testing Library + jsdom) |

**Required env vars** (safe dummy values for local dev):
```bash
export NEXT_PUBLIC_AUTH_API_URL="http://localhost:8080/auth/realms/bfp"
export NEXT_PUBLIC_MAPBOX_TOKEN=""
export NEXT_PUBLIC_BASE_URL="http://localhost"
```

## TypeScript/React Conventions

- `PascalCase` for components and file names
- `camelCase` for functions and variables
- Colocate tests beside source (`Component.test.tsx`)
- Follow existing ESLint and Next.js conventions
- Avoid broad formatting churn
