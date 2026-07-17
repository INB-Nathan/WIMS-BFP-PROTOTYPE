# Report Wizard Controlled Routing Design

**Date:** 2026-07-17  
**Issues:** #668, #552  
**Status:** Approved for planning

## Purpose

Fix the civilian report receipt so it always shows a real map with the report and nearest-station markers, renders a road route when one is available, and clearly labels its straight-line fallback as an estimate. Deploy a controlled production OSRM service so civilian incident coordinates are not sent to a public routing endpoint.

## Scope

This design combines the frontend acceptance criteria from #668 with the controlled-routing boundary from #552.

Included:

- a reusable Leaflet route map for the report receipt and tracking page;
- report and station markers in routed and fallback states;
- GeoJSON road-polyline rendering when `routing_geometry` is valid;
- dashed, clearly labeled straight-line fallback when geometry is absent or malformed;
- bounded receipt polling for asynchronously computed routing data;
- a production-only internal OSRM service using a Metro Manila dataset;
- explicit, operator-run dataset provisioning with a pinned source and checksum;
- routing privacy, timeout, fallback, infrastructure, and UI tests;
- operations and system-wiki documentation.

Excluded:

- Philippines-wide routing data;
- OSRM as a default local-development or CI dependency;
- self-hosted basemap tiles;
- direct browser access to OSRM;
- automatic dataset downloads or preprocessing during routine deployment.

Reports outside the Metro Manila dataset remain supported through the existing estimated fallback.

## Current Behavior

`src/frontend/src/components/report-wizard/RouteFeedback.tsx` renders an inline SVG schematic rather than a geographic map. It always draws a straight line and derives success from `routing_data_source`, even though a fallback source does not provide road geometry.

`src/frontend/src/components/report-wizard/Wizard.tsx` fetches token-gated tracking data once after submission. Backend routing is queued asynchronously in `src/backend/api/routes/civilian.py`, so the one-shot fetch can precede route completion.

`src/backend/services/routing.py` already confines OSRM calls to the backend, uses a bounded timeout, avoids logging coordinates or full request URLs, and returns an estimated fallback when `OSRM_BASE_URL` is unset or OSRM fails. Production does not currently configure an OSRM service.

The tracking-v2 page already has an SSR-safe Leaflet map and a shared GeoJSON renderer, but its map is nested under the tracking route and renders only when valid road geometry exists.

## Architecture

### Reusable route map

Create a domain-neutral route-map component under `src/frontend/src/components/map/`. Its public interface accepts:

- report latitude and longitude;
- station latitude and longitude;
- station name where available;
- optional GeoJSON `LineString` routing geometry;
- presentation options such as height and accessible label.

The public wrapper dynamically imports the Leaflet implementation with server-side rendering disabled. The Leaflet implementation:

- uses OpenStreetMap tiles with required attribution;
- always renders distinct report and station markers;
- validates geometry through the established `RoutePolyline` parser;
- renders the OSRM road polyline when geometry is valid;
- otherwise renders a dashed line directly between the endpoints;
- fits bounds to route positions when geometry is valid;
- otherwise fits bounds to the two endpoints;
- handles coincident or near-coincident endpoints without invalid bounds.

The report wizard and tracking-v2 page consume this shared component. Page-specific status text and layout remain outside the map.

### Receipt state model

`RouteFeedback` owns the user-visible state:

- **Calculating:** routing polling is active; the endpoint map and estimated line are visible.
- **Routed:** valid road geometry is present; road distance and ETA may be shown.
- **Estimated:** polling ended without valid geometry, geometry is malformed, or routing failed; the fallback is explicitly labeled as estimated rather than as a road route.

A non-null `routing_data_source` alone is not sufficient for the routed state. Valid road geometry is the deciding condition.

### Controlled OSRM boundary

Add OSRM only to the production Compose topology:

- the service uses a pinned OSRM image;
- it joins only the internal application network;
- it publishes no host port;
- it mounts the generated Metro Manila routing dataset read-only;
- it has a health check for operational visibility;
- backend and Celery receive `OSRM_BASE_URL=http://osrm:5000`;
- backend and Celery do not have a hard startup dependency on OSRM health, so application services continue to function through fallback when OSRM cannot answer.

The browser never receives the OSRM base URL and never calls OSRM directly.

Local development and CI leave `OSRM_BASE_URL` unset by default. Tests use mocks and infrastructure contract assertions rather than requiring a large routing dataset.

## Dataset Provisioning

Provide a separate operator-run provisioning script and runbook. The workflow:

1. selects a pinned Metro Manila OSM extract URL and expected checksum;
2. downloads to a temporary location;
3. verifies the checksum before processing;
4. runs the pinned OSRM extract, partition, and customize commands;
5. validates the expected generated files;
6. writes a versioned dataset directory;
7. atomically switches the active dataset reference only after validation;
8. retains the prior dataset for rollback according to the documented retention policy.

The workflow is safe to rerun and fails without replacing the active dataset when download, checksum, preprocessing, or validation fails. Routine application deploys start OSRM from already-provisioned data and never download or preprocess map data.

Provisioning handles public road data only and never processes civilian report coordinates.

## Data Flow

1. The report submission commits before routing work begins.
2. The backend queues `compute_routing_task` for candidate-station routing.
3. The receipt independently loads the nearest public station and token-gated tracking data.
4. The receipt displays the geographic map as soon as report and station endpoints are available.
5. Tracking is fetched immediately and then polled for a bounded period while valid road geometry is absent.
6. Polling stops when valid geometry appears, the retry budget expires, the tracking request reaches a terminal failure policy, or the component unmounts.
7. Valid geometry switches the map and text to the routed state.
8. Missing or malformed geometry leaves the map in the estimated state.

