#!/usr/bin/env bash
set -euo pipefail

# deploy-vps.sh — run on the VPS to deploy master via pre-built GHCR images.
#
# This script is executed below /opt/wims-bfp after git checkout.
# It expects the following env vars from the CI deploy workflow:
#
#   DATABASE_URL
#   REDIS_URL
#   KEYCLOAK_REALM_URL
#   KEYCLOAK_CLIENT_ID
#   KEYCLOAK_AUDIENCE
#   WIMS_MASTER_KEY
#   FIREBASE_CREDENTIALS_PATH
#   KEYCLOAK_ADMIN_PASSWORD
#   KEYCLOAK_ADMIN_CLIENT_SECRET
#   BACKEND_IMAGE        (ghcr.io/org/wims-backend:tag)
#   FRONTEND_IMAGE       (ghcr.io/org/wims-frontend:tag)
#   DEPLOY_COMMIT
#
# Usage (on VPS):
#   cd /opt/wims-bfp && bash scripts/deploy-vps.sh

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
echo "=== Deploy VPS: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="

cd /opt/wims-bfp

# Restore git ownership before reset (suricata entrypoint chown can break git)
sudo chown -R wims:wims src/suricata/rules src/suricata/logs 2>/dev/null || true

git fetch origin master
git reset --hard
git clean -fd
git checkout -B master origin/master
cd src

test -f .env.production || { echo "FATAL: .env.production is missing on VPS"; exit 1; }

compose() {
  docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production "$@"
}

# ---------------------------------------------------------------------------
# Helper: clean stale Compose containers
# ---------------------------------------------------------------------------
cleanup_stale_compose_renames() {
  # Remove stale renamed containers (<hash>_wims-<service>)
  stale_ids=$(docker ps -a --filter 'label=com.docker.compose.project=src' --format '{{.ID}} {{.Names}}' | awk '$2 ~ /^[0-9a-f]+_wims-/ {print $1}')
  if [ -n "$stale_ids" ]; then
    echo "Removing stale Compose-renamed WIMS containers..."
    echo "$stale_ids" | xargs -r docker rm -f || true
  fi

  # Remove stuck "created" WIMS containers
  stuck_ids=$(docker ps -a --filter 'status=created' --format '{{.ID}} {{.Names}}' | awk '$2 ~ /^wims-/ {print $1}')
  if [ -n "$stuck_ids" ]; then
    echo "Removing stale WIMS containers stuck in created state..."
    echo "$stuck_ids" | xargs -r docker rm -f || true
  fi

  # Remove stale one-shot containers
  for name in wims-ollama-model-pull wims-openbao-bootstrap; do
    cid=$(docker ps -aq --filter "name=^/${name}$" 2>/dev/null || true)
    if [ -n "$cid" ]; then
      echo "Removing stale container $name..."
      docker rm -f "$cid" 2>/dev/null || true
      # Wait for the name to be freed
      for _ in $(seq 1 15); do
        if ! docker ps -a --format '{{.Names}}' | grep -Fxq "$name"; then
          break
        fi
        sleep 1
      done
    fi
  done
}

# ---------------------------------------------------------------------------
# Validate compose config
# ---------------------------------------------------------------------------
echo "Validating production compose configuration..."
compose config --quiet
cleanup_stale_compose_renames

# ---------------------------------------------------------------------------
# Pre-deploy DB connectivity check
# ---------------------------------------------------------------------------
echo "Checking database connectivity..."
compose exec -T postgres psql -U postgres -d wims -c "SELECT 1;" >/dev/null || {
  echo 'DB connectivity check failed — aborting deploy'
  exit 1
}

# ---------------------------------------------------------------------------
# Authenticate to GHCR for pulling pre-built images
# ---------------------------------------------------------------------------
if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u x1n4te --password-stdin
else
  echo "Warning: GHCR_TOKEN not set — GHCR pulls will fail; falling back to local builds"
fi

# ---------------------------------------------------------------------------
# Set GHCR image tags (PR 3)
# ---------------------------------------------------------------------------
export BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/x1n4te/wims-backend:latest}"
export FRONTEND_IMAGE="${FRONTEND_IMAGE:-ghcr.io/x1n4te/wims-frontend:latest}"

# ---------------------------------------------------------------------------
# Pre-pull service images
# ---------------------------------------------------------------------------
echo "Pre-pulling service images..."
for img in \
  "$BACKEND_IMAGE" "$FRONTEND_IMAGE" \
  jasonish/suricata:8.0.5 nginx:1.30.3-alpine \
  postgis/postgis:15-3.4-alpine redis:8.8-alpine \
  mailhog/mailhog:v1.0.1 ollama/ollama:0.30.10 \
  openbao/openbao:2.5.5 quay.io/keycloak/keycloak:26.6.4; do
  echo "  Pulling $img..."
  docker pull "$img" || echo "  Warning: pull failed for $img"
done

