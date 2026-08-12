#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly COMPOSE_DIR="$REPO_ROOT/src"
readonly PROJECT_NAME="wims-local"
readonly BASE_FILE="$COMPOSE_DIR/docker-compose.yml"
readonly LOCAL_FILE="$COMPOSE_DIR/docker-compose.local-demo.yml"
readonly ENV_FILE="${WIMS_LOCAL_ENV_FILE:-$REPO_ROOT/.env.example}"
readonly SERVICES=(postgres redis keycloak keycloak-bootstrap backend frontend nginx-gateway)
readonly COMPOSE=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --project-directory "$COMPOSE_DIR" -f "$BASE_FILE" -f "$LOCAL_FILE")

usage() {
  cat <<'EOF'
Usage: scripts/wims-local.sh COMMAND

Commands:
  config      Validate and list the reduced local-demo topology (shows subnet)
  start       Build and start the reduced stack; preserve existing data
  status      Show container status and a one-shot resource snapshot
  stop        Remove containers/network while preserving named volumes
  clean-test  Delete only wims-local volumes, then run a fresh bootstrap
  certs       Print instructions for optional local HTTPS (self-signed certs)

Environment:
  WIMS_LOCAL_ENV_FILE  Use a private ignored env file instead of .env.example.
                       Never point it at production credentials.
  WIMS_LOCAL_SUBNET    CIDR for the wims_internal docker network, default
                       172.28.0.0/24 (k3d clusters occupy 172.18.0.0/16, the
                       base compose default). Service IPs and the dynamic
                       allocation pool are derived from this value.
EOF
}

require_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    printf 'Environment file not found: %s\n' "$ENV_FILE" >&2
    exit 1
  fi
}

# Print the IP address `offset` addresses above `ip` (dotted quad).
ip_at() {
  local ip="$1" offset="$2"
  local -a parts=()
  local carry="$offset" octet i
  IFS=. read -r -a parts <<<"$ip"
  for ((i = 3; i >= 0; i--)); do
    octet=$((parts[i] + carry))
    parts[i]=$((octet % 256))
    carry=$((octet / 256))
  done
  if ((carry > 0)); then
    printf 'wims-local: %s + %s overflows 32-bit address space\n' "$ip" "$offset" >&2
    exit 1
  fi
  printf '%d.%d.%d.%d' "${parts[0]}" "${parts[1]}" "${parts[2]}" "${parts[3]}"
}

# When WIMS_LOCAL_SUBNET is set, export the derived variables that
# docker-compose.local-demo.yml interpolates: the dynamic ip_range (upper half
# of the subnet, mirroring the base file's ip_range convention) and the static
# per-service addresses (postgres .3, redis .5, keycloak .7, backend .130,
# frontend .131, nginx-gateway .132). Without it the YAML defaults to
# 172.28.0.0/24 apply.
derive_subnet_env() {
  [[ -n "${WIMS_LOCAL_SUBNET:-}" ]] || return 0
  local address="${WIMS_LOCAL_SUBNET%/*}"
  local prefix="${WIMS_LOCAL_SUBNET#*/}"
  if [[ ! "$address" =~ ^[0-9]+(\.[0-9]+){3}$ || ! "$prefix" =~ ^[0-9]+$ ]]; then
    printf 'wims-local: invalid WIMS_LOCAL_SUBNET %q (expected CIDR, e.g. 10.40.0.0/24)\n' "$WIMS_LOCAL_SUBNET" >&2
    exit 1
  fi
  if ((prefix < 8 || prefix > 24)); then
    printf 'wims-local: WIMS_LOCAL_SUBNET %s must be /8 to /24 (the stack needs 133 addresses)\n' "$WIMS_LOCAL_SUBNET" >&2
    exit 1
  fi
  local -a oct=()
  local base a b c d net
  IFS=. read -r -a oct <<<"$address"
  base=$(( ((oct[0] << 24) | (oct[1] << 16) | (oct[2] << 8) | oct[3]) & (0xFFFFFFFF << (32 - prefix)) ))
  a=$(( (base >> 24) & 0xFF )); b=$(( (base >> 16) & 0xFF )); c=$(( (base >> 8) & 0xFF )); d=$(( base & 0xFF ))
  net="$a.$b.$c.$d"
  # Mask host bits (docker rejects e.g. 10.40.0.5/24 at network create).
  export WIMS_LOCAL_SUBNET="$net/$prefix"
  export WIMS_LOCAL_SUBNET_RANGE="$(ip_at "$net" $((1 << (31 - prefix))))/$((prefix + 1))"
  export WIMS_LOCAL_POSTGRES_IP="$(ip_at "$net" 3)"
  export WIMS_LOCAL_REDIS_IP="$(ip_at "$net" 5)"
  export WIMS_LOCAL_KEYCLOAK_IP="$(ip_at "$net" 7)"
  export WIMS_LOCAL_BACKEND_IP="$(ip_at "$net" 130)"
  export WIMS_LOCAL_FRONTEND_IP="$(ip_at "$net" 131)"
  export WIMS_LOCAL_NGINX_IP="$(ip_at "$net" 132)"
}

