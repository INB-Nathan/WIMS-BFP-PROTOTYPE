# Civilian Contributor Enhancement — Design Spec

**Date:** 2026-07-06
**Updated:** 2026-07-11
**Status:** Draft — Phase 5 design aligned after product-voice review
**Sources:** Defense panel feedback, design grill with wims-route + grill-with-docs skills, Oracle subagent consultations
**Glossary:** See `CONTEXT.md` (terms: Civilian Contributor, Anonymous Contributor, Registered Contributor, Contributor Trust Score, Routing Distance, Photo Metadata Analysis)

---

## 1. Problem

The current civilian reporting flow sends reports to a national validator who can only return simple feedback (actioned/bogus). The civilian gets nothing meaningful back from the system — no routing info, no station awareness, no contribution recognition. A defense panel identified three gaps:

1. **No feedback loop** — civilians don't know what happened after they report. "Why not just call 911?"
2. **No trustworthiness signals** — reports lack photo evidence with verifiable metadata.
3. **No contributor identity** — regular reporters have no way to build reputation or track their impact.

---

## 2. Design Overview

Three interconnected workstreams:

**A) Operational feedback via routing** — Give civilians immediate, concrete information about which station would respond and estimated arrival time.

**B) Photo metadata analysis** — Allow photo uploads with GPS verification to increase report trustworthiness.

**C) Contributor model** — Two paths (anonymous + registered) with different guardrails, feedback richness, and a trust score for registered contributors.

All workstreams share the same core API surface — auth detection determines guardrails and data richness.

---

## 3. Three-Tier Feedback

| Tier | Audience | What they see |
|------|----------|---------------|
| 1 — Tracking page | Anyone holding a valid tracking capability (no account required) | Report status, station name/phone, road distance, ETA range |
| 2 — Registered dashboard | Authenticated `CIVILIAN_REPORTER` | Full report history, trust score, contribution stats, per-report routing + photos |
| 3 — Validator panel | `NATIONAL_VALIDATOR` | Routing data + photo metadata flags + ability to enrich feedback |

The tracking page uses an unguessable, expiring tracking capability rather than report-ID enumeration. Public lookups return neutral `404` responses for missing, expired, or unauthorized capabilities, are throttled, and never expose exact civilian coordinates or reverse-geocodable location data. Routing output is limited to the approved station/distance/ETA fields. Tiers 2 and 3 are new.

---

## 4. Routing Data (OSRM Integration)

### 4.1 Data Source

**OSRM Public API** (`router.project-osrm.org`) for prototyping. A single HTTP GET call returns road distance (meters) and estimated driving time (seconds) between two coordinates.

```
GET /route/v1/driving/{station_lng},{station_lat};{fire_lng},{fire_lat}
→ { "routes": [{ "distance": 3200, "duration": 420 }] }
```

### 4.2 Call Pattern

The OSRM call is made through a **routing service** (`backend/services/routing.py`), not directly in the route handler:

1. **Synchronous attempt** — the routing service calls OSRM with station coords → fire location coords at submission time.
2. **Async fallback** — if the call fails (timeout, network error, OSRM down), enqueue a Celery task (`tasks.routing`) to retry. The report submission always succeeds regardless.
3. **PostGIS fallback** — if both OSRM attempts fail, use existing `ST_Distance` straight-line distance × 1.5 sinuosity factor as a rough estimate. Duration is derived as `straight_line_distance × 1.5 / 11.11 m/s` (40 km/h average urban speed).

### 4.3 New Columns on `citizen_reports`

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| `routing_distance_m` | `FLOAT` | Yes | Road distance in meters from OSRM or fallback |
| `routing_duration_s` | `FLOAT` | Yes | Estimated driving time in seconds |
| `routing_data_source` | `TEXT` | Yes | `"osrm"` or `"postgis_straight_line"` |
| `routing_execution_path` | `TEXT` | Yes | `"sync"`, `"celery"`, or `"fallback"` |
| `routing_updated_at` | `TIMESTAMPTZ` | Yes | When routing was computed |

