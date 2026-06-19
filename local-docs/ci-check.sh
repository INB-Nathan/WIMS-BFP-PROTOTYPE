#!/usr/bin/env bash
# ci-check.sh — Run all checks that must pass before a PR can merge.
# Usage: bash local-docs/ci-check.sh [--no-tests]
#
# Mirrors what GitHub Actions runs via make ci-local:
#   1. Backend ruff (lint + format check)
#   2. Frontend ESLint
#   3. Backend pytest   (skips test_scheduled_reports.py — missing croniter dep)
#   4. Frontend Vitest
#
# Exit code 0 = everything passed. Non-zero = at least one step failed.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_TESTS="${1:-}"
FAILED=()

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔ $*${RESET}"; }
fail() { echo -e "${RED}✗ $*${RESET}"; FAILED+=("$*"); }
info() { echo -e "${YELLOW}▶ $*${RESET}"; }

echo "════════════════════════════════════════════════════"
echo " WIMS-BFP CI pre-flight — $(date '+%Y-%m-%d %H:%M')"
echo "════════════════════════════════════════════════════"

# ── 1. Backend ruff lint ──────────────────────────────────────────────────────
info "Backend: ruff check"
if (cd "$ROOT/src/backend" && python -m ruff check .); then
    ok "Backend ruff lint"
else
    fail "Backend ruff lint"
fi

# ── 2. Backend ruff format check ─────────────────────────────────────────────
info "Backend: ruff format --check"
if (cd "$ROOT/src/backend" && python -m ruff format --check .); then
    ok "Backend ruff format"
else
    fail "Backend ruff format  →  run: cd src/backend && ruff format ."
fi

# ── 3. Frontend ESLint ────────────────────────────────────────────────────────
info "Frontend: ESLint"
if (cd "$ROOT/src/frontend" && npm run lint --silent); then
    ok "Frontend ESLint"
else
    fail "Frontend ESLint"
fi

# ── 4. Backend pytest ─────────────────────────────────────────────────────────
if [[ "$SKIP_TESTS" == "--no-tests" ]]; then
    echo -e "${YELLOW}⚠ Tests skipped (--no-tests)${RESET}"
else
    # Detect Docker availability; if down, run only @unit-marked tests
    PYTEST_MARKER=""
    if ! docker info &>/dev/null 2>&1; then
        echo -e "${YELLOW}⚠ Docker not running — running unit tests only (skip integration)${RESET}"
        PYTEST_MARKER="-m unit"
    fi

    info "Backend: pytest $PYTEST_MARKER"
    if (cd "$ROOT/src/backend" && python -m pytest \
            --ignore=tests/test_scheduled_reports.py \
            $PYTEST_MARKER --tb=short -q 2>&1); then
        ok "Backend pytest"
    else
        fail "Backend pytest"
    fi

    # ── 5. Frontend Vitest ────────────────────────────────────────────────────
    info "Frontend: Vitest"
    if (cd "$ROOT/src/frontend" && npx vitest run --reporter=verbose 2>&1); then
        ok "Frontend Vitest"
    else
        fail "Frontend Vitest"
    fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
if [[ ${#FAILED[@]} -eq 0 ]]; then
    echo -e "${GREEN}All checks passed — branch is CI-ready.${RESET}"
    exit 0
else
    echo -e "${RED}${#FAILED[@]} check(s) failed:${RESET}"
    for f in "${FAILED[@]}"; do echo -e "  ${RED}• $f${RESET}"; done
    exit 1
fi
