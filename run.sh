#!/usr/bin/env bash
# =============================================================================
# run.sh — WIMS-BFP VPS installer + maintenance control script
#
# One self-contained command for installation and maintenance of the WIMS-BFP
# stack on any VPS. It knows how to bootstrap a fresh host and to operate an
# existing install under $WIMS_HOME (default /opt/wims-bfp).
#
# ── First-time install on a bare host ────────────────────────────────────────
#   git clone https://github.com/x1n4te/WIMS-BFP-PROTOTYPE.git /opt/wims-bfp
#   cd /opt/wims-bfp
#   # Export the externally-provisioned secrets (see `run.sh env` for the list):
#   export PUBLIC_BASE_URL=https://wimsbfp.tech
#   export DATABASE_URL='postgresql://postgres:...@postgres:5432/wims'
#   export REDIS_URL='redis://redis:6379/0'
#   export KEYCLOAK_ADMIN_PASSWORD='...'
#   export KEYCLOAK_ADMIN_CLIENT_ID='admin-cli'
#   export KEYCLOAK_ADMIN_CLIENT_SECRET='...'
#   export NEXT_PUBLIC_TURNSTILE_SITE_KEY='...'
#   export TURNSTILE_SECRET_KEY='...'
#   export SMTP_USER='...' SMTP_PASSWORD='...'
#   sudo bash run.sh install
#
#   WIMS_MASTER_KEY and WIMS_KEYCLOAK_EVENT_SECRET are auto-generated if unset.
#   KEYCLOAK_REALM_URL is derived from PUBLIC_BASE_URL if unset.
#
# ── Daily maintenance (run from the install dir) ─────────────────────────────
#   bash run.sh status            # docker compose ps
#   bash run.sh logs backend      # tail -f logs for a service
#   bash run.sh restart nginx      # recreate (handles bind-mount staleness)
#   bash run.sh health            # backend / gateway / keycloak / ollama checks
#   bash run.sh migrate           # alembic upgrade head (stops app services)
#   bash run.sh backup            # pg_dump of the wims database
#   bash run.sh deploy            # git pull master + scripts/deploy-vps.sh
#   bash run.sh rollback          # restart previous backend image
#   bash run.sh shell backend     # exec a shell in a container
#   bash run.sh env               # validate .env.production
#
# NOTE: `deploy` triggers the same git-reset + compose-up path as the CI/CD
# pipeline (see docs/agents/gotchas.md #18). Do not run it manually while a
# GitHub Actions deploy is in progress.
# =============================================================================

set -uo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
WIMS_HOME="${WIMS_HOME:-/opt/wims-bfp}"
REPO_URL="${REPO_URL:-https://github.com/x1n4te/WIMS-BFP-PROTOTYPE.git}"
BRANCH="${BRANCH:-master}"
LETSENCRYPT_DIR="${LETSENCRYPT_DIR:-/etc/letsencrypt}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-x1n4te@proton.me}"
CERT_NAME="${CERT_NAME:-wimsbfp.tech}"
DEPLOY_USER="${DEPLOY_USER:-wims}"

# Resolve the directory this script lives in (the checkout root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$WIMS_HOME/src"
ENV_EXAMPLE="$SRC_DIR/.env.production.example"
ENV_FILE="$SRC_DIR/.env.production"

# Externally-provisioned secrets that MUST be supplied before `install`.
REQUIRED_VARS=(
  PUBLIC_BASE_URL
  DATABASE_URL
  REDIS_URL
  KEYCLOAK_ADMIN_PASSWORD
  KEYCLOAK_ADMIN_CLIENT_ID
  KEYCLOAK_ADMIN_CLIENT_SECRET
)

# Optional secrets — written to .env.production if supplied, but blank is fine
# for a demo (Turnstile CAPTCHA and SMTP mail simply don't enforce/send).

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
info()  { printf '\033[1;32m[run.sh]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[run.sh]\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[1;31m[run.sh]\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "This command must run as root (use sudo)."
}

