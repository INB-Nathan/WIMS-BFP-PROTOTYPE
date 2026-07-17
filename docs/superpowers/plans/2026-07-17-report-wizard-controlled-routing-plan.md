# Report Wizard Controlled Routing Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-17-report-wizard-controlled-routing-design.md`  
**Issues:** #668, #552  
**Branch:** `fix/668-report-wizard-route-map`

## Objective

Deliver a reusable receipt/tracking route map and a production-only, internally networked OSRM service backed by an explicitly provisioned Metro Manila dataset. Preserve report submission and estimated fallback behavior whenever road routing is unavailable.

## Execution rules

- Use test-first changes for each behavior slice.
- Do not operate on the VPS without separate user approval and a deploy-workflow check.
- Do not add a hard backend/Celery startup dependency on OSRM health.
- Never print coordinate-bearing OSRM URLs in tests, scripts, logs, or documentation examples.
- Keep local and CI Compose independent of OSRM.
- Re-read scoped `AGENTS.md` files before editing each subtree.
- Commit after each green task so frontend, backend, infrastructure, and documentation changes remain reviewable.

## Task 1 — Establish reusable route-map behavior

**Files**

- Create `src/frontend/src/components/map/RouteMap.tsx`
- Create `src/frontend/src/components/map/RouteMapInner.tsx`
- Create `src/frontend/src/components/map/__tests__/RouteMap.test.tsx`
- Reuse `src/frontend/src/components/map/RoutePolyline.tsx`

**Red**

Add component tests with mocked `next/dynamic` and `react-leaflet` proving:

1. report and station markers render with valid geometry;
2. valid geometry delegates to `RoutePolyline` and does not render the fallback line;
3. null geometry renders a dashed endpoint polyline;
4. malformed geometry follows the same fallback path;
5. bounds use route positions when valid and endpoints otherwise;
6. accessible labels distinguish road route from estimated route.

Run:

```bash
cd src/frontend
npx vitest run src/components/map/__tests__/RouteMap.test.tsx
```

Expected: fail because `RouteMap` does not exist.

**Green**

Implement:

- an SSR-disabled dynamic wrapper;
- explicit endpoint props and optional geometry;
- Leaflet markers using the repository's existing marker/icon pattern rather than new image assets;
- `RoutePolyline` for valid geometry;
- a dashed Leaflet `Polyline` for fallback;
- a fit-bounds child that handles identical endpoints safely;
- OpenStreetMap tiles and attribution;
- a configurable height with a receipt-appropriate default.

Keep status text out of this component.

**Verify**

```bash
cd src/frontend
npx vitest run src/components/map/__tests__/RouteMap.test.tsx src/components/map/__tests__/RoutePolyline.test.tsx
npm run lint
```

**Commit**

```bash
git add src/frontend/src/components/map
git commit -m "feat(frontend): add reusable route map"
```

## Task 2 — Replace receipt SVG and correct route states

**Files**

- Modify `src/frontend/src/components/report-wizard/RouteFeedback.tsx`
- Create `src/frontend/src/components/report-wizard/RouteFeedback.test.tsx`
- Modify `src/frontend/src/components/report-wizard/Receipt.tsx` only if prop naming or state terminology requires it

**Red**

Add tests proving:

1. the reusable map receives report/station endpoints;
2. valid `routing_geometry` produces `SUCCESS`/“Routed” state;
3. `routing_data_source=postgis_straight_line` with null geometry produces `FAILED`/estimated state;
4. malformed geometry produces estimated state;
5. pending state still shows the endpoint map;
6. missing station does not fabricate a station marker or crash;
7. the old `route-line` SVG is absent.

Run the focused test and confirm failure.

**Green**

- Delete the SVG projection and drawing code.
- Render `RouteMap` when both endpoints exist.
- Derive routed state from `parseLineStringToLatLng(tracking.routing_geometry)`, not source presence.
- Keep loading state controlled by the caller.
- Rename user-facing fallback text to “Estimated straight-line route” and avoid claiming road distance/ETA for fallback data.
- Preserve nearest-station and source information where accurate.

**Verify**

```bash
cd src/frontend
npx vitest run src/components/report-wizard/RouteFeedback.test.tsx
npm run lint
```

**Commit**

```bash
git add src/frontend/src/components/report-wizard
git commit -m "fix(frontend): show map on report receipt"
```

## Task 3 — Add bounded tracking polling

**Files**