`routing_data_source` tracks whether the values came from OSRM or PostGIS estimation. `routing_execution_path` tracks whether the sync call succeeded, a Celery retry succeeded, or both failed and we fell back. This split avoids the ambiguity of a single `routing_provider` column.

### 4.4 Frontend Display

The ETA range is derived client-side from `routing_duration_s`:
- Apply ±30% traffic buffer → e.g., 420s → "5–10 minutes"
- Below 180s: "Under 5 minutes"
- Above 1800s: "30+ minutes"

Station name, phone, distance, and ETA shown on the tracking page, dashboard, and validator panel.

### 4.5 Route Geometry (Deferred)

Explicitly not stored. The route geometry from OSRM is a stale snapshot by the time a future station-dispatch layer needs it — fresh routing based on current truck position and traffic will be computed dynamically. Storing geometry adds 2-10 KB per route with no long-term value.

---

## 5. Anonymous vs Registered Model

Both paths are always available. Auth detection at the endpoint level determines which guardrails apply.

| Property | Anonymous | Registered (`CIVILIAN_REPORTER`) |
|----------|-----------|----------------------------------|
| **Identity** | `device_id` (localStorage UUID) | Keycloak JWT |
| **Auth on endpoints** | None (public) | `Depends(optional_auth)` — returns user or None |
| **Rate limit** | 3 reports/hour/IP | 20 reports/hour |
| **CAPTCHA** | Required (Cloudflare Turnstile) | Skipped |
| **Photos per report** | Max 1, 5MB each | Max 5, 10MB each |
| **Report visibility** | Single tracking page | Full dashboard with history |
| **Trust scoring** | Single-report score only | Accumulated 0-100 score |
| **Routing data** | Station name + phone + distance + ETA | Same + dispatch history |
| **Community page** | Read-only safety content, announcements, events, and station directory | Public; registered users also link to `/contributor` |

---

## 6. Contributor Trust Score

### 6.1 Formula (Normalized Reliability Model)

Each component is normalized to `[0, 1]` before applying its weight:

```
trust_score = clamp(
    0,
    100,
    20 * volume_progress
  + 45 * outcome_accuracy
  + 20 * evidence_quality
  + 15 * consistency
  - decay
)
```

| Component | Weight | Definition |
|-----------|-------:|------------|
| **Outcome accuracy** | 45 | Actioned decided reports divided by all decided reports, scaled by `min(1, decided_reports / 10)` confidence. |
| **Volume progress** | 20 | `min(1, log(1 + root_reports) / log(21))`; root reports only, with diminishing returns. |
| **Evidence quality** | 20 | Normalized quality of supporting evidence: photo exists (0.25), GPS verified (0.35), photo near report (0.20), timestamp consistent (0.20), clamped to 1.0. |
| **Consistency** | 15 | `active_months / 6`, where active months are distinct calendar months in the previous six calendar months containing at least one submitted root report. Appends do not count. |
| **Decay** | — | `min(20, inactive_months * 2)`; gradual inactivity penalty, clamped by the final score floor of 0. |

Outcome accuracy considers only decided reports. The canonical decided set is `ACTIONED`, `REJECTED_BOGUS`, `REJECTED_DUPLICATE`, `REJECTED_INSUFFICIENT`, and `REJECTED_TIMEOUT`; pending, under-review, linked, archived, and unknown future statuses are excluded. An accuracy of 100% after one decided report receives only 10% confidence; full confidence begins at 10 decided reports. The six-month consistency window measures persistence rather than report volume: it is the current UTC calendar month plus the five preceding UTC calendar months; multiple root reports in one month still count as one active month, and appends are excluded. Score calculations must be reproducible after outcome corrections and must record the formula version used for persisted snapshots.

### 6.2 Badge Levels

