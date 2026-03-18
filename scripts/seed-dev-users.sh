#!/bin/bash
# Seed dev users into Keycloak and sync to wims.users.
# Run from project root: ./scripts/seed-dev-users.sh
# chmod +x scripts/seed-dev-users.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/src/docker-compose.yml"
KEYCLOAK_CONTAINER="wims-keycloak"
KC_SERVER="http://localhost:8080/auth"
KC_REALM="bfp"
KC_ADMIN_USER="admin"
KC_ADMIN_PASS="admin"
PASSWORD="password123"

# Users: username, email, role, assigned_region_id (empty = NULL)
# Regional Encoder -> REGIONAL_ENCODER, region 1
# National Validator -> VALIDATOR, NULL
# National Analyst -> NATIONAL_ANALYST, NULL
# System Administrator -> SYSTEM_ADMIN, NULL
declare -a USERS=(
  "encoder_test|encoder@bfp.gov.ph|REGIONAL_ENCODER|1"
  "validator_test|validator@bfp.gov.ph|VALIDATOR|"
  "analyst_test|analyst@bfp.gov.ph|NATIONAL_ANALYST|"
  "analyst1_test|analyst1_test@gmail.com|NATIONAL_ANALYST|"
  "admin_test|admin@bfp.gov.ph|SYSTEM_ADMIN|"
)

declare -a ROLES=(REGIONAL_ENCODER VALIDATOR ANALYST NATIONAL_ANALYST SYSTEM_ADMIN)

cd "$PROJECT_ROOT"

echo "Waiting for wims-keycloak to be ready (max 60s)..."
elapsed=0
while [ $elapsed -lt 60 ]; do
  status=$(docker inspect --format='{{.State.Health.Status}}' "$KEYCLOAK_CONTAINER" 2>/dev/null || true)
  if [ "$status" = "healthy" ]; then
    echo "Keycloak is healthy."
    break
  fi
  # Fallback: no healthcheck configured — wait for running and try kcadm
  run_status=$(docker inspect --format='{{.State.Status}}' "$KEYCLOAK_CONTAINER" 2>/dev/null || true)
  if [ "$run_status" = "running" ] && [ $elapsed -ge 5 ]; then
    if docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh config credentials \
      --server "$KC_SERVER" --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASS" 2>/dev/null; then
      echo "Keycloak is ready (kcadm login succeeded)."
      break
    fi
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

if [ $elapsed -ge 60 ]; then
  echo "ERROR: Keycloak did not become ready within 60s."
  exit 1
fi

echo "Authenticating with Keycloak Admin..."
docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh config credentials \
  --server "$KC_SERVER" --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASS"

echo "Creating realm roles (ignore if already exist)..."
for role in "${ROLES[@]}"; do
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh create roles -r "$KC_REALM" -s name="$role" 2>/dev/null || true
done

echo "Creating users and syncing to PostgreSQL..."
for entry in "${USERS[@]}"; do
  IFS='|' read -r username email role region_id <<< "$entry"
  echo "--- $username ($role) ---"

  # Create user (ignore if exists)
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh create users -r "$KC_REALM" \
    -s username="$username" -s enabled=true -s email="$email" 2>/dev/null || true

  # Set password
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh set-password -r "$KC_REALM" \
    --username "$username" --new-password "$PASSWORD"

  # Assign role
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh add-roles -r "$KC_REALM" \
    --uusername "$username" --rolename "$role" 2>/dev/null || true

  # Fetch Keycloak UUID (extract first UUID from JSON)
  uuid=$(docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get users -r "$KC_REALM" -q username="$username" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$uuid" ]; then
    echo "WARN: Could not get UUID for $username, skipping PostgreSQL sync."
    continue
  fi
  echo "  Keycloak UUID: $uuid"

  # Build assigned_region_id for SQL
  if [ -n "$region_id" ]; then
    region_sql="$region_id"
  else
    region_sql="NULL"
  fi

  sql="INSERT INTO wims.users (user_id, keycloak_id, username, role, assigned_region_id, is_active)
       VALUES ('$uuid'::uuid, '$uuid'::uuid, '$username', '$role', $region_sql, TRUE)
       ON CONFLICT (keycloak_id) DO UPDATE SET
         username = EXCLUDED.username,
         role = EXCLUDED.role,
         assigned_region_id = EXCLUDED.assigned_region_id,
         is_active = EXCLUDED.is_active,
         updated_at = now();"

  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d wims -c "$sql"
done

echo ""
echo "Done! Users: encoder_test, validator_test, analyst_test, analyst1_test, admin_test (password: $PASSWORD)"