- Prefer creating `src/frontend/src/components/report-wizard/useRoutingTracking.ts`
- Create `src/frontend/src/components/report-wizard/__tests__/useRoutingTracking.test.ts` or the nearest established hook-test location
- Modify `src/frontend/src/components/report-wizard/Wizard.tsx`
- Modify existing report-page tests under `src/frontend/src/app/report/__tests__/page.test.tsx` where integration behavior is already covered

**Red**

Using fake timers and deferred promises, test:

1. immediate token-gated fetch;
2. retry while valid road geometry is absent;
3. stop immediately when valid geometry arrives;
4. stop after a fixed retry budget;
5. stop and ignore stale results on unmount;
6. never overlap requests;
7. preserve estimated fallback after exhaustion;
8. token absence fails without polling.

Use explicit constants in the hook for interval and maximum attempts so tests do not depend on wall-clock time. The implementation plan chooses a conservative initial policy of one immediate request plus five retries at two-second intervals (approximately ten seconds total). Adjust only if existing product timing evidence requires it, and update the design/plan if changed.

**Green**

- Move receipt tracking-fetch state into the focused hook.
- Keep station lookup independent and non-fatal.
- Use `AbortController` if supported by the established API wrapper; otherwise use generation/unmount guards and one awaited request per loop.
- Expose tracking data, loading/calculating state, and terminal estimated/routed state to `Wizard`.
- Ensure submitting a later report cannot receive stale tracking data from an earlier request.

**Verify**

```bash
cd src/frontend
npx vitest run src/components/report-wizard/__tests__/useRoutingTracking.test.ts src/app/report/__tests__/page.test.tsx
npm run lint
```

**Commit**

```bash
git add src/frontend/src/components/report-wizard src/frontend/src/app/report/__tests__/page.test.tsx
git commit -m "fix(frontend): poll for receipt route geometry"
```

## Task 4 — Reuse the route map on tracking v2

**Files**

- Modify `src/frontend/src/app/tracking/v2/[report_id]/[tracking_token]/TrackingRouteMap.tsx`
- Delete `src/frontend/src/app/tracking/v2/[report_id]/[tracking_token]/TrackingRouteMapInner.tsx` if no longer needed
- Modify `src/frontend/src/app/tracking/v2/[report_id]/[tracking_token]/page.tsx`
- Modify `src/frontend/src/app/tracking/v2/[report_id]/[tracking_token]/page.test.tsx`

**Red**

Update tracking-page tests to prove:

- valid geometry uses the shared map with endpoints;
- null/malformed geometry displays the shared estimated map when endpoint data is available, rather than omitting the map;
- tracking-specific text remains accurate.

Before implementing, verify the token-gated response exposes both route endpoints. If the current tracking contract lacks the station coordinates needed by the shared map, stop and present two choices rather than silently expanding the API contract:

1. leave tracking-v2 on its existing geometry-only wrapper while the receipt uses `RouteMap`; or
2. approve a coordinated backend schema/query/type change for station endpoints.

The #668 receipt acceptance criteria do not authorize an unrelated tracking API expansion.

**Green**

Prefer a thin page-local wrapper around the shared `RouteMap`, or remove the wrapper if direct use remains readable and SSR-safe. Do not import components from the report-wizard domain.

**Verify**

```bash
cd src/frontend
npx vitest run 'src/app/tracking/v2/[report_id]/[tracking_token]/page.test.tsx' src/components/map/__tests__/RouteMap.test.tsx
npm run lint
```

**Commit**

```bash
git add 'src/frontend/src/app/tracking/v2/[report_id]/[tracking_token]' src/frontend/src/components/map
git commit -m "refactor(frontend): share public route map"
```

## Task 5 — Harden and verify the backend OSRM boundary

**Files**

- Modify `src/backend/tests/test_routing.py`
- Modify `src/backend/services/routing.py` only where tests identify a gap
- Inspect `src/backend/tasks/routing.py` and token-gated route tests; change only if needed

**Red**

Extend tests for:

1. success logs omit coordinates and full URL as well as failure logs;
2. timeouts return `postgis_straight_line`;
3. non-2xx, empty routes, malformed distance/duration, and malformed geometry fail safely;
4. configured URLs are normalized to avoid accidental double slashes;
5. a public OSRM hostname is rejected if the approved design requires fail-closed host validation;
6. geometry persists only through the established task and is exposed through token-gated tracking, not submission response.

For hostname policy, prefer deployment allowlisting through the fixed internal Compose URL and contract tests. Do not invent complex runtime DNS/IP validation unless threat modeling shows it is needed; Docker DNS and internal-only service exposure are the primary boundary.

**Green**

Make the smallest service changes required. Preserve:

- five-second bounded timeout unless tests/operations justify separate connect/read values;
- no coordinate or full URL logging;
- existing fallback result contract;
- no synchronous routing dependency in report submission.

**Verify**

```bash
cd src/backend
pytest -q tests/test_routing.py
ruff check services/routing.py tests/test_routing.py
ruff format --check services/routing.py tests/test_routing.py
```

**Commit**

```bash
git add src/backend/services/routing.py src/backend/tests/test_routing.py
git commit -m "test(backend): harden controlled routing boundary"
```

## Task 6 — Add deterministic Metro Manila dataset provisioning

**Files**

- Create `src/osrm/metro-manila.env` containing only non-secret pinned metadata
- Create `scripts/provision-osrm-metro-manila.sh`
- Create `scripts/tests/test-provision-osrm-metro-manila.sh` or the repository's established shell-test equivalent
- Modify `.gitignore` only if generated dataset paths need explicit exclusion

**Red**

Add a shell-level test harness with stubbed `curl`, `sha256sum`, and `docker` proving:

1. checksum mismatch aborts before preprocessing;
2. download or preprocessing failure does not replace the active dataset;
3. extract, partition, and customize use the same pinned OSRM image;
4. expected `.osrm`, `.osrm.partition`, `.osrm.cells`, and related artifacts are validated;
5. successful provisioning writes a versioned directory and atomically updates the active reference;
6. rerunning an already active version is safe;
7. logs contain dataset metadata but no report-coordinate concept or application payload.

**Green**

Implement a POSIX-compatible or Bash script consistent with repository scripts:

- `set -euo pipefail`;
- explicit destination argument, defaulting only to a safe documented local path;
- a pinned Metro Manila `.osm.pbf` source from a provider offering a direct city extract;
- committed SHA-256 and source/version date;
- pinned `osrm/osrm-backend` image version or digest;
- temporary workspace and cleanup trap;
- read/write processing mount and no unnecessary network after download;
- versioned output and atomic active-link switch;
- no deletion of previous datasets.

Do not commit generated PBF or OSRM files.

**Verify**

```bash
bash -n scripts/provision-osrm-metro-manila.sh
bash scripts/tests/test-provision-osrm-metro-manila.sh
git check-ignore src/osrm/data
```

**Commit**

```bash
git add src/osrm scripts/provision-osrm-metro-manila.sh scripts/tests .gitignore
git commit -m "feat(ops): provision Metro Manila OSRM data"
```

## Task 7 — Wire production-only OSRM Compose service

**Files**

- Modify `src/docker-compose.prod.yml`
- Modify `src/.env.production.example`
- Modify root `.env.example` only to keep the general `OSRM_BASE_URL` contract accurate
- Add `src/backend/tests/test_osrm_infra_config.py`
- Inspect `.github/workflows/deploy.yml` and `scripts/deploy-vps.sh`; modify only if dataset preflight cannot be expressed in Compose validation/startup

**Red**

Add YAML/Compose contract tests proving:

1. `osrm` exists in the production overlay but not as a required local/CI service;
2. the image is pinned;
3. command starts `osrm-routed` with the active Metro Manila dataset;
4. no `ports` entry exists;
5. only the internal network is attached;
6. dataset mount is read-only;
7. a health check exists and does not include report coordinates;
8. backend and Celery receive `http://osrm:5000` in the production effective config;
9. neither application service has `depends_on: osrm` with `service_healthy`;
10. production config fails clearly when the host dataset path is absent or unset, without exposing secrets.

**Green**

- Add the service and production environment wiring.
- Use a host bind path such as `${OSRM_DATA_DIR:?set OSRM_DATA_DIR to the active provisioned dataset directory}` if that best supports atomic dataset rollback; do not use a Docker-managed volume if it makes external provisioning and rollback opaque.
- Add conservative CPU/memory limits based on the documented VPS headroom; verify they do not overcommit the current production limits.
- Keep OSRM inaccessible through Nginx.
- If Compose `--wait` would make the whole deploy fail when OSRM is unhealthy, document that this is an operational readiness gate while ensuring an already-running application can continue fallback behavior. Do not hide an invalid/missing dataset behind a fake healthy check.

**Verify**

```bash
cd src/backend
pytest -q tests/test_osrm_infra_config.py tests/test_routing.py

cd ..
docker compose --env-file ../.env.example \
  -f docker-compose.yml -f docker-compose.ci.yml config --quiet
OSRM_DATA_DIR=/tmp/osrm-contract-data docker compose \
  --env-file ../.env.example --env-file .env.production.example \
  -f docker-compose.yml -f docker-compose.prod.yml config --quiet
```

