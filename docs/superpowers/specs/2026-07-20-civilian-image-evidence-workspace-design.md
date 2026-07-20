# Civilian Image Evidence Workspace — Design Specification

**Date:** 2026-07-20

**Status:** Approved for implementation planning

**Scope:** Images only; civilian submission, evidence persistence, and National Validator triage
**Builds on:**
- `docs/superpowers/specs/2026-07-06-civilian-contributor-enhancement-design.md`
- `docs/superpowers/specs/2026-06-25-civilian-triage-spatial-workspace-design.md`
- `system-wiki/decisions/0001-civilian-reporting-overhaul.md`
- `system-wiki/subsystems/civilian-reporting-phase2.md`

## 1. Problem

The existing civilian photo pipeline accepts JPEG/PNG uploads, extracts metadata,
sanitizes image pixels, encrypts original/sanitized/metadata artifacts, and writes
the encrypted image bytes to the shared Docker volume mounted at `/app/storage`.
The image bytes therefore survive ordinary backend rebuilds and container
recreation. The user-visible defect is downstream: National Validators have no
civilian-photo read route or decryption/serving path, so the triage workflow can
show derived metadata signals but cannot display the sanitized image.

The current triage inspection modal is also too constrained for the requested
report-level evidence analysis. It does not visually compare the incident pin,
device GPS, image EXIF GPS, and coarse IP-derived location; it does not surface
registered-contributor credibility; and it does not present the full evidence and
feedback history as a dedicated investigation workspace.

Civilian reporter identity collection is inconsistent with the requested
credibility model. Anonymous reporter name and phone are optional today, while
authenticated `CIVILIAN_REPORTER` sessions do not automatically supply their
profile identity to the report wizard. Reporter identity is distinct from the
existing `witness_name`/`witness_phone` fields, which identify a direct eyewitness
and may name someone other than the reporter in a secondhand report.

## 2. Verified Current State

The implementation plan must preserve these verified boundaries:

- `src/backend/services/report_photos.py` stores three independently protected
  artifacts: encrypted original bytes, encrypted sanitized bytes, and encrypted
  sensitive metadata. The artifact AADs are distinct.
- `src/docker-compose.yml` mounts the named volume
  `incident_attachments_data:/app/storage` into both backend and Celery worker and
  sets `CIVILIAN_PHOTO_STORAGE_DIR=/app/storage/civilian-photos`.
- The named volume survives ordinary rebuild, restart, and `docker compose down`;
  it does not survive explicit volume deletion, host-volume pruning, or VPS loss.
- No GET route serves civilian report photos. Validators therefore cannot view the
  bytes already stored on the VPS.
- The final `report_photos_select` RLS policy in
  `src/postgres-init/82_civilian_report_photos.sql` already includes
  `NATIONAL_VALIDATOR`, `NATIONAL_ANALYST`, and `SYSTEM_ADMIN`. This feature does
  not need a broader SELECT policy merely to add the validator read route.
- `src/backend/services/civilian_triage/queue_projection.py` intentionally keeps
  the queue privacy-minimized. It exposes derived mismatch/count signals but not
  raw device IDs, raw IP data, contact PII, or detailed photo evidence.
- Anonymous report submission uses Turnstile and the lower report cap;
  authenticated `CIVILIAN_REPORTER` submission skips Turnstile and uses the higher
  cap. This distinction is retained.
- Only an IP hash is currently retained. It cannot be reversed into a location.
  Coarse IP geolocation must be resolved at request time if it is to be shown
  later.

## 3. Approved Product Decisions

1. The feature supports **JPEG and PNG images only**. Video is out of scope.
2. IP-derived location is stored only at **city/municipality centroid precision**.
3. The validator investigation surface becomes a **cluster-level dedicated page**
   at `/incidents/triage/[clusterId]`.
4. Validators receive **sanitized images only**. Encrypted originals remain
   retained for custody but are never rendered or downloaded through the
   application.
5. Anonymous identity rules are:
   - name required for every report;
   - phone required for normal reports;
   - phone optional for `I_NEED_HELP` and
     `SOMEONE_ELSE_NEEDS_HELP` fast-submit reports.