| Range | Badge |
|-------|-------|
| 0–19 | Novice |
| 20–49 | Regular |
| 50–79 | Trusted |
| 80–100 | Guardian |

### 6.3 Evidence Quality Detail

Evidence quality is a normalized supporting signal, not a substitute for operational outcome accuracy. Per report:

- +0.25 when at least one photo exists
- +0.35 when GPS is verified
- +0.20 when the photo is near the reported location
- +0.20 when the photo timestamp is consistent with the report

The evidence score is clamped to 1.0 per report and aggregated across the contributor's eligible root reports. Multiple photos must not create unbounded score growth. “Photo near” uses the PostGIS distance between the photo's verified metadata point and the report location with the existing 500m threshold; timestamp consistency uses a 24-hour absolute server-side tolerance, and unavailable metadata contributes zero for that signal.

Sensitive EXIF/browser GPS, timestamps, device metadata, and original filenames are encrypted with the established versioned AES-GCM/OpenBao provider and photo-ID-bound AAD. Only minimized derived flags and distances required by authorized validator views may remain plaintext. Validators see trust information as non-authoritative context, access is role-restricted and audited, and contributor-facing score history is private.

### 6.4 Storage

Trust score is **computed live** from report history at read time. The persisted contributor row is a cache/snapshot only; the score must remain reproducible from the report, outcome, evidence, and activity history. Cache with Redis if query latency becomes an issue.

### 6.5 Performance Validation

Before introducing caching, benchmark the live contributor profile aggregation against representative data volumes (target fixture: approximately 10,000 contributors and 100,000 reports, including root reports, appends, decided outcomes, and photo evidence).

The implementation must define and record an acceptable latency target for the profile/stats request, measure query latency and database load at that scale, and include the benchmark in the implementation validation evidence. If the live-derived query exceeds the target, document Redis or materialized-view caching as a follow-up justified by the benchmark; do not add speculative caching before measurement.

---

## 7. Photo Upload + Metadata Analysis

### 7.1 Pipeline Flow

```
Civilian takes/selects photo
    │
    ▼
navigator.geolocation.getCurrentPosition()  ← GPS captured at the moment
                                              of taking (camera) or selecting
                                              (gallery). For gallery selections,
                                              this records where the user is
                                              now, which may differ from capture
                                              location — the validator sees this
                                              distinction.
    │
    ▼
POST /api/civilian/photos/upload
  multipart/form-data: file + browser_gps fields
    │
    ▼
Server pipeline:
  1. Sanitize filename + check extension + magic byte sniff
  2. Read raw bytes
  3. Extract EXIF from raw bytes  ← BEFORE strip
  4. Strip EXIF via strip_image_exif()
  5. Compute SHA-256 hashes of original and sanitized bytes
  6. Encrypt stripped bytes with AES-256-GCM (reusing get_crypto_provider())
  7. Write encrypted file to disk
  8. Insert report_photos row with encrypted metadata envelope and minimized derived evidence flags
    │
    ▼
Returns { photo_id: "uuid-..." }
    │
    ▼
POST /api/civilian/reports { ..., photo_ids: ["uuid-1", "uuid-2"] }
  → Backend validates every photo_id belongs to this uploader (anonymous_session capability or user_id)
  → Locks the complete photo batch, rejects mixed/partial ownership, and atomically sets report_id + attached_at
  → Computes gps_consensus + photo_reported_distance_m from encrypted metadata via the authorized service path
```

### 7.2 `report_photos` Table

