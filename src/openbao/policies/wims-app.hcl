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

# Tamper-proof audit export signer — signing/verification only.  The backend
# never receives private key material and cannot create, rotate, delete, or
# export the key.
path "transit/sign/audit-export-signer" {
  capabilities = ["create", "update"]
}
path "transit/verify/audit-export-signer" {
  capabilities = ["create", "update"]
}
path "transit/keys/audit-export-signer" {
  capabilities = ["read"]
}
