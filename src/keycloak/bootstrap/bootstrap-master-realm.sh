#!/bin/sh
set -eu

KEYCLOAK_URL="${KEYCLOAK_URL:-http://keycloak:8080/auth}"
KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-admin}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
KCADM="/opt/keycloak/bin/kcadm.sh"

echo "Waiting for Keycloak admin API at ${KEYCLOAK_URL}"
attempt=1
while ! "${KCADM}" config credentials \
  --server "${KEYCLOAK_URL}" \
  --realm master \
  --user "${KEYCLOAK_ADMIN}" \
  --password "${KEYCLOAK_ADMIN_PASSWORD}" >/dev/null 2>&1; do
  if [ "${attempt}" -ge 40 ]; then
    echo "Keycloak admin API did not become ready after ${attempt} attempts" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 3
done

CLIENT_UUID="$("${KCADM}" get clients \
  -r master \
  -q clientId=security-admin-console \
  --fields id | sed -n 's/.*"id" : "\([^"]*\)".*/\1/p' | head -n 1)"

if [ -z "${CLIENT_UUID}" ]; then
  echo "Could not find master realm security-admin-console client" >&2
  exit 1
fi

echo "Patching master realm security-admin-console (${CLIENT_UUID})"
"${KCADM}" update "clients/${CLIENT_UUID}" -r master \
  -s 'redirectUris=["/admin/master/console/*","https://localhost/auth/admin/master/console/*","https://wimsbfp.tech/auth/admin/master/console/*","https://wims.bfp.gov.ph/auth/admin/master/console/*","http://localhost:8080/auth/admin/master/console/*"]' \
  -s 'webOrigins=["https://localhost","https://wimsbfp.tech","https://wims.bfp.gov.ph","http://localhost","http://localhost:8080"]'

echo "Keycloak master realm bootstrap complete"