6. Authenticated `CIVILIAN_REPORTER` identity is server-derived from the profile;
   the wizard does not ask for duplicate name/phone input. Reporter identity uses a
   dedicated encrypted submission snapshot and never overwrites the separate direct-
   eyewitness fields.
7. Contributor credibility appears as a compact per-report summary with expandable
   details.
8. Coarse IP evidence stores municipality/city, province, centroid, accuracy
   radius, provider, and lookup timestamp. Raw IP addresses are never stored.
9. The existing Docker named volume remains the storage mechanism for this
   feature. Off-host object storage and backup are separate operational work.
10. `/api/triage/queue` remains privacy-minimized; detailed evidence is loaded only
    after opening the dedicated workspace.

## 4. Architecture

### 4.1 Submission and identity

Anonymous and authenticated clients continue to use the established civilian
submission endpoint and optional-auth boundary.

For anonymous submissions, request validation enforces the approved reporter
name/phone rules before persistence. Life-safety fast submit remains available when
the reporter phone is absent, but the reporter name is still required.

For authenticated `CIVILIAN_REPORTER` submissions, the backend ignores
caller-supplied reporter-identity fields and derives the contributor ID, display
name, and contact number from the authenticated server-side profile. The report
records a dedicated encrypted submission-time reporter snapshot so later profile
edits do not rewrite historical evidence. A normal authenticated report with an
incomplete required profile returns a profile-completion response. A life-safety
report remains submittable when only the phone number is missing.

Reporter identity does not reuse or replace `witness_name`/`witness_phone`. Those
existing fields remain optional direct-eyewitness details, particularly for
`SECONDHAND` reports. The frontend and API contracts must label the two concepts
unambiguously.

Anonymous Turnstile and lower rate limits remain unchanged. Registered users retain
the existing Turnstile bypass and higher limit. An invalid supplied credential
must still fail closed rather than downgrade to anonymous behavior.

Required reporter PII changes the offline threat model. Reporter name/phone must not
be written into the current plaintext localStorage draft or plaintext public offline
operation payload. The wizard keeps reporter identity in memory while online and,
when an offline submission is queued, encrypts the reporter snapshot with the
existing device-bound non-extractable Web Crypto pattern under a purpose-specific
AAD. IndexedDB stores only ciphertext, IV, version, and the non-sensitive operation
payload. Key loss produces a recoverable permanent-failure state that asks the user
to re-enter identity; it never falls back to plaintext.

### 4.2 Image pipeline and persistence

Uploads continue through `services/report_photos.py`:

1. validate filename, extension, declared MIME, magic bytes, decoded image, and
   byte cap;
2. extract EXIF before sanitization;
3. deterministically sanitize/re-encode pixels;
4. compute PostGIS distances and GPS consensus;
5. encrypt original bytes, sanitized bytes, and sensitive metadata under separate
   AADs;
6. atomically write encrypted artifacts beneath
   `CIVILIAN_PHOTO_STORAGE_DIR`;
7. persist the photo row and sensitive audit in the established transaction;
8. compensate filesystem writes on database/audit failure.

The feature adds read-side service functions rather than duplicating this pipeline.
The service must validate that the stored sanitized path resolves beneath the
configured storage root, reject symlinks and unrecognized filenames, enforce the
stored size/hash contract, decrypt with the sanitized-artifact AAD, and return only
the sanitized bytes.

The original artifact has no application route. A sanitized-read failure must never
fall back to the original.

### 4.3 Coarse IP location evidence

At report submission, the backend resolves the trusted client address through the
existing real-client-IP boundary, performs a server-side GeoIP lookup, and stores
only:

- municipality/city;
- province/region label where available;
- city/municipality centroid as PostGIS geography;
- provider accuracy radius in meters;
- provider/source identifier;
- lookup timestamp.

The raw address is discarded after the lookup. The existing salted hash remains
available for abuse controls.

GeoIP failure does not block an emergency report. The evidence projection marks the
source unavailable. Existing reports are not speculatively backfilled.

PostGIS remains the source of truth for persisted location distances. The workspace
uses server-computed distances and classifications for:

- incident pin to device GPS;
- incident pin to EXIF GPS;
- incident pin to IP-city centroid;
- device GPS to EXIF GPS.

