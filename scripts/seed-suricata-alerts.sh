#!/bin/bash
# Seed Suricata security alerts for the System Admin hub.
# Run from project root: ./scripts/seed-suricata-alerts.sh
# Prerequisite: Docker Compose stack running (postgres healthy)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/src/docker-compose.yml"
SQL_FILE="$SCRIPT_DIR/seed-suricata-alerts.sql"

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

echo "Seeding Suricata alerts..."
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d wims -f - < "$SQL_FILE"

echo ""
echo "Done! 5 Suricata alerts seeded for the System Admin hub."
echo "Log in as admin_test (SYSTEM_ADMIN) to view the telemetry and AI narratives."
