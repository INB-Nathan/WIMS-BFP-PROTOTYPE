#!/bin/bash
# Seed behavioral anomaly detections for the System Admin anomaly dashboard.
# Run from project root: ./scripts/seed-anomaly-detections.sh
# Prerequisites:
#   - Docker Compose stack running (postgres healthy)
#   - Seed user data already loaded (03_users.sql / seed-dev-users.sh)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/src/docker-compose.yml"
SQL_FILE="$SCRIPT_DIR/seed-anomaly-detections.sql"

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

echo "Seeding anomaly detections..."
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d wims -f - < "$SQL_FILE"

echo ""
echo "Done! 20 anomaly detections seeded for the System Admin anomaly dashboard."
echo "Log in as admin_test (SYSTEM_ADMIN) to view the anomaly detection page."
echo ""
echo "Seeded:"
echo "  Types:    BULK_DELETE, OFF_HOURS, PRIVILEGE_ESCALATION, RAPID_IP_SWITCH, SUSPICIOUS_QUERY_PATTERN"
echo "  Statuses: NEW, ACKNOWLEDGED, RESOLVED"
echo "  Severities: LOW, MEDIUM, HIGH, CRITICAL"
