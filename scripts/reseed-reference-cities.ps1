$ErrorActionPreference = 'Stop'

# Re-apply reference data inserts (idempotent) to backfill missing province/city rows.
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $repoRoot 'src')

Write-Host 'Applying src/postgres-init/03_seed_reference.sql to running postgres service...'
docker compose exec -T postgres psql -U postgres -d wims -f /docker-entrypoint-initdb.d/03_seed_reference.sql

Write-Host 'Reference data reseed completed.'