```sql
CREATE TABLE IF NOT EXISTS wims.report_photos (
    photo_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id           INT REFERENCES wims.citizen_reports(report_id),
    
    -- Uploader identity (exactly one owner branch is set)
    uploader_user_id      UUID REFERENCES wims.users(user_id),
    anonymous_session_id  UUID REFERENCES wims.anonymous_sessions(anonymous_session_id),

    -- File metadata
    original_filename   TEXT NOT NULL,
    storage_path        TEXT NOT NULL,
    file_size_bytes     INTEGER NOT NULL,
    mime_type           TEXT NOT NULL,
    image_width         INTEGER,
    image_height        INTEGER,
    original_sha256     TEXT NOT NULL,
    sanitized_sha256    TEXT NOT NULL,

    -- Encryption metadata (AES-256-GCM, reuses incident_attachments pattern)
    encryption_iv           TEXT,
    encryption_key_version  TEXT,

    -- Sensitive EXIF/browser GPS, filename, device metadata, and timestamps
    -- are stored only in the encrypted metadata envelope. These derived fields
    -- are the only plaintext evidence signals.
    exif_gps_status              TEXT NOT NULL DEFAULT 'unavailable',
    browser_gps_status           TEXT NOT NULL DEFAULT 'unavailable',
    photo_reported_distance_m   NUMERIC,
    gps_consensus                TEXT,   -- both_match | exif_only | browser_only | both_disagree | unavailable
    timestamp_consistent         BOOLEAN NOT NULL DEFAULT FALSE

    -- Tracking
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    attached_at         TIMESTAMPTZ
);

CREATE INDEX idx_report_photos_report_id ON wims.report_photos(report_id);
CREATE INDEX idx_report_photos_orphans ON wims.report_photos(created_at) WHERE report_id IS NULL;
CREATE INDEX idx_report_photos_uploader ON wims.report_photos(uploader_user_id) WHERE uploader_user_id IS NOT NULL;
CREATE INDEX idx_report_photos_anonymous_session ON wims.report_photos(anonymous_session_id) WHERE anonymous_session_id IS NOT NULL;
```

### 7.3 Validation Logic

**Thresholds:**
- EXIF GPS vs Browser GPS difference: Dynamic threshold = `max(100, browser_gps_accuracy × 3)` meters
- Photo GPS (best available) vs reported fire location: 500m threshold
- If both GPS sources available and disagree → `gps_consensus = "both_disagree"`
- If neither available → `gps_consensus = "unavailable"`

**Missing EXIF fallback:** If EXIF GPS is unavailable (browser stripped it, common on mobile), trust the browser GPS. Only flag if both are missing or both disagree.

**Extraction ordering is critical:** EXIF extraction must happen BEFORE `strip_image_exif()` — the strip is destructive. The existing `strip_image_exif` in `incidents.py` will be reused as a utility function.

**Browser GPS trust note:** For gallery photo selections, the browser GPS marks *where the user is when they selected the photo*, not necessarily where the photo was taken. The validator sees both EXIF GPS (capture location, if present) and browser GPS (selection location) independently.

### 7.4 Storage & Encryption

Photos are stored **encrypted at rest** using the existing AES-256-GCM infrastructure (`get_crypto_provider()` from `services/kms.py`), matching the `incident_attachments` encryption pattern. This is required because photos may contain PII (faces, license plates) and WIMS architecture mandates PII encrypted at rest.

Encryption metadata (`encryption_iv`, `encryption_key_version`) is stored on each `report_photos` row. The AAD binds ciphertext to `photo:{photo_id}`.

### 7.5 Ownership Enforcement

The ownership columns ensure:
- Registered uploads are bound to `uploader_user_id`.
- Anonymous uploads are bound to `anonymous_session_id`, which references a hash-backed, expiring anonymous session; client device IDs are not authorization credentials.
- The report submission endpoint validates every `photo_id` against the authenticated user or the same anonymous session capability in one transaction.
- Photo caps (anonymous max 1, registered max 5) are enforced by an owner-scoped, locked query over pending rows.

Anonymous session capabilities are high-entropy bearer tokens returned once at session creation, never placed in URLs or logs, and stored only as SHA-256 hashes. Sessions have idle and absolute expiry plus revocation. A narrowly scoped fixed-`search_path` `SECURITY DEFINER` helper validates the bearer hash and performs pending-photo create/read/delete and all-or-nothing attach; it accepts no caller-supplied owner ID and is not a general RLS bypass.

