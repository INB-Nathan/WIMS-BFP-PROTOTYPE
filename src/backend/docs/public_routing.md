# Public Surface Routing

This document catalogs the public-facing API endpoint prefixes exposed by the
WIMS-BFP backend. "Public" here means routes intended to be reachable without
authenticated, RLS-scoped application sessions (anonymous civilian/public
clients). It is a consistency reference, not a contract change — no route
renames, no SQL extraction, and no security changes are implied by this file.

## Public endpoint prefixes

| Prefix | Router / module | Notes |
|---|---|---|
| `/api/v1/public` | `api/routes/public_dmz.py` | Versioned public incident submission and related public endpoints. |
| `/api/public` | `api/routes/map.py` | Public map surfaces: `/api/public/clusters`, `/api/public/emergency-services`. |
| `/api/auth/consent` | `api/routes/consent.py` | Consent recording for public/anonymous flows. |
| `/api/community` | community router | Community-facing endpoints. |
| `/api/geocode` | geocode router | Public geocoding lookups. |

## Intended future convention

The current code carries two distinct public prefixes: the versioned
`/api/v1/public` (used by `public_dmz.py`) and the unversioned `/api/public`
(used by `map.py`, plus the unversioned `/api/auth/consent`, `/api/community`,
and `/api/geocode`).

The intended long-term convention is to **unify `/api/public` under
`/api/v1/public`** in a future change, so all public surfaces share one
versioned namespace. This is a planned future refactor only — no route renames
are made as part of the current work, and existing clients must continue to work
until such a migration is explicitly performed and released.

## Privacy contract note (public map clusters)

Per the public privacy contract, the public `GET /api/public/clusters` response
intentionally omits the enrichment fields that the operational (RLS-scoped) map
populates:

- `status_breakdown`
- `category_mix`
- `total_damage_php`
- `total_casualties`
- `earliest_at`
- `region_id`

These fields remain defined on the shared `ClusterItem` model (so the
operational map can reuse it) but are not populated by the public query. The
model is deliberately **not split** into separate public/operational models to
avoid duplication; the public response is restricted at the data-building layer
in `get_incident_clusters`. See the `ClusterItem` docstring in
`api/routes/map.py` for the in-code note.
