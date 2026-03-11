# SKILL: NEXT.JS APP ROUTER (v14+)

## 1. COMPONENT ARCHITECTURE
- Default to **Server Components** (`React Server Components`).
- Only use `"use client"` when interactivity (hooks, event listeners) or browser APIs (localStorage) are strictly required.
- Push `"use client"` boundaries as far down the component tree as possible.

## 2. API ABSTRACTION (THE BRIDGE)
- The Next.js frontend DOES NOT talk to the database or Redis directly.
- The Next.js frontend acts as a proxy/client to the FastAPI backend.
- Use native `fetch()` or `httpx` equivalent in Next.js API Routes (`app/api/.../route.ts`) to bridge requests to the FastAPI service.

## 3. ASYNC LAYOUTS & PAGES
- Leverage async/await directly in Server Components for data fetching.
- Always include `loading.tsx` and `error.tsx` boundaries to handle latency and API failures gracefully.