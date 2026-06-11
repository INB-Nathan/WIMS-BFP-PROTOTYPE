# WIMS-BFP least-privilege policy for OpenBao Transit operations
# Applied to the WIMS backend and celery-worker service tokens

# Incident PII key — encrypt, decrypt, rewrap, read metadata
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

# Backup encryption key — encrypt, decrypt, rewrap, read metadata
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
