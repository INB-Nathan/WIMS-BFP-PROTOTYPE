#!/bin/bash
# =============================================================================
# seed-all-regions-incidents-backend.sh
# Purpose: Run the backend-admin Python incident seeder on the WIMS VPS.
#
# Defaults to dry-run. Pass --apply to write data.
#
# Usage:
#   ./scripts/seed-all-regions-incidents-backend.sh
#   ./scripts/seed-all-regions-incidents-backend.sh --apply
#   ./scripts/seed-all-regions-incidents-backend.sh --apply --min-per-region 20 --max-per-region 50
# =============================================================================

set -euo pipefail

VPS_HOST="${VPS_HOST:-wims@194.233.81.162}"
VPS_PATH="${VPS_PATH:-/opt/wims-bfp}"
SCRIPT_REL="backend/scripts/seed_all_regions_incidents.py"
LOCAL_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/${SCRIPT_REL}"
REMOTE_SCRIPT="/tmp/seed_all_regions_incidents.py"

echo "=== WIMS Backend Incident Seeder ==="
echo "Target: $VPS_HOST"
echo "Mode args: $*"
echo ""

echo "[1/5] Checking SSH connectivity..."
ssh -o ConnectTimeout=10 -o BatchMode=yes "$VPS_HOST" "echo OK" >/dev/null
echo "      SSH OK"

echo "[2/5] Checking Docker stack..."
ssh "$VPS_HOST" "cd $VPS_PATH/src && docker compose ps --status running backend postgres | grep -E 'backend|postgres' >/dev/null"
echo "      backend/postgres running"

echo "[3/5] Copying backend seeder to VPS backend container..."
scp "$LOCAL_SCRIPT" "$VPS_HOST:$REMOTE_SCRIPT" >/dev/null
ssh "$VPS_HOST" "cd $VPS_PATH/src && docker compose cp $REMOTE_SCRIPT backend:/app/scripts/seed_all_regions_incidents.py >/dev/null"
echo "      copied to backend:/app/scripts/seed_all_regions_incidents.py"

echo "[4/5] Running seeder..."
ssh "$VPS_HOST" "cd $VPS_PATH/src && docker compose exec -T backend python scripts/seed_all_regions_incidents.py $*"

echo "[5/5] Cleaning temporary host copy..."
ssh "$VPS_HOST" "rm -f $REMOTE_SCRIPT"

echo "Done."
