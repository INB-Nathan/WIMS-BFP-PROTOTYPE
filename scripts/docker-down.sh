#!/bin/bash
# docker-down.sh — Stop and remove all WIMS Docker containers locally.
#
# Usage:
#   ./scripts/docker-down.sh          # Stop containers, keep volumes/images
#   ./scripts/docker-down.sh -v       # Also remove volumes (WARNING: destroys data)
#   ./scripts/docker-down.sh -i       # Also remove images
#   ./scripts/docker-down.sh -a       # All: stop + remove volumes + images + orphans
#   ./scripts/docker-down.sh -h       # Show help

set -euo pipefail

cd "$(dirname "$0")/../src"

ARGS=""
VOLUMES=false
IMAGES=false
ORPHANS=""

usage() {
    sed -n '3,/^$/{ s/^# \?//; p; }' "$0"
    exit 0
}

while getopts "viah" opt; do
    case "$opt" in
        v) VOLUMES=true ;;
        i) IMAGES=true ;;
        a) VOLUMES=true; IMAGES=true; ORPHANS="--remove-orphans" ;;
        h) usage ;;
        *) usage ;;
    esac
done

ENV_FILE=".env.local"
[ ! -f "$ENV_FILE" ] && ENV_FILE=".env"
[ ! -f "$ENV_FILE" ] && ENV_FILE=".env.production.example"

echo "🛑 Stopping all WIMS containers..."
sudo docker compose --env-file "$ENV_FILE" down $ORPHANS 2>/dev/null || \
    docker compose --env-file "$ENV_FILE" down $ORPHANS

if $VOLUMES; then
    echo "🗑️  Removing volumes..."
    sudo docker compose --env-file "$ENV_FILE" down -v 2>/dev/null || \
        docker compose --env-file "$ENV_FILE" down -v
fi

if $IMAGES; then
    echo "🧹 Removing WIMS images..."
    sudo docker images --filter "label=com.docker.compose.project=wims" -q 2>/dev/null | \
        xargs -r sudo docker rmi -f 2>/dev/null || true
fi

echo "✅ Done. Containers stopped."
echo ""
echo "Still running:"
(sudo docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" 2>/dev/null || \
 docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}") | head -20