### 7.6 Orphan Cleanup

A Celery beat task (`tasks.cleanup_orphan_photos`) removes only photos where `report_id IS NULL AND created_at < now() - interval '24 hours'`. Cleanup uses an explicit task identity or narrowly scoped helper, validates storage paths, removes the DB row and encrypted artifacts with retry/compensation behavior, and writes an append-only audit event for each success or failure. Cleanup must be idempotent and must never perform arbitrary filesystem deletion.

---

## 8. Endpoint Architecture

### 8.1 Auth Detection

The existing `get_current_user` dependency raises 401 when no auth cookie is present — it cannot be used for endpoints that serve both anonymous and authenticated callers.

A new **`optional_auth`** dependency is needed for civilian routes. It may return `None` only when no credential is supplied. If a credential is present but expired, malformed, invalid, or fails audience/role validation, it must return `401`; invalid credentials must never be downgraded to anonymous behavior.

This allows a single endpoint to branch on whether the caller is a registered contributor without weakening authentication semantics. Add tests for missing, valid civilian, valid non-contributor, expired, malformed, and invalid-audience credentials.

### 8.2 Same Endpoints, Auth Detection Pattern

The report submission endpoint detects authentication automatically:

```python
# Pseudocode — auth detection in civilian.py
async def submit_civilian_report(
    body: CivilianReportCreate,
    request: Request,
    db: Session,
    user: Annotated[dict | None, Depends(optional_auth)] = None,
):
    is_registered = user is not None and user.get("role") == "CIVILIAN_REPORTER"
    
    if is_registered:
        # Fast-track: higher rate limit, no CAPTCHA, link to account
        rate_limit_cap = REGISTERED_REPORT_HOURLY_CAP  # 20
        contributor_user_id = user["user_id"]
    else:
        # Anonymous: strict limits, CAPTCHA required
        await verify_turnstile(body.turnstile_token, request.client.host)
        rate_limit_cap = CIVILIAN_REPORT_HOURLY_CAP  # 3
        body.device_id required
        contributor_user_id = None
```

### 8.3 Complete Endpoint Set

**Public (no auth):**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/civilian/photos/upload` | Pre-upload photo (CAPTCHA required for anon) |
| `POST` | `/api/civilian/reports` | Submit report (CAPTCHA required for anon) |
| `GET` | `/api/civilian/reports/{id}` | Tracking page projection; requires a valid unguessable tracking capability token |
| `PATCH` | `/api/civilian/reports/{id}/append` | Append to report (CAPTCHA for anon and device/capability ownership check) |
| `GET` | `/api/civilian/community/content` | Published safety articles, announcements, events, and optional urgent banner |
| `GET` | `/api/civilian/community/content/{slug}` | Published article, announcement, or event detail |
| `GET` | `/api/ref/fire-stations` | Station directory (exists already) |

**Authenticated CMS administration (requires `SYSTEM_ADMIN` JWT):**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/admin/community/content` | List drafts, published, and archived content |
| `POST` | `/api/admin/community/content` | Create a draft |
| `PATCH` | `/api/admin/community/content/{id}` | Edit or archive content |
| `POST` | `/api/admin/community/content/{id}/preview` | Render a private preview |
| `POST` | `/api/admin/community/content/{id}/publish` | Publish a reviewed draft |
| `POST` | `/api/admin/community/content/{id}/rollback` | Restore a previous published version |

All CMS transitions are authorized server-side, limited to one authorized system administrator role, and append audit records.

