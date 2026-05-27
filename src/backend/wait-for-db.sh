#!/bin/bash
set -e

export PGPASSWORD="${4:-password}"

echo "Waiting for PostgreSQL to be ready..."
while ! pg_isready -h "${1:-postgres}" -p "${2:-5432}" -U "${3:-postgres}" 2>/dev/null; do
  sleep 1
done

echo "PostgreSQL is ready"
