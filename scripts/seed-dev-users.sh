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

# Keep docker exec path arguments Linux-style under Git Bash on Windows.
docker_exec() {
  if [ -n "${MSYSTEM:-}" ]; then
    MSYS_NO_PATHCONV=1 docker exec "$@"
  else
    docker exec "$@"
  fi
}

# Users: username, email, role, assigned_region_id (empty = NULL)
# Regional Encoder   -> REGIONAL_ENCODER,   region 1
# National Validator -> NATIONAL_VALIDATOR, region 1  (must have region for validator workflow)
# National Analyst   -> NATIONAL_ANALYST,   NULL
# System Admin       -> SYSTEM_ADMIN,        NULL
#
# NOTE: role was previously 'VALIDATOR' — changed to 'NATIONAL_VALIDATOR' to match
#       the authoritative application role string used in auth.py and all route guards.
declare -a USERS=(
  "encoder_test|encoder@bfp.gov.ph|REGIONAL_ENCODER|1"
  "encoder_r02|encoder_r02@bfp.gov.ph|REGIONAL_ENCODER|2"
  "encoder_r03|encoder_r03@bfp.gov.ph|REGIONAL_ENCODER|3"
  "encoder_r04|encoder_r04@bfp.gov.ph|REGIONAL_ENCODER|4"
  "encoder_r05|encoder_r05@bfp.gov.ph|REGIONAL_ENCODER|5"
  "encoder_r06|encoder_r06@bfp.gov.ph|REGIONAL_ENCODER|6"
  "encoder_r07|encoder_r07@bfp.gov.ph|REGIONAL_ENCODER|7"
  "encoder_r08|encoder_r08@bfp.gov.ph|REGIONAL_ENCODER|8"
  "encoder_r09|encoder_r09@bfp.gov.ph|REGIONAL_ENCODER|9"
  "encoder_r10|encoder_r10@bfp.gov.ph|REGIONAL_ENCODER|10"
  "encoder_r11|encoder_r11@bfp.gov.ph|REGIONAL_ENCODER|11"
  "encoder_r12|encoder_r12@bfp.gov.ph|REGIONAL_ENCODER|12"
  "encoder_r13|encoder_r13@bfp.gov.ph|REGIONAL_ENCODER|13"
  "encoder_r14|encoder_r14@bfp.gov.ph|REGIONAL_ENCODER|14"
  "encoder_r15|encoder_r15@bfp.gov.ph|REGIONAL_ENCODER|15"
  "encoder_r16|encoder_r16@bfp.gov.ph|REGIONAL_ENCODER|16"
  "encoder_r17|encoder_r17@bfp.gov.ph|REGIONAL_ENCODER|17"
  "encoder_r18|encoder_r18@bfp.gov.ph|REGIONAL_ENCODER|18"
  "validator_test|validator@bfp.gov.ph|NATIONAL_VALIDATOR|1"
  "analyst_test|analyst@bfp.gov.ph|NATIONAL_ANALYST|"
  "analyst1_test|analyst1_test@gmail.com|NATIONAL_ANALYST|"
  "admin_test|admin@bfp.gov.ph|SYSTEM_ADMIN|"
)

declare -a ROLES=(REGIONAL_ENCODER NATIONAL_VALIDATOR ANALYST NATIONAL_ANALYST SYSTEM_ADMIN)

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
    if docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh config credentials \
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
docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh config credentials \
  --server "$KC_SERVER" --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASS"

echo "Creating realm roles (ignore if already exist)..."
for role in "${ROLES[@]}"; do
  docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh create roles -r "$KC_REALM" -s name="$role" 2>/dev/null || true
done

# Some local DBs may not yet include NATIONAL_ANALYST in users_role_check.
supports_national_analyst=$(docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d wims -tA -c "SELECT CASE WHEN pg_get_constraintdef(c.oid) LIKE '%NATIONAL_ANALYST%' THEN '1' ELSE '0' END FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='wims' AND c.conname='users_role_check' LIMIT 1;")
supports_national_analyst=$(echo "$supports_national_analyst" | tr -d '[:space:]')

echo "Creating users and syncing to PostgreSQL..."
for entry in "${USERS[@]}"; do
  IFS='|' read -r username email role region_id <<< "$entry"
  echo "--- $username ($role) ---"

  # Create user (ignore if exists)
  docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh create users -r "$KC_REALM" \
    -s username="$username" -s enabled=true -s email="$email" 2>/dev/null || true

  # Set password
  docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh set-password -r "$KC_REALM" \
    --username "$username" --new-password "$PASSWORD"

  # Assign role
  docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh add-roles -r "$KC_REALM" \
    --uusername "$username" --rolename "$role" 2>/dev/null || true

  # Fetch Keycloak UUID (extract first UUID from JSON)
  uuid=$(docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get users -r "$KC_REALM" -q username="$username" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$uuid" ]; then
    echo "WARN: Could not get UUID for $username, skipping PostgreSQL sync."
    continue
  fi
  echo "  Keycloak UUID: $uuid"

  db_role="$role"
  if [ "$role" = "NATIONAL_ANALYST" ] && [ "$supports_national_analyst" != "1" ]; then
    db_role="ANALYST"
    echo "  DB role fallback: NATIONAL_ANALYST -> ANALYST (users_role_check compatibility)"
  fi

  # Build assigned_region_id for SQL
  if [ -n "$region_id" ]; then
    region_sql="$region_id"
  else
    region_sql="NULL"
  fi

  sql="UPDATE wims.users SET keycloak_id = '$uuid'::uuid, username = '$username', role = '$db_role', assigned_region_id = $region_sql, is_active = TRUE, updated_at = now() WHERE username = '$username' OR keycloak_id = '$uuid'::uuid; INSERT INTO wims.users (user_id, keycloak_id, username, role, assigned_region_id, is_active) SELECT '$uuid'::uuid, '$uuid'::uuid, '$username', '$db_role', $region_sql, TRUE WHERE NOT EXISTS (SELECT 1 FROM wims.users WHERE username = '$username' OR keycloak_id = '$uuid'::uuid);"

  printf '%s\n' "$sql" | docker compose -f "$COMPOSE_FILE" exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d wims
done

echo ""
echo "Done! Users: encoder_test, validator_test, analyst_test, analyst1_test, admin_test (password: $PASSWORD)"
