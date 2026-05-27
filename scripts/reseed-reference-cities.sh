#!/usr/bin/env bash
set -euo pipefail

# Re-apply reference data inserts (idempotent) to backfill missing province/city rows.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/src"

echo "Applying src/postgres-init/03_seed_reference.sql to running postgres service..."
docker compose exec -T postgres psql -U postgres -d wims -f /docker-entrypoint-initdb.d/03_seed_reference.sql

echo "Reference data reseed completed."