case "${1:-}" in
  config)
    require_env_file
    derive_subnet_env
    "${COMPOSE[@]}" config --quiet
    subnet="$("${COMPOSE[@]}" config | awk '/^networks:/{in_net=1} in_net && /subnet:/{print $NF; exit}')"
    ip_range="$("${COMPOSE[@]}" config | awk '/^networks:/{in_net=1} in_net && /ip_range:/{print $NF; exit}')"
    printf 'Services (%d): %s\n' "${#SERVICES[@]}" "${SERVICES[*]}"
    printf 'wims_internal: subnet=%s ip_range=%s\n' "$subnet" "$ip_range"
    ;;
  start)
    require_env_file
    derive_subnet_env
    "${COMPOSE[@]}" config --quiet
    "${COMPOSE[@]}" up --build --detach --wait "${SERVICES[@]}"
    "${COMPOSE[@]}" ps
    ;;
  status)
    require_env_file
    derive_subnet_env
    "${COMPOSE[@]}" ps
    mapfile -t container_ids < <("${COMPOSE[@]}" ps --quiet "${SERVICES[@]}")
    if ((${#container_ids[@]})); then
      docker stats --no-stream "${container_ids[@]}"
    else
      echo "The wims-local stack is stopped."
    fi
    ;;
  stop)
    require_env_file
    derive_subnet_env
    "${COMPOSE[@]}" down --remove-orphans
    echo "Stopped wims-local; named volumes were preserved."
    ;;
  clean-test)
    require_env_file
    derive_subnet_env
    printf 'This deletes local demo database, Keycloak, attachments, and other wims-local volume data.\n'
    read -r -p 'Type DELETE-WIMS-LOCAL to continue: ' confirmation
    if [[ "$confirmation" != "DELETE-WIMS-LOCAL" ]]; then
      echo "Cancelled."
      exit 1
    fi
    "${COMPOSE[@]}" down --volumes --remove-orphans
    "${COMPOSE[@]}" up --build --detach --wait "${SERVICES[@]}"
    "${COMPOSE[@]}" ps
    ;;
  certs)
    cat <<'EOF'
The wims-local stack is HTTP-only (nginx.ci.conf is mounted instead of the
production TLS config), so it starts without certificates.

If you want local HTTPS instead, the standard docker-compose.override.yml
mounts nginx.local.conf plus src/.ssl into the nginx container. Generate
self-signed certificates for it with:

  cd src
  mkdir -p .ssl/live/wimsbfp.tech
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
    -keyout .ssl/live/wimsbfp.tech/privkey.pem \
    -out .ssl/live/wimsbfp.tech/fullchain.pem \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,DNS:wimsbfp.tech,IP:127.0.0.1"

Then use the full-stack override instead of this script (wims-local always
bypasses docker-compose.override.yml):

  docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --build

Your browser will warn about the self-signed certificate; import
.ssl/live/wimsbfp.tech/fullchain.pem into your OS trust store to silence it.
EOF
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
