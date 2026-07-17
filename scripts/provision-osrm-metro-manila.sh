#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
metadata_file=${OSRM_METADATA_FILE:-"$repo_root/src/osrm/metro-manila.env"}
# shellcheck disable=SC1090
source "$metadata_file"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 DATA_ROOT" >&2
  exit 2
fi

for command in curl sha256sum docker; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

root=$1
version_dir="$root/$OSRM_DATA_VERSION"
active_link="$root/active"
mkdir -p "$root"

validate_dataset() {
  local directory=$1
  [[ -s "$directory/metro-manila.osrm" ]] \
    && [[ -s "$directory/metro-manila.osrm.cells" ]] \
    && [[ -s "$directory/metro-manila.osrm.partition" ]]
}

activate_dataset() {
  local temporary_link="$root/.active.$$"
  ln -s "$version_dir" "$temporary_link"
  mv -Tf "$temporary_link" "$active_link"
}

if [[ -d "$version_dir" ]]; then
  validate_dataset "$version_dir" || {
    echo "Existing dataset is incomplete: $version_dir" >&2
    exit 1
  }
  activate_dataset
  echo "OSRM dataset already provisioned and active: $OSRM_DATA_VERSION"
  exit 0
fi

work_dir=$(mktemp -d "$root/.provision-${OSRM_DATA_VERSION}.XXXXXX")
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT

pbf="$work_dir/metro-manila.osm.pbf"
echo "Downloading pinned Metro Manila OSM dataset version $OSRM_DATA_VERSION"
curl -fsSL --retry 3 "$OSRM_PBF_URL" -o "$pbf"
printf '%s  %s\n' "$OSRM_PBF_SHA256" "$pbf" | sha256sum -c -

docker run --rm -v "$work_dir:/data" "$OSRM_IMAGE" \
  osrm-extract -p /opt/car.lua /data/metro-manila.osm.pbf
docker run --rm -v "$work_dir:/data" "$OSRM_IMAGE" \
  osrm-partition /data/metro-manila.osrm
docker run --rm -v "$work_dir:/data" "$OSRM_IMAGE" \
  osrm-customize /data/metro-manila.osrm

validate_dataset "$work_dir" || {
  echo "OSRM preprocessing did not produce the required MLD files" >&2
  exit 1
}

mv "$work_dir" "$version_dir"
trap - EXIT
activate_dataset
echo "OSRM dataset active: $version_dir"
