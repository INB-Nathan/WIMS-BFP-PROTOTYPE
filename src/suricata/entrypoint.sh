#!/bin/sh
set -e

# ── Docker bridge detection (G-4 fix) ──────────────────────────────────────────
# Suricata captures docker0 (or br-*) to see decrypted HTTP traffic between
# nginx and the backend after TLS termination.  Docker Compose creates a custom
# bridge for the wims_internal network, which shows up as br-<network_id> on
# the host.  The default docker0 bridge carries NO traffic because all services
# use the Compose-created bridge.
#
# sed -i fails on Docker bind mounts (cannot rename temp file across layers)
# so we stream-edit to a temp file and cp instead.
# ------------------------------------------------------------------------------
BRIDGE=$(ip -o link show type bridge | grep -oP 'br-\w+' | head -1 || echo docker0)
if [ -n "$BRIDGE" ]; then
    echo "entrypoint: detected Docker bridge $BRIDGE"
    sed 's|^  - interface: docker0$|  - interface: '"$BRIDGE"'|' \
        /etc/suricata/suricata.yaml > /tmp/suricata_patched.yaml
    cp /tmp/suricata_patched.yaml /etc/suricata/suricata.yaml
else
    echo "entrypoint: no Docker bridge detected, using default docker0"
fi

# ── Original entrypoint logic ─────────────────────────────────────────────────
# Replicates the jasonish/suricata Docker image entrypoint so we stay compatible
# with the original image while adding the bridge-patching step above.

fix_perms() {
    if [ "${PGID}" ]; then
        groupmod -o -g "${PGID}" suricata
    fi
    if [ "${PUID}" ]; then
        usermod -o -u "${PUID}" suricata
    fi
    chown -R suricata:suricata /etc/suricata /var/lib/suricata \
           /var/log/suricata /var/run/suricata
}

# Copy dist files only on first run (bind-mount may already have them)
for src in /etc/suricata.dist/*; do
    filename=$(basename "${src}")
    dst="/etc/suricata/${filename}"
    if ! test -e "${dst}"; then
        echo "entrypoint: creating ${dst}."
        cp -a "${src}" "${dst}"
    fi
done

run_as_user="yes"
check_for_cap() {
    if getpcaps 1 2>&1 | grep -q "$1"; then
        return 0
    fi
    return 1
}

if ! check_for_cap sys_nice; then
    echo "entrypoint: warning: no sys_nice capability, running as root"
    run_as_user="no"
fi
if ! check_for_cap net_admin; then
    echo "entrypoint: warning: no net_admin capability, running as root"
    run_as_user="no"
fi

ARGS=""
if [ "${run_as_user}" = "yes" ]; then
    fix_perms
    ARGS="--user suricata --group suricata"
fi

# Use the YAML-defined interface list (eth0 + Docker bridge) unless overridden.
# `--af-packet` with no value reads the af-packet: section from suricata.yaml,
# which defines both eth0 and the Docker bridge (patched above from docker0 to br-*).
if [ -n "${SURICATA_INTERFACE}" ]; then
    AF_PACKET_FLAG="--af-packet=${SURICATA_INTERFACE}"
else
    AF_PACKET_FLAG="--af-packet"
fi

echo "entrypoint: starting Suricata with ${AF_PACKET_FLAG} --runmode workers"
exec /usr/bin/suricata ${ARGS} ${SURICATA_OPTIONS} ${AF_PACKET_FLAG} --runmode workers
