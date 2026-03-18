#!/bin/bash
# Seed verified incidents for the National Analyst dashboard analytics.
# Populates heatmap, trends, and comparative endpoints.
# Run from project root: ./scripts/seed-analytics-incidents.sh
# Prerequisite: Docker Compose stack running (postgres healthy)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/src/docker-compose.yml"
SQL_FILE="$SCRIPT_DIR/seed-analytics-incidents.sql"

cd "$PROJECT_ROOT"

echo "Waiting for postgres to be ready (max 30s)..."
elapsed=0
while [ $elapsed -lt 30 ]; do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U postgres -d wims 2>/dev/null; then
    echo "Postgres is ready."
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

if [ $elapsed -ge 30 ]; then
  echo "ERROR: Postgres did not become ready within 30s."
  echo "Ensure Docker Compose is running: docker compose -f src/docker-compose.yml up -d"
  exit 1
fi

echo "Seeding analytics incidents..."
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d wims -f - < "$SQL_FILE"

echo ""
echo "Done! 100 verified incidents seeded for the analyst dashboard."
echo "Log in as analyst_test or admin_test to view heatmap, trends, and comparative data."
