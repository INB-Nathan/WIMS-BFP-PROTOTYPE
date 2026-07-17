#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/scripts/provision-osrm-metro-manila.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

payload='test metro manila pbf'
checksum=$(printf '%s' "$payload" | sha256sum | awk '{print $1}')
cat >"$tmp/metadata.env" <<EOF
OSRM_DATA_VERSION=test-version
OSRM_PBF_URL=https://example.invalid/metro-manila.osm.pbf
OSRM_PBF_SHA256=$checksum
OSRM_IMAGE=osrm/osrm-backend:v5.25.0
EOF

cat >"$tmp/bin/curl" <<EOF
#!/usr/bin/env bash
printf '%s' '$payload' > "\${@: -1}"
EOF
cat >"$tmp/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mount=''
command=''
for arg in "$@"; do
  case "$arg" in
    *:/data) mount=${arg%:/data} ;;
    osrm-extract|osrm-partition|osrm-customize) command=$arg ;;
  esac
done
[[ -n "$mount" && -n "$command" ]]
case "$command" in
  osrm-extract) printf x >"$mount/metro-manila.osrm" ;;
  osrm-partition) printf x >"$mount/metro-manila.osrm.partition" ;;
  osrm-customize) printf x >"$mount/metro-manila.osrm.cells" ;;
esac
EOF
chmod +x "$tmp/bin/curl" "$tmp/bin/docker" "$script"

PATH="$tmp/bin:$PATH" OSRM_METADATA_FILE="$tmp/metadata.env" "$script" "$tmp/data"
test -L "$tmp/data/active"
test "$(readlink "$tmp/data/active")" = "$tmp/data/test-version"
test -s "$tmp/data/test-version/metro-manila.osrm"

# A safe rerun keeps the complete version and active reference.
PATH="$tmp/bin:$PATH" OSRM_METADATA_FILE="$tmp/metadata.env" "$script" "$tmp/data"
test -s "$tmp/data/test-version/metro-manila.osrm.cells"

# A checksum mismatch must not replace the active dataset.
sed "s/$checksum/0000000000000000000000000000000000000000000000000000000000000000/; s/test-version/bad-version/" \
  "$tmp/metadata.env" >"$tmp/bad.env"
if PATH="$tmp/bin:$PATH" OSRM_METADATA_FILE="$tmp/bad.env" "$script" "$tmp/data" >/dev/null 2>&1; then
  echo "checksum mismatch unexpectedly succeeded" >&2
  exit 1
fi
test "$(readlink "$tmp/data/active")" = "$tmp/data/test-version"
test ! -e "$tmp/data/bad-version"

echo "OSRM provisioning tests passed"