cd_home() {
  [ -d "$SRC_DIR" ] || die "WIMS install not found at $SRC_DIR — run 'install' first."
  cd "$SRC_DIR"
}

compose() {
  docker compose -f docker-compose.yml -f docker-compose.prod.yml \
    --env-file .env.production "$@"
}

# Set a key=value pair in ENV_FILE. awk prints the value verbatim, so URLs/
# paths with / @ : = are written unchanged. Replaces an existing key=value
# line, or appends the pair if the key is absent.
set_env() {
  local key="$1" val="${2:-}"
  [ -z "$val" ] && return 0
  local tmp; tmp="$(mktemp)"
  awk -v k="$key" -v v="$val" '
    BEGIN { found = 0 }
    $0 ~ "^" k "=" { print k "=" v; found = 1; next }
    { print }
    END { if (!found) print k "=" v }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

# -----------------------------------------------------------------------------
# Install sub-steps
# -----------------------------------------------------------------------------
install_packages() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    info "Docker + compose plugin already present — skipping package install."
  else
    info "Installing docker, compose plugin, git, and certbot..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl git ufw
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
      docker-buildx-plugin docker-compose-plugin certbot
    systemctl enable --now docker
  fi
}

clone_repo() {
  if [ -d "$WIMS_HOME/.git" ]; then
    info "Repository already present at $WIMS_HOME — skipping clone."
    return 0
  fi
  info "Cloning $REPO_URL -> $WIMS_HOME ..."
  install -d "$WIMS_HOME"
  git clone --branch "$BRANCH" "$REPO_URL" "$WIMS_HOME"
}

generate_env() {
  [ -f "$ENV_FILE" ] && { info ".env.production already exists — validating."; env_check && return 0; }

  info "Generating $ENV_FILE from example..."
  cp "$ENV_EXAMPLE" "$ENV_FILE"

  # Auto-derived / auto-generated values.
  local realm_url="${KEYCLOAK_REALM_URL:-${PUBLIC_BASE_URL}/auth/realms/bfp}"
  local master_key="${WIMS_MASTER_KEY:-$(openssl rand -hex 32)}"
  local kc_event_secret="${WIMS_KEYCLOAK_EVENT_SECRET:-$(openssl rand -hex 32)}"
  local pg_password="${POSTGRES_PASSWORD:-$(openssl rand -base64 24)}"
  # KC_DB_PASSWORD MUST match the keycloak role seeded on first boot in
  # postgres-init/00_keycloak_bootstrap.sql (LOGIN PASSWORD 'secret'), or
  # Keycloak cannot connect to Postgres and all auth breaks.
  local kc_db_password="${KC_DB_PASSWORD:-secret}"

  set_env PUBLIC_BASE_URL        "$PUBLIC_BASE_URL"
  set_env POSTGRES_PASSWORD      "$pg_password"
  set_env KC_DB_PASSWORD         "$kc_db_password"
  set_env DATABASE_URL           "$DATABASE_URL"
  set_env REDIS_URL              "$REDIS_URL"
  set_env KEYCLOAK_REALM_URL     "$realm_url"
  set_env WIMS_MASTER_KEY        "$master_key"
  set_env KEYCLOAK_ADMIN_PASSWORD "$KEYCLOAK_ADMIN_PASSWORD"
  set_env KEYCLOAK_ADMIN_CLIENT_ID "$KEYCLOAK_ADMIN_CLIENT_ID"
  set_env KEYCLOAK_ADMIN_CLIENT_SECRET "$KEYCLOAK_ADMIN_CLIENT_SECRET"
  set_env WIMS_KEYCLOAK_EVENT_SECRET "$kc_event_secret"
  set_env NEXT_PUBLIC_TURNSTILE_SITE_KEY "$NEXT_PUBLIC_TURNSTILE_SITE_KEY"
  set_env TURNSTILE_SECRET_KEY   "$TURNSTILE_SECRET_KEY"
  set_env SMTP_USER              "$SMTP_USER"
  set_env SMTP_PASSWORD          "$SMTP_PASSWORD"
  set_env FIREBASE_CREDENTIALS_PATH "${FIREBASE_CREDENTIALS_PATH:-/app/firebase-creds.json}"

  env_check
}

