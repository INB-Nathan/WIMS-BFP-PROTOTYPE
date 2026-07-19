#!/bin/bash
# Seed dev users into Keycloak and sync to wims.users.
# Run from project root: ./scripts/seed-dev-users.sh
# chmod +x scripts/seed-dev-users.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/src/docker-compose.yml"
ENV_FILE="$PROJECT_ROOT/src/.env.production"
KEYCLOAK_CONTAINER="wims-keycloak"
KC_SERVER="http://localhost:8080/auth"
KC_REALM="bfp"
PASSWORD="Password123!"

# Keycloak's actual master-realm admin credentials are set from
# KEYCLOAK_ADMIN/KEYCLOAK_ADMIN_PASSWORD on its first-ever boot (see
# docker-compose.yml's KC_BOOTSTRAP_ADMIN_* env vars) — read the same values
# from .env.production instead of assuming the "admin"/"admin" local-dev
# default, which only matches when that var was never overridden.
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
KC_ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
KC_ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-admin}"

# Keep docker exec path arguments Linux-style under Git Bash on Windows.
docker_exec() {
  if [ -n "${MSYSTEM:-}" ]; then
    MSYS_NO_PATHCONV=1 docker exec "$@"
  else
    docker exec "$@"
  fi
}

# Users: username, email, role, assigned_region_id (empty = NULL), deterministic UUID, legacy username
# Regional Encoders  -> REGIONAL_ENCODER,   region-coded usernames
# National Validator -> NATIONAL_VALIDATOR, region 1  (must have region for validator workflow)
# National Analyst   -> NATIONAL_ANALYST,   NULL
# System Admin       -> SYSTEM_ADMIN,        NULL
#
# NOTE: role was previously 'VALIDATOR' — changed to 'NATIONAL_VALIDATOR' to match
#       the authoritative application role string used in auth.py and all route guards.
declare -a USERS=(
  "encoder_ncr|encoder_ncr@bfp.gov.ph|REGIONAL_ENCODER|1|11111111-1111-4111-8111-111111111111|encoder_test"
  "encoder_car|encoder_car@bfp.gov.ph|REGIONAL_ENCODER|2|ee000002-0000-4002-8002-000000000002|encoder_r02"
  "encoder_r01|encoder_r01@bfp.gov.ph|REGIONAL_ENCODER|3|ee000003-0000-4003-8003-000000000003|encoder_r03"
  "encoder_r02|encoder_r02@bfp.gov.ph|REGIONAL_ENCODER|4|ee000004-0000-4004-8004-000000000004|encoder_r04"
  "encoder_r03|encoder_r03@bfp.gov.ph|REGIONAL_ENCODER|5|ee000005-0000-4005-8005-000000000005|encoder_r05"
  "encoder_r04a|encoder_r04a@bfp.gov.ph|REGIONAL_ENCODER|6|ee000006-0000-4006-8006-000000000006|encoder_r06"
  "encoder_r04b|encoder_r04b@bfp.gov.ph|REGIONAL_ENCODER|7|ee000007-0000-4007-8007-000000000007|encoder_r07"
  "encoder_r05|encoder_r05@bfp.gov.ph|REGIONAL_ENCODER|8|ee000008-0000-4008-8008-000000000008|encoder_r08"
  "encoder_r06|encoder_r06@bfp.gov.ph|REGIONAL_ENCODER|9|ee000009-0000-4009-8009-000000000009|encoder_r09"
  "encoder_r07|encoder_r07@bfp.gov.ph|REGIONAL_ENCODER|10|ee000010-0000-4010-8010-000000000010|encoder_r10"
  "encoder_r08|encoder_r08@bfp.gov.ph|REGIONAL_ENCODER|11|ee000011-0000-4011-8011-000000000011|encoder_r11"
  "encoder_r09|encoder_r09@bfp.gov.ph|REGIONAL_ENCODER|12|ee000012-0000-4012-8012-000000000012|encoder_r12"
  "encoder_r10|encoder_r10@bfp.gov.ph|REGIONAL_ENCODER|13|ee000013-0000-4013-8013-000000000013|encoder_r13"
  "encoder_r11|encoder_r11@bfp.gov.ph|REGIONAL_ENCODER|14|ee000014-0000-4014-8014-000000000014|encoder_r14"
  "encoder_r12|encoder_r12@bfp.gov.ph|REGIONAL_ENCODER|15|ee000015-0000-4015-8015-000000000015|encoder_r15"
  "encoder_r13|encoder_r13@bfp.gov.ph|REGIONAL_ENCODER|16|ee000016-0000-4016-8016-000000000016|encoder_r16"
  "encoder_barmm|encoder_barmm@bfp.gov.ph|REGIONAL_ENCODER|17|ee000017-0000-4017-8017-000000000017|encoder_r17"
  "encoder_nir|encoder_nir@bfp.gov.ph|REGIONAL_ENCODER|18|ee000018-0000-4018-8018-000000000018|encoder_r18"
  "validator_test|validator@bfp.gov.ph|NATIONAL_VALIDATOR|1|22222222-2222-4222-8222-222222222222|"
  "analyst_test|analyst@bfp.gov.ph|NATIONAL_ANALYST||33333333-3333-4333-8333-333333333333|"
  "analyst1_test|analyst1_test@gmail.com|NATIONAL_ANALYST||44444444-4444-4444-8444-444444444444|"
  "admin_test|admin@bfp.gov.ph|SYSTEM_ADMIN||55555555-5555-4555-8555-555555555555|"
  # Team member dev accounts (password: WimsBFP2026!)
  "n-val|n-val@bfp.gov.ph|NATIONAL_VALIDATOR|1|aa000001-0000-4001-8001-aab000000001||WimsBFP2026!"
  "n-enc|n-enc@bfp.gov.ph|REGIONAL_ENCODER|1|aa000002-0000-4002-8002-aab000000002||WimsBFP2026!"
  "n-ana|n-ana@bfp.gov.ph|NATIONAL_ANALYST||aa000003-0000-4003-8003-aab000000003||WimsBFP2026!"
  "n-sys|n-sys@bfp.gov.ph|SYSTEM_ADMIN||aa000004-0000-4004-8004-aab000000004||WimsBFP2026!"
  "g-val|g-val@bfp.gov.ph|NATIONAL_VALIDATOR|1|bb000001-0000-4001-8001-bbb000000001||WimsBFP2026!"
  "g-enc|g-enc@bfp.gov.ph|REGIONAL_ENCODER|1|bb000002-0000-4002-8002-bbb000000002||WimsBFP2026!"
  "g-ana|g-ana@bfp.gov.ph|NATIONAL_ANALYST||bb000003-0000-4003-8003-bbb000000003||WimsBFP2026!"
  "g-sys|g-sys@bfp.gov.ph|SYSTEM_ADMIN||bb000004-0000-4004-8004-bbb000000004||WimsBFP2026!"
  "e-val|e-val@bfp.gov.ph|NATIONAL_VALIDATOR|1|cc000001-0000-4001-8001-ccb000000001||WimsBFP2026!"
  "e-enc|e-enc@bfp.gov.ph|REGIONAL_ENCODER|1|cc000002-0000-4002-8002-ccb000000002||WimsBFP2026!"
  "e-ana|e-ana@bfp.gov.ph|NATIONAL_ANALYST||cc000003-0000-4003-8003-ccb000000003||WimsBFP2026!"
  "e-sys|e-sys@bfp.gov.ph|SYSTEM_ADMIN||cc000004-0000-4004-8004-ccb000000004||WimsBFP2026!"
  "r-val|r-val@bfp.gov.ph|NATIONAL_VALIDATOR|1|dd000001-0000-4001-8001-ddb000000001||WimsBFP2026!"
  "r-enc|r-enc@bfp.gov.ph|REGIONAL_ENCODER|1|dd000002-0000-4002-8002-ddb000000002||WimsBFP2026!"
  "r-ana|r-ana@bfp.gov.ph|NATIONAL_ANALYST||dd000003-0000-4003-8003-ddb000000003||WimsBFP2026!"
  "r-sys|r-sys@bfp.gov.ph|SYSTEM_ADMIN||dd000004-0000-4004-8004-ddb000000004||WimsBFP2026!"
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

echo "Allowing dev username repairs in Keycloak..."
docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh update "realms/$KC_REALM" -s editUsernameAllowed=true

echo "Enforcing User Profile: firstName and lastName required for non-seed users..."
docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh update "authentication/required-actions/UPDATE_PROFILE" \
  -r "$KC_REALM" -s defaultAction=true 2>/dev/null || true
docker_exec "$KEYCLOAK_CONTAINER" bash -c 'cat > /tmp/wims-up.json <<'"'"'UPEOF'"'"'
{"attributes":[{"name":"username","displayName":"${username}","validations":{"length":{"min":3,"max":255},"username-prohibited-characters":{},"up-username-not-idn-homograph":{}},"permissions":{"view":["admin","user"],"edit":["admin","user"]},"multivalued":false},{"name":"email","displayName":"${email}","validations":{"email":{},"length":{"max":255}},"required":{"roles":["user"]},"permissions":{"view":["admin","user"],"edit":["admin","user"]},"multivalued":false},{"name":"firstName","displayName":"${firstName}","validations":{"length":{"max":255},"person-name-prohibited-characters":{}},"required":{"roles":["user"]},"permissions":{"view":["admin","user"],"edit":["admin","user"]},"multivalued":false},{"name":"lastName","displayName":"${lastName}","validations":{"length":{"max":255},"person-name-prohibited-characters":{}},"required":{"roles":["user"]},"permissions":{"view":["admin","user"],"edit":["admin","user"]},"multivalued":false}],"groups":[]}
UPEOF'
docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh update users/profile \
  -r "$KC_REALM" -f /tmp/wims-up.json 2>/dev/null || echo "  (user profile update skipped — may not be supported on this Keycloak version)"

# Some local DBs may not yet include NATIONAL_ANALYST in users_role_check.
supports_national_analyst=$(docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d wims -tA -c "SELECT CASE WHEN pg_get_constraintdef(c.oid) LIKE '%NATIONAL_ANALYST%' THEN '1' ELSE '0' END FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='wims' AND c.conname='users_role_check' LIMIT 1;")
supports_national_analyst=$(echo "$supports_national_analyst" | tr -d '[:space:]')

echo "Creating users and syncing to PostgreSQL..."
for entry in "${USERS[@]}"; do
  IFS='|' read -r username email role region_id deterministic_uuid legacy_username password_override <<< "$entry"
  user_password="${password_override:-$PASSWORD}"
  echo "--- $username ($role) ---"
  first_name="${username%%_*}"
  last_name="${username#*_}"

  uuid=$(docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get users -r "$KC_REALM" -q username="$username" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$uuid" ] && [ -n "$legacy_username" ]; then
    uuid=$(docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get users -r "$KC_REALM" -q username="$legacy_username" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
    if [ -n "$uuid" ]; then
      echo "  Renaming legacy user $legacy_username -> $username"
      docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh update "users/$uuid" -r "$KC_REALM" \
        -s username="$username" -s enabled=true -s email="$email" -s emailVerified=true -s firstName="$first_name" -s lastName="$last_name"
    fi
  fi
  if [ -z "$uuid" ]; then
    docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh create users -r "$KC_REALM" \
      -s id="$deterministic_uuid" -s username="$username" -s enabled=true -s email="$email" -s emailVerified=true -s firstName="$first_name" -s lastName="$last_name" 2>/dev/null || true
    uuid=$(docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get users -r "$KC_REALM" -q username="$username" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  fi
  if [ -n "$uuid" ]; then
    docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh update "users/$uuid" -r "$KC_REALM" \
      -s enabled=true -s email="$email" -s emailVerified=true -s firstName="$first_name" -s lastName="$last_name" -s 'requiredActions=[]'
  fi

  # Set password
  docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh set-password -r "$KC_REALM" \
    --username "$username" --new-password "$user_password"

  # Assign role
  docker_exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh add-roles -r "$KC_REALM" \
    --uusername "$username" --rolename "$role" 2>/dev/null || true

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
seeded_users=$(printf '%s\n' "${USERS[@]}" | cut -d'|' -f1 | awk 'BEGIN { sep = "" } { printf "%s%s", sep, $0; sep = ", " }')
echo "Done! Users: $seeded_users"
echo "Password for standard test users: $PASSWORD"
echo "Password for team member accounts (n-/g-/e-/r- prefix): WimsBFP2026!"