**Authenticated (requires `CIVILIAN_REPORTER` JWT):**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/civilian/contributor/me` | Profile + trust score + badge |
| `GET` | `/api/civilian/contributor/reports` | Paginated report history |
| `GET` | `/api/civilian/contributor/stats` | Private self-tracking metrics + chart data |

### 8.4 Community Hub and CMS

The public Community Safety Hub is separate from the anonymous emergency-reporting landing page:

- `/` remains the anonymous report flow. After emergency guidance, it may show a neutral concise contributor invitation: `Sign in` is primary, `Create account` secondary, and anonymous reporting remains explicitly available.
- `/community` is public and safety-first. Its order is: optional urgent banner, safety quick-action cards (`During a fire`, `Report safely`, `Prepare`), separate Announcements and Upcoming Events sections, then the station directory. Signed-in users receive a link to `/contributor`.
- `/contributor` is authenticated and private. It shows personal trust score and breakdown, badge, report history, outcome/activity metrics, and photo contribution counts. It is not a public ranking.
- `/community/announcements/[slug]` and `/community/events/[slug]` are dedicated, shareable detail routes. Events are informational listings only; there is no RSVP workflow.

CMS content types are safety articles, announcements, and events. Only one authorized system administrator may create, edit, publish, archive, or roll back content through a dedicated server-side `SYSTEM_ADMIN` dependency; cookie-authenticated mutations require the established CSRF and privileged-session/MFA controls. Each item follows `Draft → Published → Archived`; invalid transitions are rejected, publishing requires a public preview, and publish/rollback actions create atomic audit records and preserve immutable version history. Optimistic version IDs prevent stale edits from overwriting newer content; repeat publish/rollback requests are idempotent.

The CMS migration contract includes a content-item table, immutable content-version table, publication pointer, unique slugs, content type, English/Filipino fields, last-reviewed/expiry timestamps, one-active-urgent-banner constraint, and indexes for public type/status/expiry queries. Rollback creates a new version pointing to the selected prior content; it does not mutate or delete historical versions. Public reads filter `status = Published` and `expires_at IS NULL OR expires_at > now()` synchronously, even if the expiry task is delayed. All CMS content is stored as structured/plain text or sanitized with a strict HTML allowlist; templates, scripts, event handlers, unsafe URLs, and SSTI are prohibited.

Safety articles require English and Filipino content plus a last-reviewed date before publishing. Announcements and events may use an English fallback when Filipino is unavailable and require an expiration date; expired items are archived and removed from public views. The urgent banner is optional, bilingual, admin-controlled, audit-logged, and automatically expires. Public views need explicit loading, empty, expired, translation-fallback, and error states.

Station discovery is list-first with search and an optional map toggle. The map is collapsed by default. Selecting a station opens the map, centers and highlights that station, and retains all station pins; list and map filters stay synchronized. Keyboard and mobile interaction must not require location permission, and map failure falls back to the searchable list.

### 8.5 Photo ID References

Photos use UUIDs natively. PostgreSQL accepts `UUID[]` and `ANY(:ids)` for bulk updates:

```sql
UPDATE wims.report_photos 
SET report_id = :rid, attached_at = now() 
WHERE photo_id = ANY(:photo_ids)
  AND (uploader_user_id = :uid OR uploader_device_id = :did)