The API labels IP evidence as coarse and approximate. It must never describe the
centroid as the reporter's exact location or use it alone to recommend a terminal
outcome.

### 4.4 Validator evidence boundary

The queue endpoint remains optimized for polling and prioritization. Detailed
workspace data is fetched through focused validator routes after the user chooses a
cluster.

Proposed contracts:

#### `GET /api/triage/clusters/{cluster_id}/workspace`

Returns:

- cluster claim/workflow summary;
- report list and full safe report context;
- safe image metadata and image content URLs;
- report/device/EXIF/IP-city location evidence and server-computed distances;
- contributor credibility summaries;
- report follow-ups, validator activity, and civilian-visible status timeline.

It excludes:

- image bytes;
- original artifact access;
- raw IPs and raw device IDs;
- storage paths, encryption metadata, and ciphertext;
- unrestricted EXIF and original filename;
- contact PII until explicitly revealed.

#### `GET /api/triage/reports/{report_id}/photos/{photo_id}/content`

Returns the decrypted sanitized JPEG/PNG only after validating role, RLS visibility,
report/photo association, path isolation, hash, size, MIME, and AAD. Responses use:

- `Cache-Control: no-store`;
- `Pragma: no-cache`;
- `X-Content-Type-Options: nosniff`;
- inline content disposition without the original filename.

#### `POST /api/triage/reports/{report_id}/contact-reveal`

Decrypts and returns the submission-time contact snapshot only after authorization
and a transaction-bound sensitive audit event. Using POST makes the auditable reveal an
explicit action rather than a side effect of page loading.

Existing claim, terminal, split, merge, activity, correction, and status-update
routes retain their semantics.

## 5. Validator Workspace UX

### 5.1 Route and navigation

Queue `Inspect / Act` controls navigate to
`/incidents/triage/[clusterId]`. The return link preserves queue filters and the
selected item. Reloading or deep-linking the workspace reconstructs state from the
cluster ID and current server data.

The existing modal remains temporarily while page parity is established, then its
modal-only shell is removed. Existing action components and state logic should be
reused rather than reimplemented.

### 5.2 Page structure

#### Sticky cluster header

Shows cluster ID, severity, life-safety/aging/timeout indicators, claim owner and
claim age/countdown, freshness, refresh, and return-to-queue controls. It preserves
the no-commit-keyboard-shortcut policy.

#### Report navigator

Shows one entry per cluster report with status, trust score, source type, photo
count, GPS mismatch, duplicate-device signal, update count, and selection state.
Selecting a report updates the evidence workspace without navigating away.

#### Image evidence

Shows the sanitized image gallery and explicit loading, unavailable, corrupt, and
permission-denied states. Safe metadata includes capture time, dimensions, EXIF
availability, GPS consensus, evidence source, and image-to-report distance. It does
not display the original filename, camera serial, unrestricted EXIF tags, storage
path, or crypto metadata.

#### Location comparison map

The map has distinct marker shapes and a legend for:

- civilian-selected incident pin;
- device/browser GPS;
- image EXIF GPS;
- coarse IP-city centroid with accuracy circle.

Distance lines and text classifications communicate close match, possible mismatch,
and unavailable evidence without relying on color alone. Persistent copy states
that IP location is approximate and that mismatch signals are investigative aids,
not truth determinations.

#### Contributor credibility

The compact summary shows authenticated versus anonymous source, reliability
score/badge, prior report outcomes, evidence-quality component, and account
activity. Expandable details may use the existing validator-facing contributor API.
Anonymous reports display only available non-identifying evidence signals. Contact
reveal is separate and audited.

#### Review and feedback

The page reuses Terminal, Split, Merge, Activity, Correction, and Send Update
components. It shows narrative, category, reported/received times, safety status,
previous-report reference, follow-ups, internal validator-visible history, and the
civilian-visible feedback timeline. Existing two-step destructive confirmation and
citizen-message preview behavior remain mandatory.

## 6. Security, Privacy, and Audit

- Server-side role dependencies and RLS remain the authorization boundary.
- The queue remains privacy-minimized even after the workspace is added.
- Sanitized content and evidence responses are not cached offline or by shared
  caches.
