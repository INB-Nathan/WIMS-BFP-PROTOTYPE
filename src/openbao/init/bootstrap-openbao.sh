#!/bin/sh
# ---------------------------------------------------------------------------
# bootstrap-openbao.sh — idempotent OpenBao Transit initialisation for WIMS
#
# Handles three lifecycle states:
#   1. Not initialised  → init (1/1 Shamir), unseal, bootstrap Transit
#   2. Initialised+sealed → unseal only if OPENBAO_UNSEAL_KEY is provided,
#      otherwise fail-fast with a manual-unseal message
#   3. Initialised+unsealed → authenticate and bootstrap Transit
#
# Transit keys are created with  derived=true  (AES-256-GCM-96) so that
# context/AAD is cryptographically enforced.  Keys that already exist are
# validated; non-derived keys cause a hard failure.
#
# Secrets (root token, unseal key) are *never* logged.
# ---------------------------------------------------------------------------
set -eu

# ── Configuration ────────────────────────────────────────────────────────────
OPENBAO_ADDR="${OPENBAO_ADDR:-http://openbao:8200}"
TRANSIT_MOUNT="${TRANSIT_MOUNT:-transit}"
OPENBAO_TOKEN="${OPENBAO_TOKEN:-}"
OPENBAO_UNSEAL_KEY="${OPENBAO_UNSEAL_KEY:-}"

# Dev convenience: if OPENBAO_TOKEN is empty, try OPENBAO_DEV_ROOT_TOKEN
_DEV_TOKEN="${OPENBAO_DEV_ROOT_TOKEN:-devroot}"

# ── Read persisted first-boot credentials (dev/single-VPS lifecycle only) ────
# Existence implies first init already ran; values are fallbacks when env vars
# are unset.  This file *must* be stored on the openbao_data volume so it
# survives container recreation.
CREDS_FILE="/vault/file/.bootstrap-creds"
APP_TOKEN_FILE="/vault/file/.wims-app-token"
_PERSISTED_ROOT_TOKEN=""
_PERSISTED_UNSEAL_KEY=""
if [ -f "${CREDS_FILE}" ]; then
  _PERSISTED_ROOT_TOKEN=$(grep -o 'OPENBAO_ROOT_TOKEN=.*' "${CREDS_FILE}" | head -1 | cut -d= -f2- || true)
  _PERSISTED_UNSEAL_KEY=$(grep -o 'OPENBAO_UNSEAL_KEY=.*' "${CREDS_FILE}" | head -1 | cut -d= -f2- || true)
fi

export BAO_ADDR="${OPENBAO_ADDR}"
export BAO_TOKEN=""
export BAO_SKIP_VERIFY=true

# ── Wait for OpenBao API to be reachable ─────────────────────────────────────
# NOTE: we do NOT wait for `bao status` exit code 0 because a sealed or
# uninitialised OpenBao may return non-zero while still producing valid JSON.
# Instead we capture the JSON and look for the `"initialized"` field.
echo "=== OpenBao bootstrap ==="
echo "Waiting for OpenBao API at ${OPENBAO_ADDR} ..."
STATUS_JSON=""
attempt=1
while true; do
  STATUS_JSON=$(bao status -format=json 2>/dev/null || true)
  if echo "${STATUS_JSON}" | grep -q '"initialized"'; then
    break
  fi
  if [ "${attempt}" -ge 30 ]; then
    echo "ERROR: OpenBao API did not become reachable after ${attempt} attempts" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done
echo "OpenBao API is reachable"

# ── Determine cluster state ──────────────────────────────────────────────────
INITIALIZED=$(echo "${STATUS_JSON}" | grep -o '"initialized"[[:space:]]*:[[:space:]]*[^,}]*' | cut -d: -f2 | tr -d ' "')
SEALED=$(echo "${STATUS_JSON}" | grep -o '"sealed"[[:space:]]*:[[:space:]]*[^,}]*' | cut -d: -f2 | tr -d ' "')

echo "Cluster state: initialized=${INITIALIZED}, sealed=${SEALED}"

