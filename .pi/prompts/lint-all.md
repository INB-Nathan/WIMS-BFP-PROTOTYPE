Run all linters: backend ruff check + ruff format check, frontend lint.

cd src/backend && ruff check . && ruff format --check . && cd ../frontend && npm run lint