env_check() {
  cd_home
  set +u
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set -u
  local missing=()
  for v in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!v:-}" ]; then missing+=("$v"); fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    die "Missing required variable(s) in $ENV_FILE: ${missing[*]}"
  fi
  if [ -z "${WIMS_MASTER_KEY:-}" ]; then die "WIMS_MASTER_KEY is empty in $ENV_FILE"; fi
  if [ -z "${KEYCLOAK_REALM_URL:-}" ]; then die "KEYCLOAK_REALM_URL is empty in $ENV_FILE"; fi
  if [ -z "${POSTGRES_PASSWORD:-}" ]; then die "POSTGRES_PASSWORD is empty in $ENV_FILE"; fi
  if [ -z "${KC_DB_PASSWORD:-}" ]; then die "KC_DB_PASSWORD is empty in $ENV_FILE"; fi
  info ".env.production is complete."
}

provision_tls() {
  if [ -s "$LETSENCRYPT_DIR/live/$CERT_NAME/fullchain.pem" ] \
     && [ -s "$LETSENCRYPT_DIR/live/$CERT_NAME/privkey.pem" ]; then
    info "TLS certificate for $CERT_NAME already present — skipping issuance."
    return 0
  fi
  info "Issuing TLS certificate for $CERT_NAME via standalone ACME challenge..."
  docker stop wims-nginx-gateway >/dev/null 2>&1 || true
  certbot certonly --standalone --non-interactive --agree-tos \
    --email "$CERTBOT_EMAIL" --domains "$CERT_NAME" \
    --cert-name "$CERT_NAME" --keep-until-expiring
  install -d /etc/cron.d
  printf 'SHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin\n0 0,12 * * * root certbot renew --quiet --deploy-hook "docker exec wims-nginx-gateway nginx -s reload"\n' \
    | tee /etc/cron.d/certbot-renewal >/dev/null
  info "Certbot auto-renewal cron installed."
}

run_deploy() {
  cd_home
  [ -x "$WIMS_HOME/scripts/deploy-vps.sh" ] \
    || die "scripts/deploy-vps.sh not found at $WIMS_HOME"
  export DEPLOY_COMMIT
  export DEPLOY_BRANCH="$BRANCH"
  exec bash "$WIMS_HOME/scripts/deploy-vps.sh"
}

# -----------------------------------------------------------------------------
# Commands
# -----------------------------------------------------------------------------
cmd_install() {
  require_root
  info "=== WIMS-BFP install — $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
  install_packages
  clone_repo
  generate_env
  provision_tls
  info "Running first deploy..."
  DEPLOY_COMMIT="$(git -C "$WIMS_HOME" rev-parse HEAD 2>/dev/null || echo initial)" \
    run_deploy
}

cmd_deploy() {
  cd_home
  DEPLOY_COMMIT="$(git -C "$WIMS_HOME" rev-parse HEAD 2>/dev/null || echo unknown)" \
    run_deploy
}