- Reporter PII is not stored in plaintext localStorage drafts or plaintext offline
  operation payloads. Offline persistence uses device-bound Web Crypto with a
  purpose-specific AAD and no plaintext fallback.
- No route accepts a caller-provided storage path, user ID, contributor ID, or
  authenticated identity snapshot.
- No route serves originals or unrestricted metadata.
- Contact reveals are sensitive audit events; ordinary page loads do not reveal
  contact details.
- GeoIP resolution uses only the trusted real-client-IP chain and immediately
  discards the raw address after deriving approved coarse evidence and the existing
  abuse-control hash.
- Location mismatches cannot automatically reject, action, or promote a report.
- Photo failures and GeoIP failures do not roll back a successfully committed
  emergency report unless the failure occurs inside the existing atomic photo
  upload transaction.
- Reporter identity and direct-eyewitness PII remain semantically separate. Both
  use the established crypto-provider dispatch with distinct documented AADs and
  no plaintext fallback.
- Existing final-schema audit/immutability gaps are not widened by this feature.

## 7. Failure Handling

- Missing, quarantined, corrupt, hash-mismatched, out-of-root, or undecryptable
  sanitized artifacts return a neutral unavailable result and emit safe operational
  logging. They never trigger original-image fallback.
- A failed image does not prevent the remainder of the cluster workspace from
  loading. The report retains an explicit image-unavailable state.
- GeoIP timeout/database absence yields unavailable coarse evidence and does not
  block submission.
- Missing anonymous name blocks every anonymous submission. Missing anonymous phone
  blocks normal submissions but not life-safety fast submit.
- Incomplete authenticated identity for a normal report directs the user to profile
  completion; life-safety submission remains available when only phone is missing.
- Workspace authorization failures do not reveal whether an inaccessible cluster,
  report, or image exists.
- Polling/refresh must not overwrite a validator's in-progress action form. The page
  shows a refresh-needed state when server data changes during an action.

## 8. Schema and Migration

The implementation plan must identify the smallest schema extension consistent with
current bootstrap and Alembic history. The approved evidence fields are nullable so
existing rows remain valid.

The expected `citizen_reports` additions are the coarse IP-geolocation fields:

- city/municipality;
- province/region label;
- PostGIS geography centroid;
- accuracy radius meters;
- provider/source;
- lookup timestamp.

Reporter identity requires a dedicated encrypted snapshot because the established
witness fields describe the direct eyewitness, not necessarily the reporter. The
smallest acceptable schema extension is an encrypted reporter-identity envelope on
`citizen_reports` with provider, IV/nonce, key-version, and key-name metadata that
matches the current crypto-provider contract. Use a distinct, versioned AAD such as
`civilian-report:{report_id}:reporter-identity:v1`. Plaintext reporter-name or
reporter-phone columns are not permitted. Existing witness fields and their AAD
remain unchanged.

Persistent upgrades require a new Alembic revision, and clean-volume bootstrap SQL
must be kept aligned. Grants, RLS behavior, PostGIS casts, crypto invariants, and
audit effects require explicit tests.

## 9. Validation Strategy

### 9.1 Backend

Tests must cover:

- validator sanitized-image retrieval;
- denial for unauthorized roles and cross-scope access;
- report/photo association and neutral not-found behavior;
- sanitized AAD decryption, stored hash/size verification, MIME, path isolation,
  symlink rejection, missing file, and corrupt file;
- proof that originals have no route and are never returned as fallback;
- workspace privacy projection and contributor summary;
- contact reveal authorization plus transaction-bound sensitive audit;
- anonymous normal and life-safety identity validation;
- authenticated server-derived reporter identity and incomplete-profile behavior;
- reporter-versus-eyewitness semantic separation, encryption AAD, and no plaintext
  fallback;
- anonymous Turnstile/lower cap and authenticated bypass/higher cap regression;
- GeoIP success/failure, trusted-IP source, raw-IP non-retention, centroid/accuracy
  persistence, and PostGIS distance calculations;
- fresh migration and persistent upgrade behavior.

### 9.2 Frontend

Tests must cover:

- queue-to-workspace routing, deep link, refresh, and filter-preserving return;
- cluster/report loading, report selection, stale-data handling, and empty/error
  states;
