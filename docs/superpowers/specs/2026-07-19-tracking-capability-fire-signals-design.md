# Tracking capability repair and active-fire civilian signals — design

**Status:** Approved design awaiting user review before implementation  
**Date:** 2026-07-19

## Problem

A civilian report submitted by a registered contributor can receive a valid tracking capability URL but receive a neutral `404` when opening it anonymously. The tracking route validates the token through `wims.validate_tracking_token`, then reads `wims.citizen_reports` using the public RLS session. The anonymous SELECT policy excludes contributor-linked reports, so the second query returns no row.

Published active-fire cards display only official BFP emergency data. Public civilian pressure signals are separately displayed as coarse map clusters, so a card cannot state how many unresolved civilian reports fall inside its verified perimeter or let a user view their submission times.

## Scope

This work has two bounded changes:

1. Restore capability-URL tracking for both anonymous and registered-contributor reports without broadening anonymous row access.
2. Add a privacy-preserving civilian-signal count and a timestamp-only details modal to published active-fire cards.

Out of scope: changing anonymous RLS policies, exposing civilian report locations/addresses, report identifiers, descriptions, media, contributor data, or treating civilian signals as BFP verification.

## Design

### Capability-authorized tracking projection

Add a migration and matching clean-bootstrap SQL that create a narrowly scoped `SECURITY DEFINER` database function. It accepts `report_id` and a SHA-256 token hash, atomically confirms that the matching token is active, unrevoked, and unexpired, and returns only the current `CivilianTrackingResponse` core fields.

The function will use a fixed `search_path` of `wims, pg_temp`, revoke public execution, and grant execution only to the application role. It must return no row for unknown report IDs, wrong/mismatched tokens, revoked tokens, or expired tokens. The API route will map that no-row result to its existing neutral `404` response. Existing anonymous RLS remains unchanged. The route will retain its established status-update allowlist and tests will prove that it remains safe for contributor-linked reports.

### Active-fire civilian-signal summary

Extend the public emergency response with `civilian_signal_count`. For an emergency promoted from a verified fire incident, the count includes civilian reports whose status is `PENDING`, `UNDER_REVIEW`, or `LINKED` and whose location lies inside that incident's verified perimeter. It is computed in PostGIS SQL, not in application code. Emergencies without a verified perimeter return a count of zero.

Add a public read endpoint for a published emergency's civilian signal activity. It returns only chronologically ordered `submitted_at` timestamps for the same eligible reports. It returns neither report IDs nor any location, contributor, text, media, category, routing, or internal workflow information.

The frontend keeps the official emergency address/location as the map-focus control. It labels the aggregate distinctly as civilian reports, and clicking the count opens a modal listing only the returned submission times. The official emergency remains an independently verified BFP record; the civilian count is supporting public signal, not confirmation.

## Error handling

- Invalid, expired, revoked, or mismatched tracking capability tokens continue to receive the same neutral `404`.
- A signal-details request for an unpublished or nonexistent emergency receives a neutral `404`.
- If a published emergency has no verified perimeter or eligible reports, its count is zero and its modal has an empty state.
- Frontend failures retain the current emergency display and show a recoverable modal error rather than inventing data.

## Tests

- Registered contributor submission and anonymous submission both allow anonymous capability tracking.
- Invalid pairing, revoked token, expired token, and malformed token remain neutral `404` responses.
- Tracking output continues to exclude PII, location, and internal workflow fields.
- Migration/bootstrap tests verify function hardening, grants, and that the anonymous RLS policy remains strict.
- Emergency aggregate tests include only eligible unresolved reports inside the verified perimeter and exclude terminal/rejected reports and reports outside it.
- Signal-details API tests prove timestamps are the only per-report output and that unpublished emergencies are unavailable.
- Frontend API/type/component tests cover official-location map focus, count rendering, modal timestamps, empty state, and request error handling.

## Documentation

Update the public API route map, frontend route map, security baseline, civilian-reporting subsystem documentation, schema overview, system wiki index/log, and gap register only if FRS/code alignment changes.