# ---------------------------------------------------------------------------
# Deploy stack
# ---------------------------------------------------------------------------
echo "Starting production stack..."
# Docker Compose can hit a "No such container" race during live recreate when a
# previous `up` failed mid-recreate and left a renamed "<hash>_wims-<service>"
# container whose ID no longer matches Compose's internal view. A full
# `compose down --remove-orphans` resets that view so the next `up` starts clean.
# (See system-wiki/operations/vps-deploy-debug-guide.md, "stale container" section.)
MAX_RETRIES=3
BUILD_ATTEMPT=0
while [ $BUILD_ATTEMPT -lt $MAX_RETRIES ]; do
  BUILD_ATTEMPT=$((BUILD_ATTEMPT + 1))
  cleanup_stale_compose_renames
  if compose up -d --no-build --wait --wait-timeout 600 2>&1; then
    echo "Compose stack is up (attempt $BUILD_ATTEMPT)"
    break
  fi
  echo "Compose up failed (attempt $BUILD_ATTEMPT/$MAX_RETRIES) — resetting compose state and retrying..."
  if [ $BUILD_ATTEMPT -ge $MAX_RETRIES ]; then
    echo "Compose up failed after $MAX_RETRIES attempts — aborting deploy"
    exit 1
  fi
  # Hard reset: fully remove Compose-managed containers to clear stale IDs left
  # by the failed recreate, then let the next `up` recreate them cleanly.
  # Volumes are preserved (no -v), so data is safe.
  compose down --remove-orphans || true
  sleep 5
done

# ---------------------------------------------------------------------------
# Nginx bind mount staleness check (gotcha #20)
# After git reset --hard, bind-mounted files may have new inodes but Docker
# still serves the old inode. Compare container vs host line count; if they
# differ, recreate nginx to re-establish the mount.
# ---------------------------------------------------------------------------
HOST_NGINX_LINES=$(wc -l < /opt/wims-bfp/src/nginx/nginx.conf 2>/dev/null || echo 0)
CONTAINER_NGINX_LINES=$(docker exec wims-nginx-gateway wc -l < /etc/nginx/nginx.conf 2>/dev/null || echo 0)
if [ "$HOST_NGINX_LINES" -ne "$CONTAINER_NGINX_LINES" ] 2>/dev/null; then
  echo "Nginx config mismatch detected (host: $HOST_NGINX_LINES lines, container: $CONTAINER_NGINX_LINES lines) — recreating nginx to re-establish bind mount..."
  compose down nginx-gateway
  compose up -d --no-build nginx-gateway
  echo "Nginx recreated after bind mount staleness fix"
fi

# ---------------------------------------------------------------------------
# Wait for postgres
# ---------------------------------------------------------------------------
echo "Waiting for postgres..."
for i in $(seq 1 30); do
  if compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
    echo "Postgres ready"
    break
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# Apply Alembic migrations
# ---------------------------------------------------------------------------
echo "Stopping app services for migration..."
compose stop backend celery-worker wims-suricata || true

echo "Applying Alembic migrations..."
compose run --rm --no-deps backend alembic upgrade head

# Restart app services stopped for migration.
echo "Restarting app services after migration..."
compose start backend celery-worker || true

# ---------------------------------------------------------------------------
# Reload nginx DNS cache
# ---------------------------------------------------------------------------
echo "Reloading nginx to flush DNS cache..."
docker exec wims-nginx-gateway nginx -s reload || echo "Warning: nginx reload failed"
sleep 3

# ---------------------------------------------------------------------------
# Post-deploy health check
# ---------------------------------------------------------------------------
echo "Waiting for backend to be ready..."
sleep 15
BACKEND_READY=0
for i in $(seq 1 60); do
  if curl -fsS http://localhost:8000/health > /dev/null 2>&1; then
    echo "Backend /health check passed"
    BACKEND_READY=1
    break
  fi
  echo "Attempt $i/60: backend not ready yet..."
  sleep 3
done

if [ "$BACKEND_READY" = "0" ]; then
  echo "Backend health check failed after 60 attempts"
  # Rollback: restart old tag
  if docker image inspect backend-image-rollback:latest >/dev/null 2>&1; then
    echo "Rolling back to previous image..."
    BACKEND_IMAGE=backend-image-rollback:latest compose up -d backend
  else
    echo "No rollback image found — backend may need manual intervention"
  fi
  exit 1
fi

echo "Checking public gateway health..."
curl -fsS https://wimsbfp.tech/health >/dev/null
curl -fsS https://wimsbfp.tech/auth/realms/bfp/.well-known/openid-configuration >/dev/null
curl -fsS https://wimsbfp.tech/login >/dev/null
curl -fsS https://wimsbfp.tech/api/public/emergency-services >/dev/null

echo "Checking Ollama model provisioning..."
docker exec wims-ollama ollama list | grep -q 'qwen2.5:1.5b'

echo "=== Deploy successful — commit $DEPLOY_COMMIT ==="
echo "DEPLOY_COMMIT=${DEPLOY_COMMIT:-unknown} $(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> /opt/wims-bfp/.deploy_history
