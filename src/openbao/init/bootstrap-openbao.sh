#!/bin/sh
set -eu

OPENBAO_ADDR="${OPENBAO_ADDR:-http://openbao:8200}"
TRANSIT_MOUNT="${TRANSIT_MOUNT:-transit}"

export BAO_ADDR="${OPENBAO_ADDR}"
export BAO_TOKEN=""
export BAO_SKIP_VERIFY=true

echo "Waiting for OpenBao at ${OPENBAO_ADDR}"
attempt=1
while ! bao status -format=json >/dev/null 2>&1; do
  if [ "${attempt}" -ge 30 ]; then
    echo "OpenBao did not become ready after ${attempt} attempts" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

# ── Initialize if needed ─────────────────────────────────────────────────────

INITIALIZED=$(bao status -format=json | grep -o '"initialized":[^,}]*' | cut -d: -f2 | tr -d ' "')
if [ "${INITIALIZED}" = "false" ]; then
  echo "OpenBao not initialized — running operator init"
  INIT_OUTPUT=$(bao operator init -key-shares=1 -key-threshold=1 -format=json)
  UNSEAL_KEY=$(echo "${INIT_OUTPUT}" | grep -o '"unseal_keys_b64":\["[^"]*"' | sed 's/.*\["//;s/"//')
  ROOT_TOKEN=$(echo "${INIT_OUTPUT}" | grep -o '"root_token":"[^"]*"' | sed 's/.*":"//;s/"//')

  echo "Unsealing OpenBao"
  bao operator unseal "${UNSEAL_KEY}" >/dev/null

  export BAO_TOKEN="${ROOT_TOKEN}"
  echo "Initialized and unsealed"
else
  # Use provided token if already initialized
  export BAO_TOKEN="${OPENBAO_TOKEN:-devroot}"
  echo "OpenBao already initialized"
fi

# ── Authenticate ──────────────────────────────────────────────────────────────

bao token lookup >/dev/null || {
  echo "Authentication failed — check token" >&2
  exit 1
}
echo "Authenticated"

# ── Enable Transit ────────────────────────────────────────────────────────────

if ! bao secrets list -format=json | grep -q "\"${TRANSIT_MOUNT}/\""; then
  echo "Enabling Transit secrets engine at ${TRANSIT_MOUNT}/"
  bao secrets enable -path="${TRANSIT_MOUNT}" transit
  echo "Transit enabled"
else
  echo "Transit already enabled at ${TRANSIT_MOUNT}/"
fi

# ── Create keys ───────────────────────────────────────────────────────────────

echo "Creating transit key: wims-incident-pii"
bao write -f "${TRANSIT_MOUNT}/keys/wims-incident-pii" type=aes256-gcm96 2>/dev/null \
  || echo "Key wims-incident-pii already exists (ok)"

echo "Creating transit key: wims-backup"
bao write -f "${TRANSIT_MOUNT}/keys/wims-backup" type=aes256-gcm96 2>/dev/null \
  || echo "Key wims-backup already exists (ok)"

# ── Write policy ──────────────────────────────────────────────────────────────

cat > /tmp/wims-policy.hcl << 'EOF'
path "transit/encrypt/wims-incident-pii" { capabilities = ["create", "update"] }
path "transit/decrypt/wims-incident-pii" { capabilities = ["create", "update"] }
path "transit/rewrap/wims-incident-pii" { capabilities = ["create", "update"] }
path "transit/keys/wims-incident-pii" { capabilities = ["read"] }
path "transit/encrypt/wims-backup" { capabilities = ["create", "update"] }
path "transit/decrypt/wims-backup" { capabilities = ["create", "update"] }
path "transit/rewrap/wims-backup" { capabilities = ["create", "update"] }
path "transit/keys/wims-backup" { capabilities = ["read"] }
EOF

echo "Writing wims-app policy"
bao policy write wims-app /tmp/wims-policy.hcl

echo ""
echo "OpenBao bootstrap complete"
echo "  Transit mount: ${TRANSIT_MOUNT}/"
echo "  PII key:       wims-incident-pii"
echo "  Backup key:    wims-backup"
echo "  App policy:    wims-app"
echo ""
echo "Save this token for the backend:"
echo "  ${BAO_TOKEN}"