cmd_status()   { cd_home; compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"; }
cmd_stop()     { cd_home; compose stop "$@"; }
cmd_start()    { cd_home; compose start "$@"; }
cmd_restart()  { cd_home; if [ "${1:-}" = "nginx-gateway" ]; then compose down nginx-gateway && compose up -d nginx-gateway; else compose restart "$@"; fi; }
cmd_logs()     { cd_home; compose logs -f --tail=100 "$@"; }
cmd_shell()    { cd_home; local svc="${1:-backend}"; compose exec "$svc" bash 2>/dev/null || compose exec "$svc" sh; }
cmd_env()      { env_check; }

cmd_health() {
  cd_home
  set +u
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set -u
  local base="${PUBLIC_BASE_URL:-https://wimsbfp.tech}"
  local fails=0
  check() { if curl -fsS "$1" >/dev/null 2>&1; then info "OK   $1"; else warn "FAIL $1"; fails=$((fails+1)); fi; }
  info "Health checks against $base"
  check "http://localhost:8000/health"
  check "$base/health"
  check "$base/auth/realms/bfp/.well-known/openid-configuration"
  check "$base/login"
  check "$base/api/public/emergency-services"
  if docker exec wims-ollama ollama list 2>/dev/null | grep -q 'qwen2.5:1.5b'; then
    info "OK   ollama model qwen2.5:1.5b present"
  else
    warn "FAIL ollama model qwen2.5:1.5b not found"; fails=$((fails+1))
  fi
  [ "$fails" -eq 0 ] && info "All health checks passed." || die "$fails health check(s) failed."
}

cmd_migrate() {
  cd_home
  info "Stopping app services for migration..."
  compose stop backend celery-worker wims-suricata || true
  info "Applying Alembic migrations..."
  compose run --rm --no-deps backend alembic upgrade head
  info "Restarting app services..."
  compose start backend celery-worker || true
}

cmd_backup() {
  cd_home
  local out_dir="$WIMS_HOME/backups"; install -d "$out_dir"
  local out="$out_dir/wims-$(date -u '+%Y%m%dT%H%M%SZ').sql"
  info "Dumping wims database -> $out"
  compose exec -T postgres pg_dump -U postgres wims > "$out"
  info "Backup complete: $(wc -l < "$out") lines."
}

cmd_rollback() {
  cd_home
  if docker image inspect backend-image-rollback:latest >/dev/null 2>&1; then
    info "Rolling back backend to previous image..."
    BACKEND_IMAGE=backend-image-rollback:latest compose up -d backend
  else
    die "No rollback image (backend-image-rollback:latest) found."
  fi
}

cmd_help() {
  cat <<'EOF'
WIMS-BFP run.sh — VPS installer + maintenance

INSTALL (bare host, as root):
  sudo bash run.sh install          Bootstrap docker/certbot, clone, configure, deploy

MAINTENANCE (from the install dir):
  bash run.sh deploy     Pull master and run scripts/deploy-vps.sh (same path as CI/CD)
  bash run.sh status     docker compose ps
  bash run.sh logs [svc] Tail -f logs (default: all)
  bash run.sh restart [svc]   Restart service (nginx recreated to fix bind staleness)
  bash run.sh stop|start [svc] Stop / start services
  bash run.sh health     Backend / gateway / keycloak / ollama checks
  bash run.sh migrate    alembic upgrade head (stops app services first)
  bash run.sh backup     pg_dump of the wims database to $WIMS_HOME/backups
  bash run.sh rollback   Restart previous backend image
  bash run.sh shell <svc>   Exec a shell in a container (default: backend)
  bash run.sh env       Validate .env.production

ENV (export before `install`):
  PUBLIC_BASE_URL DATABASE_URL REDIS_URL KEYCLOAK_ADMIN_PASSWORD
  KEYCLOAK_ADMIN_CLIENT_ID KEYCLOAK_ADMIN_CLIENT_SECRET
  NEXT_PUBLIC_TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY SMTP_USER SMTP_PASSWORD
  (WIMS_MASTER_KEY, WIMS_KEYCLOAK_EVENT_SECRET auto-generated; KEYCLOAK_REALM_URL derived)
EOF
}

# -----------------------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------------------
main() {
  local cmd="${1:-help}"; shift || true
  case "$cmd" in
    install)    cmd_install "$@" ;;
    deploy|update) cmd_deploy "$@" ;;
    status)     cmd_status "$@" ;;
    logs)       cmd_logs "$@" ;;
    restart)    cmd_restart "$@" ;;
    stop)       cmd_stop "$@" ;;
    start)      cmd_start "$@" ;;
    health)     cmd_health "$@" ;;
    migrate)    cmd_migrate "$@" ;;
    backup)     cmd_backup "$@" ;;
    rollback)   cmd_rollback "$@" ;;
    shell)      cmd_shell "$@" ;;
    env)        cmd_env "$@" ;;
    help|-h|--help) cmd_help ;;
    *)          warn "Unknown command: $cmd"; cmd_help; exit 1 ;;
  esac
}

main "$@"
