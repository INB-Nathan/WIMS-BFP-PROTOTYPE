# OpenBao development configuration
# Production: use HA Raft cluster with TLS and Shamir unseal
# WARNING: Root token and unseal keys must never be committed

storage "file" {
  path = "/vault/file"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}

api_addr     = "http://0.0.0.0:8200"
cluster_addr = "http://0.0.0.0:8201"

ui = false

log_level = "info"
