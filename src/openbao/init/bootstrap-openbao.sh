#!/bin/sh
set -eu

OPENBAO_ADDR="${OPENBAO_ADDR:-http://openbao:8200}"
OPENBAO_TOKEN="${OPENBAO_TOKEN:-devroot}"
TRANSIT_MOUNT="${TRANSIT_MOUNT:-transit}"

export BAO_ADDR="${OPENBAO_ADDR}"
export BAO_TOKEN="${OPENBAO_TOKEN}"
export BAO_SKIP_VERIFY=true

echo "Waiting for OpenBao at ${OPENBAO_ADDR}"
attempt=1
while ! bao status -format=json >/dev/null 2>&1; do
  if [ "${attempt}" -ge 30 ]; then
    echo "OpenBao did not become ready after ${attempt} attempts" >&2
    bao status -format=json 2>&1 || true
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

echo "Authenticating with root token"
bao token lookup >/dev/null || {
  echo "Authentication failed — check OPENBAO_TOKEN" >&2
  exit 1
}

# Enable Transit secrets engine if not already enabled
if ! bao secrets list -format=json | grep -q "\"${TRANSIT_MOUNT}/\""; then
  echo "Enabling Transit secrets engine at ${TRANSIT_MOUNT}/"
  bao secrets enable -path="${TRANSIT_MOUNT}" transit
  echo "Transit enabled"
else
  echo "Transit already enabled at ${TRANSIT_MOUNT}/"
fi

# Create PII encryption key
echo "Creating transit key: wims-incident-pii"
bao write -f "${TRANSIT_MOUNT}/keys/wims-incident-pii" type=aes256-gcm96 2>/dev/null \
  || echo "Key wims-incident-pii already exists (ok)"

# Create backup encryption key
echo "Creating transit key: wims-backup"
bao write -f "${TRANSIT_MOUNT}/keys/wims-backup" type=aes256-gcm96 2>/dev/null \
  || echo "Key wims-backup already exists (ok)"

# Write WIMS app policy via temp policy file
cat > /tmp/wims-policy.hcl << 'EOF'
path "transit/encrypt/wims-incident-pii" {
  capabilities = ["create", "update"]
}
path "transit/decrypt/wims-incident-pii" {
  capabilities = ["create", "update"]
}
path "transit/rewrap/wims-incident-pii" {
  capabilities = ["create", "update"]
}
path "transit/keys/wims-incident-pii" {
  capabilities = ["read"]
}
path "transit/encrypt/wims-backup" {
  capabilities = ["create", "update"]
}
path "transit/decrypt/wims-backup" {
  capabilities = ["create", "update"]
}
path "transit/rewrap/wims-backup" {
  capabilities = ["create", "update"]
}
path "transit/keys/wims-backup" {
  capabilities = ["read"]
}
EOF

echo "Writing wims-app policy"
bao policy write wims-app /tmp/wims-policy.hcl

echo "OpenBao bootstrap complete"
echo "  Transit mount: ${TRANSIT_MOUNT}/"
echo "  PII key:       wims-incident-pii"
echo "  Backup key:    wims-backup"
echo "  App policy:    wims-app (use this for backend/celery tokens)"