The second command validates interpolation/structure only; it does not prove dataset presence or service health.

**Commit**

```bash
git add src/docker-compose.prod.yml src/.env.production.example .env.example src/backend/tests/test_osrm_infra_config.py .github/workflows/deploy.yml scripts/deploy-vps.sh
git commit -m "feat(infra): add internal production OSRM"
```

Stage only files actually changed.

## Task 8 — Operations and system-wiki synchronization

**Files**

- Create `docs/operations/osrm-routing.md`
- Modify `system-wiki/architecture/infrastructure-config.md`
- Modify `system-wiki/frontend/route-map.md`
- Modify `system-wiki/security/security-baseline.md`
- Modify `system-wiki/index.md`
- Modify `system-wiki/log.md`
- Modify `system-wiki/gaps/frs-codebase-gap-register.md` only if verified implementation materially changes the recorded gap

Before editing wiki files, read the complete required wiki context listed in `system-wiki/AGENTS.md`.

Document:

- source/version/checksum and ODbL attribution;
- prerequisite storage and expected generated artifact size measured during provisioning;
- safe initial provision, health check, refresh, rollback, and disable procedures;
- explicit working directories and production warnings;
- OSRM internal network and no-port boundary;
- request-log suppression and application logging policy;
- five-second timeout and fallback behavior;
- Metro Manila coverage limit;
- public OSM tile residual egress;
- normal deploy behavior and the requirement to check automated deploy status before VPS work;
- evidence needed before marking #552 closed rather than partially addressed.

Do not document OSRM as deployed until effective Compose validation and any authorized live verification support that claim. Use “configured” or “planned for activation” where production data has not been provisioned.

**Verify**

```bash
git diff --check -- docs system-wiki
rg -n "OSRM|Metro Manila|OpenStreetMap" \
  docs/operations/osrm-routing.md \
  system-wiki/architecture/infrastructure-config.md \
  system-wiki/frontend/route-map.md \
  system-wiki/security/security-baseline.md
```

Verify all linked paths exist and update wiki frontmatter dates/sources.

**Commit**

```bash
git add docs/operations/osrm-routing.md system-wiki
git commit -m "docs: document controlled routing operations"
```

## Task 9 — Integrated validation and review loop

### Frontend gate

```bash
cd src/frontend
npm run lint
npx vitest run
NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth/realms/bfp \
NEXT_PUBLIC_BASE_URL=http://localhost \
NEXT_PUBLIC_MAPBOX_TOKEN= \
npm run build
```

### Backend gate

```bash
cd src/backend
ruff check .
ruff format --check .
pytest -q tests/test_routing.py tests/test_osrm_infra_config.py
```

Run broader backend tests required by changed infrastructure contracts if the focused tests reveal shared fixtures or config dependencies.

### Compose and script gate

```bash
cd src
docker compose --env-file ../.env.example \
  -f docker-compose.yml -f docker-compose.ci.yml config --quiet
OSRM_DATA_DIR=/tmp/osrm-contract-data docker compose \
  --env-file ../.env.example --env-file .env.production.example \
  -f docker-compose.yml -f docker-compose.prod.yml config --quiet
cd ..
bash -n scripts/provision-osrm-metro-manila.sh
bash scripts/tests/test-provision-osrm-metro-manila.sh
git diff --check
```

### Final inspection

- Re-read every changed file.
- Review `git diff origin/master...HEAD` and `git status --short --branch`.
- Count acceptance criteria satisfied as `X of 11` using the design checklist.
- Confirm no secrets, generated map data, coordinates, or production logs entered the diff.
- Confirm unrelated files are untouched.
- Run the looping/re-verification skill before presenting completion.

### Live verification boundary

Do not claim live road routing is operational from unit and Compose tests alone. With separate production approval, verify:

1. no deploy workflow is running;
2. dataset checksum and active version;
3. OSRM container health and absence of host-published ports;
4. backend fallback while OSRM is stopped;
5. a synthetic, non-sensitive Metro Manila route returns geometry;
6. receipt map displays route and fallback states;
7. OSRM/application logs contain no coordinate-bearing paths.

## Delivery sequence

1. Reusable map.
2. Receipt integration.
3. Bounded polling.
4. Tracking reuse where contract permits.
5. Backend privacy/failure hardening.
6. Dataset provisioning.
7. Production Compose wiring.
8. Documentation synchronization.
9. Full validation and independent review.

This ordering delivers and tests the user-visible defect independently before infrastructure activation, while keeping the backend fallback available throughout.