# ── Case 1: Not initialised ─────────────────────────────────────────────────
if [ "${INITIALIZED}" = "false" ]; then
  echo "OpenBao is not initialised — running operator init (key-shares=1, key-threshold=1)"
  INIT_OUTPUT=$(bao operator init -key-shares=1 -key-threshold=1 -format=json)

  # Extract secrets *without* printing them.
  # grep -A1 gets the array element on the next line; tail + sed extract the value.
  UNSEAL_KEY=$(echo "${INIT_OUTPUT}" | grep -A1 '"unseal_keys_b64"' | tail -1 | sed 's/.*"\(.*\)".*/\1/')
  ROOT_TOKEN=$(echo "${INIT_OUTPUT}" | grep '"root_token"' | sed 's/.*"root_token"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/')

  if [ -z "${UNSEAL_KEY}" ] || [ -z "${ROOT_TOKEN}" ]; then
    echo "ERROR: Failed to parse init output — root token or unseal key missing" >&2
    exit 1
  fi

  echo "Unsealing OpenBao (unseal key redacted)"
  bao operator unseal "${UNSEAL_KEY}" >/dev/null

  # Persist credentials so subsequent restarts can auto-unseal / auth
  # without the operator having to capture the init output manually.
  # DEV / SINGLE-VPS PROTOTYPE ONLY — production uses a secrets manager.
  {
    echo "OPENBAO_ROOT_TOKEN=${ROOT_TOKEN}"
    echo "OPENBAO_UNSEAL_KEY=${UNSEAL_KEY}"
  } > "${CREDS_FILE}"
  chmod 600 "${CREDS_FILE}"

  export BAO_TOKEN="${ROOT_TOKEN}"
  echo "OpenBao initialised and unsealed (credentials persisted to ${CREDS_FILE})"

# ── Case 2: Initialised but sealed ──────────────────────────────────────────
elif [ "${SEALED}" = "true" ]; then
  # Determine unseal key: env > persisted
  _MAYBE_UNSEAL="${OPENBAO_UNSEAL_KEY:-${_PERSISTED_UNSEAL_KEY:-}}"
  if [ -z "${_MAYBE_UNSEAL}" ]; then
    echo "" >&2
    echo "ERROR: OpenBao is sealed and no unseal key is available." >&2
    echo "Set OPENBAO_UNSEAL_KEY or ensure ${CREDS_FILE} exists from first init." >&2
    echo "Manual operator unseal:" >&2
    echo "" >&2
    echo "  export BAO_ADDR=${OPENBAO_ADDR}" >&2
    echo "  bao operator unseal" >&2
    echo "" >&2
    echo "After unsealing, re-run bootstrap or set OPENBAO_UNSEAL_KEY." >&2
    exit 1
  fi

  echo "OpenBao is sealed — unsealing (key redacted)"
  bao operator unseal "${_MAYBE_UNSEAL}" >/dev/null

  # Token fallback chain: env OPENBAO_TOKEN > persisted root > dev default
  TOKEN="${OPENBAO_TOKEN:-${_PERSISTED_ROOT_TOKEN:-${_DEV_TOKEN:-}}}"
  if [ -z "${TOKEN}" ]; then
    echo "ERROR: Unsealed but no token available (set OPENBAO_TOKEN or OPENBAO_DEV_ROOT_TOKEN)" >&2
    exit 1
  fi
  export BAO_TOKEN="${TOKEN}"
  echo "OpenBao unsealed"

# ── Case 3: Initialised and unsealed ────────────────────────────────────────
else
  # Token fallback chain: env OPENBAO_TOKEN > persisted root > dev default
  TOKEN="${OPENBAO_TOKEN:-${_PERSISTED_ROOT_TOKEN:-${_DEV_TOKEN:-}}}"
  if [ -z "${TOKEN}" ]; then
    echo "ERROR: OpenBao is unsealed but no token available (set OPENBAO_TOKEN or OPENBAO_DEV_ROOT_TOKEN)" >&2
    exit 1
  fi
  export BAO_TOKEN="${TOKEN}"
  echo "OpenBao is already initialised and unsealed"
fi

# ── Authenticate ─────────────────────────────────────────────────────────────
if ! bao token lookup >/dev/null 2>&1; then
  echo "ERROR: Token authentication failed — check the configured token" >&2
  exit 1
fi
echo "Authenticated"

# ── Enable Transit secrets engine ────────────────────────────────────────────
if ! bao secrets list -format=json 2>/dev/null | grep -q "\"${TRANSIT_MOUNT}/\""; then
  echo "Enabling Transit secrets engine at ${TRANSIT_MOUNT}/"
  bao secrets enable -path="${TRANSIT_MOUNT}" transit
  echo "Transit enabled"
else
  echo "Transit already enabled at ${TRANSIT_MOUNT}/"
fi

