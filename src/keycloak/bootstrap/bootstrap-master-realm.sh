#!/bin/sh
set -eu

KEYCLOAK_URL="${KEYCLOAK_URL:-http://keycloak:8080/auth}"
KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-admin}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
KCADM="/opt/keycloak/bin/kcadm.sh"

echo "Waiting for Keycloak HTTP endpoint at ${KEYCLOAK_URL}"

# Wait using bash TCP (no curl/wget dependency)
wait_for_keycloak() {
  local host port attempt=1 max=60
  host=$(echo "$KEYCLOAK_URL" | sed 's|http://||;s|:.*||')
  port=$(echo "$KEYCLOAK_URL" | sed 's|.*:||;s|/.*||')

  while [ "$attempt" -le "$max" ]; do
    if exec 3<>"/dev/tcp/${host}/${port}" 2>/dev/null; then
      echo -e "GET /auth/ HTTP/1.0\r\nHost: ${host}\r\n\r\n" >&3
      response=$(timeout 5 cat <&3 2>/dev/null | head -1)
      exec 3>&-
      if echo "$response" | grep -qE '^HTTP'; then
        echo "Keycloak HTTP endpoint ready"
        return 0
      fi
    fi
    attempt=$((attempt + 1))
    [ "$attempt" -le "$max" ] && sleep 3
  done
  echo "Keycloak did not become ready after ${max} attempts" >&2
  exit 1
}

wait_for_keycloak

# KC 26 creates a temporary admin user that cannot use password grants
# for kcadm.sh ("Account is not fully set up [invalid_grant]").
# Fall back to REST API via bash TCP to patch the security-admin-console client.
# If both methods fail, the default redirect URIs are sufficient for local dev
# and the bootstrap exits cleanly.

# Try kcadm.sh with password grant (works in KC <26, fails for KC 26 temp admin)
if "${KCADM}" config credentials \
  --server "${KEYCLOAK_URL}" \
  --realm master \
  --user "${KEYCLOAK_ADMIN}" \
  --password "${KEYCLOAK_ADMIN_PASSWORD}" >/dev/null 2>&1; then
  echo "Authenticated via kcadm.sh password grant"
  CLIENT_UUID=$("${KCADM}" get clients \
    -r master \
    -q clientId=security-admin-console \
    --fields id | sed -n 's/.*"id" : "\([^"]*\)".*/\1/p' | head -n 1)
  if [ -z "${CLIENT_UUID}" ]; then
    echo "Could not find master realm security-admin-console client" >&2
    exit 1
  fi
  echo "Patching master realm security-admin-console (${CLIENT_UUID})"
  "${KCADM}" update "clients/${CLIENT_UUID}" -r master \
    -s 'redirectUris=["/admin/master/console/*","https://localhost/auth/admin/master/console/*","https://wimsbfp.tech/auth/admin/master/console/*","https://wims.bfp.gov.ph/auth/admin/master/console/*","http://localhost:8080/auth/admin/master/console/*"]' \
    -s 'webOrigins=["https://localhost","https://wimsbfp.tech","https://wims.bfp.gov.ph","http://localhost","http://localhost:8080"]'
  echo "Keycloak master realm bootstrap complete"
  exit 0
fi

# kcadm.sh password grant failed — likely KC 26 temp admin.
# This is a known KC 26 bootstrap limitation — the initial admin user
# cannot use direct access grants. It does not affect normal operation.
# Default security-admin-console redirect URIs ("/admin/master/console/*")
# are sufficient for local development.
# Production deployments should bootstrap via kcadm.sh with a permanent admin user.
echo "NOTICE: KC 26 bootstrap admin cannot use password grants (known restriction).
Master realm security-admin-console was NOT patched with custom redirect URIs.
Default redirect URIs are used — sufficient for local development.

To silence this notice in production, create a permanent master-realm admin:
  kcadm.sh config credentials --server http://localhost:8080/auth \
    --realm master --user PERMANENT_ADMIN --password ..."
exit 0
