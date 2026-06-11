#!/bin/sh
set -eu

OPENBAO_ADDR="${OPENBAO_ADDR:-http://openbao:8200}"
OPENBAO_TOKEN="${OPENBAO_TOKEN:-devroot}"
TRANSIT_MOUNT="${TRANSIT_MOUNT:-transit}"

echo "Waiting for OpenBao at ${OPENBAO_ADDR}"
attempt=1
while ! curl -sf "${OPENBAO_ADDR}/v1/sys/health" >/dev/null 2>&1; do
  if [ "${attempt}" -ge 30 ]; then
    echo "OpenBao did not become ready after ${attempt} attempts" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

echo "Authenticating with root token"
curl -sf \
  -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
  "${OPENBAO_ADDR}/v1/auth/token/lookup-self" >/dev/null || {
  echo "Authentication failed — check OPENBAO_TOKEN" >&2
  exit 1
}

# Enable Transit secrets engine if not already enabled
if ! curl -sf \
  -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
  "${OPENBAO_ADDR}/v1/sys/mounts" | grep -q "\"${TRANSIT_MOUNT}/\""; then
  echo "Enabling Transit secrets engine at ${TRANSIT_MOUNT}/"
  curl -sf \
    -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
    -H "Content-Type: application/json" \
    -X POST \
    -d '{"type": "transit"}' \
    "${OPENBAO_ADDR}/v1/sys/mounts/${TRANSIT_MOUNT}" >/dev/null
  echo "Transit enabled"
else
  echo "Transit already enabled at ${TRANSIT_MOUNT}/"
fi

# Create PII encryption key
echo "Creating transit key: wims-incident-pii"
curl -sf \
  -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"type": "aes256-gcm96"}' \
  "${OPENBAO_ADDR}/v1/${TRANSIT_MOUNT}/keys/wims-incident-pii" >/dev/null || echo "Key wims-incident-pii already exists (ok)"

# Create backup encryption key
echo "Creating transit key: wims-backup"
curl -sf \
  -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"type": "aes256-gcm96"}' \
  "${OPENBAO_ADDR}/v1/${TRANSIT_MOUNT}/keys/wims-backup" >/dev/null || echo "Key wims-backup already exists (ok)"

# Write WIMS app policy
echo "Writing wims-app policy"
curl -sf \
  -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST \
  -d "$(printf '{"policy": "path \"transit/encrypt/wims-incident-pii\" { capabilities = [\"create\", \"update\"] }\npath \"transit/decrypt/wims-incident-pii\" { capabilities = [\"create\", \"update\"] }\npath \"transit/rewrap/wims-incident-pii\" { capabilities = [\"create\", \"update\"] }\npath \"transit/keys/wims-incident-pii\" { capabilities = [\"read\"] }\npath \"transit/encrypt/wims-backup\" { capabilities = [\"create\", \"update\"] }\npath \"transit/decrypt/wims-backup\" { capabilities = [\"create\", \"update\"] }\npath \"transit/rewrap/wims-backup\" { capabilities = [\"create\", \"update\"] }\npath \"transit/keys/wims-backup\" { capabilities = [\"read\"] }\n"}' | jq -Rs '{policy: .}')" \
  "${OPENBAO_ADDR}/v1/sys/policy/wims-app" >/dev/null

echo "OpenBao bootstrap complete"
echo "  Transit mount: ${TRANSIT_MOUNT}/"
echo "  PII key:       wims-incident-pii"
echo "  Backup key:    wims-backup"
echo "  App policy:    wims-app (use this for backend/celery tokens)"