- sanitized gallery loading/unavailable/corrupt states;
- location-map markers, accuracy circle, distance lines, classifications, legend,
  and unavailable sources;
- contributor compact/expanded states and anonymous-safe projection;
- explicit audited contact-reveal interaction;
- feedback timeline and existing action panels;
- destructive confirmations, citizen-message previews, and no commit shortcuts;
- keyboard access, focus behavior, semantic labels, non-color-only markers, and
  responsive layout;
- encrypted anonymous draft/offline identity persistence, replay, key-loss recovery,
  and absence of plaintext PII in localStorage/IndexedDB operation records;
- production Next.js build.

### 9.3 Infrastructure smoke test

Against an authorized non-destructive environment:

1. upload a civilian JPEG/PNG;
2. verify the DB photo row and encrypted artifacts exist beneath the configured
   named-volume path without printing sensitive metadata;
3. recreate the backend container without deleting volumes;
4. retrieve the sanitized image through the validator route;
5. verify the response hash matches the expected sanitized plaintext and the
   original remains inaccessible.

The smoke test must not use `docker compose down -v`.

## 10. Rollout Order

1. Add nullable coarse GeoIP schema and server-side lookup adapter.
2. Add read-side photo/evidence services and security tests.
3. Add validator workspace, sanitized-content, and audited contact-reveal APIs.
4. Add authenticated identity derivation and anonymous validation rules.
5. Add the dedicated frontend workspace while retaining modal parity.
6. Route queue inspection to the page and run action/UX regression tests.
7. Remove modal-only code after parity is verified.
8. Run migration, backend, frontend, Compose, and persistence smoke gates.
9. Synchronize system-wiki route, security, schema, subsystem, operations, gap, and
   log documentation according to actual implementation impact.

## 11. Acceptance Criteria

1. Encrypted civilian image bytes survive an ordinary backend container recreation
   and remain readable through the validator-only sanitized endpoint.
2. National Validators can view sanitized images and safe metadata in a dedicated
   cluster workspace; originals cannot be rendered or downloaded.
3. The comparison map represents every available approved source: report pin,
   device GPS, EXIF GPS, and coarse IP-city centroid with accuracy radius.
4. Missing location sources are shown as unavailable; no report is automatically
   rejected or actioned because of a mismatch.
5. Anonymous normal reports require name and phone; anonymous life-safety reports
   require name but allow phone omission.
6. Authenticated reporters are not asked to repeat profile identity; the backend
   derives and encrypts a dedicated submission-time reporter snapshot without
   overwriting direct-eyewitness fields.
7. Anonymous reporter PII is never persisted in plaintext browser drafts or offline
   operation payloads; encrypted offline replay remains functional.
8. Anonymous Turnstile/lower limits and registered bypass/higher limits are
   preserved.
9. Contributor credibility and report feedback/history are available in the
   workspace without exposing raw device IDs, raw IPs, or contact PII on load.
10. Contact reveal is explicit, role-protected, and sensitively audited.
11. Queue polling remains lightweight and privacy-minimized.
12. Schema upgrades work for persistent databases and clean bootstrap.
13. Images, sensitive metadata, and validator evidence are not cached offline.

## 12. Non-Goals

- Video or audio evidence.
- Public image access.
- Validator access to original images.
- Raw-IP retention or exact IP-derived location.
- AI fraud/truth scoring or automatic validator decisions.
- Direct creation of official `fire_incidents` from civilian triage.
- Off-host image backup, object-storage migration, or disaster-recovery redesign.
- Unrelated validator dashboard, contributor leaderboard, or public-map redesign.

## 13. Documentation Impact After Implementation

Implementation changes will require synchronization of at least:

- `system-wiki/subsystems/civilian-reporting-phase2.md`;
- `system-wiki/frontend/route-map.md`;
- `system-wiki/backend/api-route-map.md`;
- `system-wiki/database/schema-overview.md`;
- `system-wiki/security/security-baseline.md`;
- `system-wiki/operations/civilian-triage-hci-polish.md`;
- `system-wiki/gaps/frs-codebase-gap-register.md` if alignment changes;
- `system-wiki/log.md`.

This specification records intended behavior only. Those implementation synthesis
pages must not claim the feature is live until the code, migrations, tests, and
deployment checks are complete.
