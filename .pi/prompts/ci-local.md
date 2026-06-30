Run local CI simulation: backend lint + format check, backend tests, frontend lint + tests + build. Corresponds to `docs/agents/ci-preflight.md`.

cd src/backend && ruff check . && ruff format --check . && pytest -v --tb=short && cd ../frontend && npm run lint && npx vitest run && npm run build