# ── Create or validate derived Transit keys ──────────────────────────────────
create_or_verify_derived_key() {
  KEY_NAME="$1"
  echo "Checking Transit key: ${KEY_NAME}"

  # Check whether the key already exists
  if bao read -format=json "${TRANSIT_MOUNT}/keys/${KEY_NAME}" >/dev/null 2>&1; then
    # Key exists — verify it is derived
    KEY_META=$(bao read -format=json "${TRANSIT_MOUNT}/keys/${KEY_NAME}" 2>/dev/null)
    IS_DERIVED=$(echo "${KEY_META}" | grep -o '"derived"[[:space:]]*:[[:space:]]*true' || true)
    if [ -z "${IS_DERIVED}" ]; then
      echo "" >&2
      echo "ERROR: Key '${KEY_NAME}' exists but is NOT derived=true." >&2
      echo "Context/AAD enforcement requires derived keys." >&2
      echo "" >&2
      echo "WARNING: Deleting this key WILL destroy the ability to decrypt any" >&2
      echo "data already encrypted with it.  Before proceeding you MUST:" >&2
      echo "  1. Migrate existing encrypted data to a derived key, OR" >&2
      echo "  2. Restore from backup after re-keying, OR" >&2
      echo "  3. Reset the affected environment (dev/test only)." >&2
      echo "" >&2
      echo "Manual operator action (DESTRUCTIVE — data loss if unprepared):" >&2
      echo "  export BAO_ADDR=${OPENBAO_ADDR}" >&2
      echo "  export BAO_TOKEN=<root-or-admin-token>" >&2
      echo "  bao delete ${TRANSIT_MOUNT}/keys/${KEY_NAME}" >&2
      echo "Then re-run bootstrap to recreate it as derived=true." >&2
      exit 1
    fi
    echo "Key '${KEY_NAME}' exists and is derived=true (ok)"
  else
    echo "Creating Transit key: ${KEY_NAME} (type=aes256-gcm96, derived=true)"
    bao write -f "${TRANSIT_MOUNT}/keys/${KEY_NAME}" type=aes256-gcm96 derived=true || {
      echo "ERROR: Failed to create key '${KEY_NAME}'" >&2
      exit 1
    }
    echo "Key '${KEY_NAME}' created"
  fi
}

create_or_verify_derived_key "wims-incident-pii"
create_or_verify_derived_key "wims-backup"

