# Controlled OSRM Routing Operations

## Scope

Production road routing uses an internal OSRM service and a preprocessed Metro Manila OpenStreetMap extract. The browser and Nginx cannot reach OSRM directly. Local development and CI keep routing disabled unless explicitly configured.

This runbook configures the service; it does not authorize VPS access or deployment. Before any production operation, verify that no `deploy.yml` run is active.

## Privacy boundary

- Backend and Celery call `http://osrm:5000` over `wims_internal` only.
- OSRM publishes no host port.
- `osrm-routed` runs at `WARNING` verbosity so coordinate-bearing request paths are not retained in normal access logs.
- Application routing logs contain only the configured host and exception type, never request URLs or coordinates.
- Public OpenStreetMap basemap tiles remain a separate accepted egress boundary: the tile provider sees requested tile areas, not the OSRM route request.

## Dataset metadata

`src/osrm/metro-manila.env` pins:

- the Metro Manila extract URL;
- the accepted SHA-256 content digest;
- the dataset version date;
- the OSRM image version used for preprocessing and serving.

The source URL is provider-managed and may change as OpenStreetMap updates. The committed checksum makes such a change fail closed until a maintainer intentionally downloads, verifies, tests, and commits new metadata. OpenStreetMap data is licensed under ODbL; retain attribution in the map UI and operational records.

Generated `.osm.pbf` and `.osrm*` files are runtime artifacts and must not be committed.

## Initial provisioning

Prerequisites on the target host:

- Docker;
- Bash, `curl`, and `sha256sum`;
- sufficient free storage for the source extract, preprocessing intermediates, active output, and one retained rollback version;
- the repository checked out at the release being provisioned.

From the repository root:

```bash
sudo mkdir -p /opt/wims-bfp/osrm-data
sudo chown "$(id -u):$(id -g)" /opt/wims-bfp/osrm-data
./scripts/provision-osrm-metro-manila.sh /opt/wims-bfp/osrm-data
readlink -f /opt/wims-bfp/osrm-data/active
```

The script downloads to a temporary directory, verifies SHA-256 before Docker preprocessing, runs OSRM extract/partition/customize with the pinned image, validates required MLD files, moves the complete version into place, and atomically changes `active`. A failed run leaves the previous active version unchanged.

Set the uncommitted production environment value:

```dotenv
OSRM_DATA_DIR=/opt/wims-bfp/osrm-data
```

`OSRM_DATA_DIR` must be the parent directory, not the `active` symlink itself. Compose mounts the parent so the container follows atomic `active` switches without Docker replacing the symlink with an empty bind-source directory.

Do not set `OSRM_BASE_URL` in the host file; the production Compose overlay fixes it to the internal service URL for backend and Celery.

## Configuration validation

From `src/`:

```bash
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml config --quiet
```

This verifies interpolation and Compose structure. It does not prove that the dataset is complete or OSRM can route.

## Activation and verification

Follow the normal automated deployment path. Do not race it with manual Compose commands. If separately authorized to validate the running service:

```bash
gh run list --workflow=deploy.yml --limit=5
cd /opt/wims-bfp/src
export FRONTEND_IMAGE=ghcr.io/x1n4te/wims-frontend:latest
export BACKEND_IMAGE=ghcr.io/x1n4te/wims-backend:latest
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml ps osrm backend celery-worker
docker inspect --format '{{json .NetworkSettings.Ports}}' wims-osrm
```

Expected:

- `osrm` is running and healthy;
- backend and Celery are running;
- OSRM has no published host bindings (`{}` or null mappings).

Use only synthetic, non-report coordinates for an internal route probe. Then inspect OSRM and backend logs to confirm that coordinate-bearing paths were not retained.

## Failure behavior

OSRM timeout, unhealthy state, missing coverage, or an unroutable endpoint does not invalidate a civilian report. `src/backend/services/routing.py` returns the established straight-line estimate with null geometry. The receipt map renders a dashed route labeled Estimated.

Compose deployment treats an unhealthy OSRM container as an activation failure because production uses `--wait`. Backend and Celery intentionally have no hard `depends_on` relationship to OSRM, so already-running application processes preserve fallback behavior during a later OSRM outage.

Reports outside Metro Manila are expected to use the estimated fallback.

## Dataset refresh

1. Download the candidate Metro Manila extract outside application runtime.
2. Record its source timestamp and compute SHA-256.
3. Update `src/osrm/metro-manila.env` with a new version and digest.
4. Run the provisioning shell tests and infrastructure contract tests.
5. Commit and review the metadata change.
6. Provision the new version explicitly on the host.
7. Recreate only OSRM through the normal deployment workflow so Docker resolves the updated `active` symlink target.
8. Verify health, a synthetic route, fallback behavior, and privacy-safe logs.

Retain at least the immediately previous complete version until the replacement passes verification. Storage retention beyond that is an operator capacity decision; never delete the active target.

## Rollback

Select a retained complete version, atomically replace the active symlink, and recreate OSRM through the approved production Compose workflow:

```bash
cd /opt/wims-bfp/osrm-data
ln -s /opt/wims-bfp/osrm-data/PREVIOUS_VERSION .active.rollback
mv -Tf .active.rollback active
```

Replace `PREVIOUS_VERSION` with a directory verified to contain `metro-manila.osrm`, `.cells`, and `.partition`. Verify `readlink -f active` before recreation.

To disable road routing during an application rollback, remove the production overlay wiring in a reviewed repository change. Do not point `OSRM_BASE_URL` to a public OSRM instance.