Polling must use one in-flight request at a time, cancel or ignore stale work on unmount, and avoid unbounded retries. Exact interval and total retry duration will be fixed in the implementation plan and tests.

## Privacy and Security

- Only backend/Celery code may contact OSRM.
- OSRM receives only the route endpoints required to calculate a route.
- OSRM is not published through Docker host ports or Nginx.
- Application logs, exception messages, metrics, health checks, and audit payloads must not contain coordinates or full OSRM request paths.
- OSRM request logging must be disabled or configured so coordinate-bearing paths are not retained.
- Backend warnings may identify the configured service and exception type, but not the route URL.
- The existing bounded request timeout and estimated fallback remain in force.
- The token-gated tracking endpoint remains the only public source of `routing_geometry` for a submitted report.

The existing public OpenStreetMap tile layer remains in scope by explicit decision. Tile requests disclose viewed tile areas to the tile provider but do not include the OSRM request or exact route endpoint payload. This residual egress boundary must be documented. Self-hosted tiles are deferred.

## Error Handling

- OSRM unavailable, unhealthy, timed out, outside dataset coverage, or unable to route: preserve the report and return/store the estimated fallback.
- Missing station: preserve the receipt and show routing feedback as unavailable until an endpoint exists; do not invent station coordinates.
- Tracking fetch failure: preserve receipt content and stop or bound retries according to the polling policy.
- Malformed geometry: reject it at the frontend parser boundary and render the estimated line.
- Tile failure: preserve markers/polyline and textual route status; tile failure must not hide the receipt.
- Dataset provisioning failure: leave the previous active dataset untouched.
- OSRM startup failure: surface an unhealthy routing service operationally without making civilian report submission depend on road routing success.

## Testing

### Frontend

Add focused Vitest coverage for:

- valid geometry renders the road-route mode;
- null or malformed geometry renders the dashed estimated mode;
- report and station markers render in both modes;
- fit bounds uses route positions or endpoints as appropriate;
- receipt state advances from calculating to routed after polling returns geometry;
- polling stops on success, retry exhaustion, and unmount;
- only one tracking request is in flight at a time;
- station and tracking failures preserve a usable receipt;
- the dynamic Leaflet wrapper remains SSR-safe.

### Backend

Extend routing tests for:

- approved configured base URL usage;
- timeout and request failures returning the existing fallback;
- valid geometry persistence and token-gated exposure;
- coordinate and full-URL exclusion from logs on success and failure;
- malformed or empty OSRM responses degrading safely.

### Infrastructure and provisioning

Add deterministic contract tests for:

- production-only OSRM service presence;
- no OSRM host ports;
- internal network attachment;
- read-only dataset mount;
- pinned image reference;
- backend and Celery internal URL wiring;
- local/CI profiles remaining independent of OSRM;
- provisioning checksum enforcement, expected outputs, safe reruns, and non-destructive failure.

Implementation validation must include targeted frontend Vitest, frontend lint and production build, backend Ruff checks and targeted Pytest, Compose configuration validation for local/CI/production overlays, and script lint/syntax checks. Live routing validation requires provisioned test data and must be reported separately from deterministic CI checks.

## Operations and Rollback

Before production activation, operators provision and validate the Metro Manila dataset. The runbook must document prerequisites, expected disk usage, source/version metadata, checksum update procedure, health verification, dataset refresh, rollback, and retention.

Rollback consists of switching the active dataset reference to the retained prior version and recreating only the OSRM service through the established production Compose workflow. Disabling `OSRM_BASE_URL` restores fallback-only behavior without affecting report submission.

No manual VPS operation is authorized by this design alone. Any production intervention must first verify that no automated deployment is running and must follow repository deployment safety rules.

## Documentation Synchronization

Implementation changes must update:

- `system-wiki/architecture/infrastructure-config.md`;
- `system-wiki/frontend/route-map.md`;
- `system-wiki/security/security-baseline.md`;
- the appropriate routing operations runbook;
- `system-wiki/index.md` and `system-wiki/log.md`;
- `system-wiki/gaps/frs-codebase-gap-register.md` only if implementation verification closes or materially reclassifies the tracked routing gap.

The wiki must describe deployed behavior only after implementation and validation. This design document records approved intent and does not itself change current implementation claims.

## Acceptance Criteria

1. The wizard receipt shows a Leaflet map with report and station markers whenever both endpoints are available.
2. Valid `routing_geometry` renders as a road polyline.
3. Null or malformed geometry renders a dashed straight-line fallback labeled as estimated.
4. Asynchronous routing completion can update the receipt within a bounded polling window.
5. Production routing requests go only to an internal, controlled OSRM service using the provisioned Metro Manila dataset.
6. OSRM has no public or host-published port.
7. Local development and CI do not require OSRM by default.
8. No civilian coordinates or coordinate-bearing OSRM URLs appear in logs, metrics, health checks, or audit payloads.
9. Routing and provisioning failures preserve report submission and the prior valid dataset.
10. Tests cover road geometry, fallback rendering, polling termination, privacy boundaries, Compose isolation, and provisioning safety.
11. Public OSM tile egress is documented as an accepted residual boundary.

## Decisions

- Combine issues #668 and #552 in one implementation scope.
- Use a reusable domain-neutral route map rather than a wizard-only duplicate.
- Provision Metro Manila data only.
- Run OSRM in production only by default.
- Provision data explicitly outside normal deploys.
- Continue using public OpenStreetMap basemap tiles and document the residual privacy boundary.
