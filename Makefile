.PHONY: help dev dev-build down prod-up prod-nginx test test-backend test-frontend lint lint-backend lint-frontend format ci-local status

# =============================================================================
# WIMS-BFP Development Workflow
# =============================================================================

help:
	@echo "WIMS-BFP Makefile"
	@echo ""
	@echo "  make dev           Start full stack (Docker Compose)"
	@echo "  make dev-build     Rebuild images then start"
	@echo "  make down          Stop all containers"
	@echo "  make prod-up       Start VPS production stack with TLS"
	@echo "  make prod-nginx    Recreate VPS nginx with TLS config"
	@echo ""
	@echo "  make test          Run all tests (backend + frontend)"
	@echo "  make test-backend  Backend pytest"
	@echo "  make test-frontend Frontend Vitest"
	@echo ""
	@echo "  make lint          Lint everything"
	@echo "  make lint-backend  Backend ruff"
	@echo "  make lint-frontend Frontend ESLint"
	@echo ""
	@echo "  make format       Format code (ruff + prettier)"
	@echo "  make ci-local     Simulate CI pipeline locally"
	@echo ""

# -----------------------------------------------------------------------------
# Docker
# -----------------------------------------------------------------------------

dev:
	cd src && docker compose up --build

dev-build:
	cd src && docker compose build --no-cache && docker compose up -d

down:
	cd src && docker compose down

prod-up:
	cd src && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --build

prod-nginx:
	cd src && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate nginx-gateway

# -----------------------------------------------------------------------------
# Tests
# -----------------------------------------------------------------------------

test: test-backend test-frontend

test-backend:
	cd src/backend && pytest -v

test-frontend:
	cd src/frontend && npx vitest run

# -----------------------------------------------------------------------------
# Linting
# -----------------------------------------------------------------------------

lint: lint-backend lint-frontend

lint-backend:
	cd src/backend && ruff check .

lint-frontend:
	cd src/frontend && npm run lint

# -----------------------------------------------------------------------------
# Formatting
# -----------------------------------------------------------------------------

format:
	cd src/backend && ruff format .
	cd src/frontend && npx prettier --write .

# -----------------------------------------------------------------------------
# Local CI simulation
# -----------------------------------------------------------------------------

ci-local: lint test
	@echo "Local CI passed."

# -----------------------------------------------------------------------------
# Status
# -----------------------------------------------------------------------------

status:
	@cd src && docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# =============================================================================
# Notes
# =============================================================================
# All commands run from the project root unless noted.
# Backend tests require Docker services (postgres, redis) running.
# Frontend tests run standalone without Docker.
# Backend pytest uses the deterministic .env.example WIMS_MASTER_KEY if unset.
# Set a real WIMS_MASTER_KEY in src/.env for manual backup encryption testing.
