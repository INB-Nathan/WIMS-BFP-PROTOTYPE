#!/usr/bin/env bash
# scripts/update-keycloak-smtp.sh
#
# Update the bfp Keycloak realm's SMTP settings to match the SMTP_* keys in .env.
# The kcadm.sh "config credentials" + "update realms/bfp" commands are chained in
# a single `docker exec sh -c "..."` so the session token written by
# `config credentials` (~/.keycloak/kcadm.config) stays in one shell context and
# is visible to the subsequent `update` call.
#
# Usage:
#   ./scripts/update-keycloak-smtp.sh [path-to-env-file]
#
# Default env-file path: ./.env (relative to the script's CWD)
# Default values below (SMTP_SSL, SMTP_STARTTLS, SMTP_AUTH, DISPLAY, REPLYTO)
# are tuned for Brevo SMTP on port 2525 (plaintext SMTP upgraded via STARTTLS,
# AUTH required). For other providers (SendGrid, Mailgun, etc.), check the
# provider's SMTP docs for the right STARTTLS/SSL/AUTH combination on the
# chosen port before running this script.

set -euo pipefail

ENV_FILE="${1:-.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found at $ENV_FILE" >&2
  exit 1
fi

# Load .env
set -a
. "$ENV_FILE"
set +a

# Validate required keys
for v in SMTP_HOST SMTP_PORT SMTP_FROM SMTP_USER SMTP_PASSWORD; do
  if [ -z "${!v:-}" ]; then
    echo "Error: $v is empty or unset in $ENV_FILE" >&2
    exit 1
  fi
done

# Build the smtpServer JSON. Defaults match bfp-realm.json's ${env.*} fallbacks
# so the script works even if the *_DISPLAY / REPLYTO / SSL / AUTH keys are
# absent from .env.
SMTP_FROM_DISPLAY="${SMTP_FROM_DISPLAY:-WIMS-BFP}"
SMTP_REPLYTO="${SMTP_REPLYTO:-$SMTP_FROM}"
SMTP_REPLYTO_DISPLAY="${SMTP_REPLYTO_DISPLAY:-WIMS-BFP No Reply}"
SMTP_SSL="${SMTP_SSL:-false}"
SMTP_STARTTLS="${SMTP_STARTTLS:-true}"
SMTP_AUTH="${SMTP_AUTH:-true}"

SMTP_JSON="{\"host\":\"$SMTP_HOST\",\"port\":\"$SMTP_PORT\",\"from\":\"$SMTP_FROM\",\"fromDisplayName\":\"$SMTP_FROM_DISPLAY\",\"replyTo\":\"$SMTP_REPLYTO\",\"replyToDisplayName\":\"$SMTP_REPLYTO_DISPLAY\",\"ssl\":\"$SMTP_SSL\",\"starttls\":\"$SMTP_STARTTLS\",\"auth\":\"$SMTP_AUTH\",\"user\":\"$SMTP_USER\",\"password\":\"$SMTP_PASSWORD\"}"

# Pass SMTP_JSON as an env var to the container to avoid shell-escape issues
# with the JSON's quotes inside the inner single-quoted kcadm arg.
docker exec -e SMTP_JSON="$SMTP_JSON" wims-keycloak sh -c '
  /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://localhost:8080/auth --realm master \
    --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" && \
  /opt/keycloak/bin/kcadm.sh update realms/bfp \
    -s "smtpServer=$SMTP_JSON"
'

echo "✓ Keycloak bfp realm SMTP updated to $SMTP_HOST:$SMTP_PORT"
