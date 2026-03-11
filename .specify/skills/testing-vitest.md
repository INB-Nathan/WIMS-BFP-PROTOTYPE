# SKILL: ADVERSARIAL TESTING (VITEST / PYTEST)

## 1. THE DESTRUCTIVE MINDSET
Your goal is to break the system. You are looking for race conditions, vibe-coded UI, and unhandled network failures.

## 2. UI QUANTIFICATION TESTS
- Do not test if a button "looks red". Test the AST/source code for forbidden strings (e.g., `fs.readFileSync` combined with regex matching `bg-red-`).
- Assert that components exclusively use `-theme-` semantic classes.

## 3. NETWORK & THROTTLING TESTS
- When testing rate limits, simulate concurrent bursts using `Promise.all` or `asyncio.gather`.
- Assert strict boundary conditions (e.g., Request 5 passes, Request 6 returns HTTP 429).
- Always verify the presence and dynamic nature of the `Retry-After` header.

## 4. ISOLATION
- State must not leak between tests. Always use setup/teardown hooks (e.g., flushing the Redis test DB, clearing cookies).