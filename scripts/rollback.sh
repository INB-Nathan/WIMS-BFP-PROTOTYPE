#!/bin/bash
# rollback.sh — roll back the backend container to the last known-good image.
# Tagged by GitHub Actions before each deploy as wims-backend-rollback:latest.
set -e

COMPOSE_FILE="/opt/wims-bfp/src/docker-compose.yml"
ROLLBACK_IMAGE="wims-backend-rollback:latest"

if ! docker image inspect "$ROLLBACK_IMAGE" > /dev/null 2>&1; then
    echo "ERROR: No rollback image found ($ROLLBACK_IMAGE)"
    echo "Run 'docker tag <good-image-id> wims-backend-rollback:latest' first"
    exit 1
fi

echo "Rolling back backend to: $ROLLBACK_IMAGE"

docker tag "$ROLLBACK_IMAGE" wims-backend:latest
docker compose -f "$COMPOSE_FILE" up -d backend

echo "Rollback complete"