# Create or validate the dedicated ECDSA signing key used for tamper-proof
# audit-export manifests.  Unlike the encryption keys above, this key must be
# non-derived and must never be exportable.  Existing keys are validated rather
# than replaced so bootstrap cannot destroy historical verification material.
create_or_verify_signing_key() {
  KEY_NAME="$1"
  echo "Checking Transit signing key: ${KEY_NAME}"

  if bao read -format=json "${TRANSIT_MOUNT}/keys/${KEY_NAME}" >/dev/null 2>&1; then
    KEY_META=$(bao read -format=json "${TRANSIT_MOUNT}/keys/${KEY_NAME}" 2>/dev/null)
    KEY_TYPE=$(echo "${KEY_META}" | grep -o '"type"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 || true)
    SUPPORTS_SIGNING=$(echo "${KEY_META}" | grep -o '"supports_signing"[[:space:]]*:[[:space:]]*true' || true)
    IS_DERIVED=$(echo "${KEY_META}" | grep -o '"derived"[[:space:]]*:[[:space:]]*false' || true)
    DELETION_DISABLED=$(echo "${KEY_META}" | grep -o '"deletion_allowed"[[:space:]]*:[[:space:]]*false' || true)
    IS_NON_EXPORTABLE=$(echo "${KEY_META}" | grep -o '"exportable"[[:space:]]*:[[:space:]]*false' || true)
    BACKUP_DISABLED=$(echo "${KEY_META}" | grep -o '"allow_plaintext_backup"[[:space:]]*:[[:space:]]*false' || true)
    if ! echo "${KEY_TYPE}" | grep -q 'ecdsa-p256'; then
      echo "ERROR: Signing key '${KEY_NAME}' is not type=ecdsa-p256." >&2
      exit 1
    fi
    if [ -z "${SUPPORTS_SIGNING}" ]; then
      echo "ERROR: Signing key '${KEY_NAME}' does not support signing." >&2
      exit 1
    fi
    if [ -z "${IS_DERIVED}" ] || [ -z "${DELETION_DISABLED}" ] || \
       [ -z "${IS_NON_EXPORTABLE}" ] || [ -z "${BACKUP_DISABLED}" ]; then
      echo "ERROR: Signing key '${KEY_NAME}' does not satisfy non-exportable security constraints." >&2
      echo "       Required: derived=false, deletion_allowed=false, exportable=false," >&2
      echo "       allow_plaintext_backup=false." >&2
      exit 1
    fi
    echo "Signing key '${KEY_NAME}' exists and supports ECDSA-P256 signing (ok)"
  else
    echo "Creating Transit signing key: ${KEY_NAME} (type=ecdsa-p256, non-exportable)"
    bao write -f "${TRANSIT_MOUNT}/keys/${KEY_NAME}" \
      type=ecdsa-p256 \
      derived=false \
      deletion_allowed=false \
      exportable=false \
      allow_plaintext_backup=false || {
        echo "ERROR: Failed to create signing key '${KEY_NAME}'" >&2
        exit 1
      }
    echo "Signing key '${KEY_NAME}' created"
  fi
}

create_or_verify_signing_key "audit-export-signer"

# ── Write least-privilege policy ─────────────────────────────────────────────
cat > /tmp/wims-policy.hcl << 'POLICY_EOF'
path "transit/encrypt/wims-incident-pii" { capabilities = ["create", "update"] }
path "transit/decrypt/wims-incident-pii" { capabilities = ["create", "update"] }
path "transit/rewrap/wims-incident-pii" { capabilities = ["create", "update"] }
path "transit/keys/wims-incident-pii" { capabilities = ["read"] }
path "transit/encrypt/wims-backup" { capabilities = ["create", "update"] }
path "transit/decrypt/wims-backup" { capabilities = ["create", "update"] }
path "transit/rewrap/wims-backup" { capabilities = ["create", "update"] }
path "transit/keys/wims-backup" { capabilities = ["read"] }
path "transit/sign/audit-export-signer" { capabilities = ["create", "update"] }
path "transit/verify/audit-export-signer" { capabilities = ["create", "update"] }
path "transit/keys/audit-export-signer" { capabilities = ["read"] }
POLICY_EOF

echo "Writing wims-app policy"
bao policy write wims-app /tmp/wims-policy.hcl
rm -f /tmp/wims-policy.hcl

# ── Create/persist backend app token ─────────────────────────────────────────
# The backend and Celery containers read this file via a read-only volume mount
# (OPENBAO_TOKEN_FILE).  Keeping the auth token in the OpenBao volume prevents
# stale .env.production tokens after an OpenBao volume reset.
EXISTING_APP_TOKEN=""
if [ -f "${APP_TOKEN_FILE}" ]; then
  EXISTING_APP_TOKEN=$(cat "${APP_TOKEN_FILE}" 2>/dev/null || true)
fi

if [ -n "${EXISTING_APP_TOKEN}" ] && BAO_TOKEN="${EXISTING_APP_TOKEN}" bao token lookup >/dev/null 2>&1; then
  echo "Existing wims-app service token is valid (token redacted)"
else
  echo "Creating wims-app service token (token redacted)"
  APP_TOKEN_JSON=$(bao token create -policy=wims-app -no-default-policy -orphan -display-name=wims-app -format=json)
  APP_TOKEN=$(echo "${APP_TOKEN_JSON}" | grep '"client_token"' | sed 's/.*"client_token"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/')
  if [ -z "${APP_TOKEN}" ]; then
    echo "ERROR: Failed to parse generated wims-app token" >&2
    exit 1
  fi
  printf '%s\n' "${APP_TOKEN}" > "${APP_TOKEN_FILE}"
  # Readable by the non-root backend appuser through the Docker volume mount.
  chmod 0444 "${APP_TOKEN_FILE}"
  echo "wims-app service token persisted to ${APP_TOKEN_FILE}"
fi

# ── Cleanup secrets from the environment ─────────────────────────────────────
unset UNSEAL_KEY ROOT_TOKEN TOKEN APP_TOKEN APP_TOKEN_JSON EXISTING_APP_TOKEN _DEV_TOKEN _PERSISTED_ROOT_TOKEN _PERSISTED_UNSEAL_KEY _MAYBE_UNSEAL 2>/dev/null || true

echo ""
echo "==== OpenBao bootstrap complete ===="
echo "  Transit mount:  ${TRANSIT_MOUNT}/"
echo "  PII key:        wims-incident-pii  (derived=true, aes256-gcm96)"
echo "  Backup key:     wims-backup        (derived=true, aes256-gcm96)"
echo "  Audit signer:   audit-export-signer (ecdsa-p256, non-exportable)"
echo "  App policy:     wims-app"
echo ""
echo "Secrets (root token / unseal key / app token) are NOT printed to logs."
echo "On first init, prototype credentials are persisted in ${CREDS_FILE}."
echo "The backend app token is persisted in ${APP_TOKEN_FILE}."
echo "For production, replace this with an external secrets manager/AppRole/auto-unseal flow."

# ── Keep alive for Docker Compose --wait ─────────────────────────────────────
# The deploy workflow uses `docker compose up --wait`, which expects every
# service to be in "running" or "healthy" state.  Since this container has no
# healthcheck and exits after bootstrap completes, --wait would see it as
# "not ready" and fail.  We stay alive so Compose sees a running container.
# When the stack is torn down, docker sends SIGTERM/SIGINT which kills the
# sleep and the container exits cleanly.
echo "Bootstrap complete — keeping container alive for docker compose --wait"
trap 'echo "Shutting down"; exit 0' TERM INT
while true; do sleep 3600; done