```

The WHERE clause enforces ownership — a caller can only attach photos they uploaded.

---

## 9. CAPTCHA Integration (Cloudflare Turnstile)

### 9.1 Scope

Turnstile is required on anonymous submissions for:
- `POST /api/civilian/reports`
- `POST /api/civilian/photos/upload`
- `PATCH /api/civilian/reports/{id}/append`

Skipped entirely for registered contributors.

### 9.2 Integration

**Frontend:** Drop the Turnstile widget into the report form:
```html
<div class="cf-turnstile" data-sitekey="{TURNSTILE_SITE_KEY}"></div>
```

**Backend:** Verify the token server-side before processing:
```
POST https://challenges.cloudflare.com/turnstile/v0/siteverify
Body: { "secret": "{TURNSTILE_SECRET_KEY}", "response": "{token}" }
→ { "success": true/false }
```

**Env vars:** `TURNSTILE_SITE_KEY` (frontend) + `TURNSTILE_SECRET_KEY` (backend).

**Development:** Test keys that always pass: `1x00000000000000000000AA` / `1x00000000000000000000000000000000AA`.

---

## 10. Validator Review Enrichment

### 10.1 What the Validator Sees

In the triage/cluster inspection modal, the validator sees per-report:
- Routing data: `Quezon City Fire Station 1 — 3.2 km road distance, est. 8-18 min ETA`
- Photo metadata per photo:
  - GPS consensus status: `"both_match"`, `"exif_only"`, `"browser_only"`, `"both_disagree"`, `"unavailable"`
  - Photo distance from reported fire location
  - Device make/model (from EXIF)
  - Photo timestamp vs report timestamp comparison
- Trust score for registered contributors (displayed as badge level)

### 10.2 Validator Feedback

Validators can include routing and photo metadata context in their terminal action explanations (already supported — `status_explanation` field on terminal actions).

---

## 11. Pydantic Schema Changes

Existing schemas need new fields. Key changes:

### `CivilianReportResponse`

| New Field | Type | Purpose |
|-----------|------|---------|
| `routing_distance_m` | `float \| None` | Road distance from nearest station |
| `routing_duration_s` | `float \| None` | Estimated driving time |
| `routing_data_source` | `str \| None` | `"osrm"` or `"postgis_straight_line"` |
| `photo_count` | `int` | Number of attached photos |
| `submitter_type` | `str` | `"anonymous"` or `"registered"` |

### `PhotoUploadResponse`

| Field | Type | Purpose |
|-------|------|---------|
| `photo_id` | `str` | UUID of the uploaded photo |
| `file_size_bytes` | `int` | File size |
| `mime_type` | `str` | Image MIME type |
| `image_width` | `int \| None` | Image width |
| `image_height` | `int \| None` | Image height |
| `exif_gps_status` | `str` | `"present"` or `"unavailable"` |
| `browser_gps_status` | `str` | `"present"` or `"unavailable"` |

### `ContributorProfileResponse`

| Field | Type | Purpose |
|-------|------|---------|
| `username` | `str` | Keycloak username |
| `trust_score` | `int` | Current 0-100 score |
| `badge` | `str` | `"novice"`, `"regular"`, `"trusted"`, `"guardian"` |
| `total_reports` | `int` | Lifetime report count |
| `verified_reports` | `int` | Reports with ACTIONED status |
| `nearest_station_name` | `str \| None` | Resolved from report history |
| `registered_since` | `datetime` | Account creation date |

---

## 12. Database Changes Summary

### 12.1 `citizen_reports` — 6 new columns (5 routing + 1 contributor FK)

```sql
ALTER TABLE wims.citizen_reports ADD COLUMN routing_distance_m       FLOAT;
ALTER TABLE wims.citizen_reports ADD COLUMN routing_duration_s       FLOAT;
ALTER TABLE wims.citizen_reports ADD COLUMN routing_data_source      TEXT;
ALTER TABLE wims.citizen_reports ADD COLUMN routing_execution_path   TEXT;
ALTER TABLE wims.citizen_reports ADD COLUMN routing_updated_at       TIMESTAMPTZ;
ALTER TABLE wims.citizen_reports ADD COLUMN contributor_user_id      UUID REFERENCES wims.users(user_id);
```

`contributor_user_id` is NULL for anonymous reports, set to the user's UUID for registered contributors.

### 12.2 `report_photos` — new table

As specified in §7.2.

**RLS:** New `report_photos` rows require `FORCE ROW LEVEL SECURITY`. Registered pending rows are bound to `wims.current_user_uuid()`. Anonymous pending rows are not authorized by a client device ID or a caller-set GUC; they are accessed only through narrowly scoped fixed-`search_path` `SECURITY DEFINER` helpers that validate the hash-backed anonymous session capability, enforce expiry/revocation, lock all requested rows, and perform all-or-nothing attach. Direct anonymous table writes remain denied; no general `BYPASSRLS` domain session is permitted. The helpers must have explicit signatures, revoked `PUBLIC` execute, strict owner/cap/size checks, and cross-session denial tests.

**Audit:** Photo pre-upload, attach, orphan deletion, failed authorization, session issuance, revocation, and rotation use the established append-only `wims.system_audit_trails` path and canonical actions (`PHOTO_UPLOAD_PREUPLOAD`, `PHOTO_UPLOAD_ATTACH`, `PHOTO_ORPHAN_DELETE`, `PHOTO_AUTHORIZATION_FAILURE`, and session actions). Sensitive payloads and raw tokens are excluded; actor/session-safe identifiers, hashed client metadata, request ID, outcome, and relevant record IDs are retained. Final-schema append-only enforcement must be verified.

### 12.3 `users` — no change

The `CIVILIAN_REPORTER` role already exists. No schema changes needed for the contributor model.

---

## 13. Service Layer

Business logic is placed in services, not routes, following WIMS architecture constraints.

| Service File | Responsibility |
|--------------|----------------|
| `services/routing.py` | OSRM API calls, PostGIS fallback, write routing columns |
| `services/report_photos.py` | EXIF extraction, encryption, upload + attach logic, orphan cleanup |
| `services/contributor.py` | Trust score computation and private self-tracking dashboard aggregation |
| `services/community_content.py` | Published community content projection, expiry, locale fallback, and CMS lifecycle operations |

Celery tasks:
| Task | Purpose |
|------|---------|
| `tasks.routing.retry_routing(report_id)` | Async OSRM retry when sync call fails |
| `tasks.routing.cleanup_orphan_photos()` | Delete unattached photos >24h old |
| `tasks.community.expire_content()` | Archive expired announcements/events and urgent banners |

---

## 14. Env Vars

| Variable | Used By | Purpose |
|----------|---------|---------|
| `TURNSTILE_SITE_KEY` | Frontend | Turnstile widget site key |
| `TURNSTILE_SECRET_KEY` | Backend | Turnstile server-side verification |
| `CIVILIAN_PHOTO_STORAGE_DIR` | Backend | Photo storage path (default: `/app/storage/civilian-photos`) |
| `REGISTERED_REPORT_HOURLY_CAP` | Backend | Rate limit for registered contributors (default: 20) |

---

## 15. Deferred Items

| Item | Reason |
|------|--------|
| Route geometry storage | Not useful — stale snapshot, future dispatch needs fresh routing |
| Forum/discussion on community page | Scope reduction for prototype |
| Badges/achievements | Scope reduction for prototype |
| Public leaderboard | Removed from Phase 5: ranking emergency contributors risks gamification, privacy exposure, and duplicate/low-value reporting |
| Nginx bot-blocker (bad bots) | Separate issue — nginx-ultimate-bad-bot-blocker |
| ETA with time-of-day factor | Over-engineered for prototype — ±30% traffic buffer is sufficient |

---

## 16. Phase 5 Prerequisites and Implementation Order

Before Phase 5, Phase 4 trust-score code and tests must be migrated from the legacy fixed-point formula to §6's normalized formula, and the legacy leaderboard route/service/schema/tests must be removed or explicitly proven unreachable. The public tracking contract must also be reconciled with the existing capability-token implementation before any new public content routes are exposed.



1. **Phase 1 — Schema + OSRM routing** (5 new columns, routing service, OSRM call, Celery fallback)
2. **Phase 2 — Photo upload pipeline** (new table, EXIF extraction, encryption, upload + attach endpoints, orphan cleanup)
3. **Phase 3 — CAPTCHA** (Turnstile frontend + backend verification, `optional_auth` dependency)
4. **Phase 4 — Registered contributor endpoints** (profile, reports, stats, private self-tracking dashboard)
5. **Phase 5 — Community Safety Hub** (CMS-managed safety content, announcements, events, urgent banner, station list/map toggle, dedicated detail routes)
6. **Separate issue — Nginx bot-blocker**
