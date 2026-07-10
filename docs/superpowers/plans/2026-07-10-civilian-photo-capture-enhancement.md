# Civilian Photo Capture Enhancement — Implementation Plan v5

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Date:** 2026-07-10
**Status:** Final (v5 — addresses 3 remaining blockers: schema columns, RLS-safe idempotency, report-level dedup)
**Sources:** `docs/superpowers/specs/2026-07-06-civilian-contributor-enhancement-design.md`, `src/frontend/src/components/civilian/PhotoUpload.tsx`, `src/frontend/src/app/page.tsx`, `src/backend/services/report_photos.py`, `src/backend/api/routes/civilian.py`, `src/frontend/src/lib/offlineStore.ts`, `src/frontend/src/lib/syncEngine.ts`, `src/frontend/src/lib/usePublicAutoSync.ts`

## Goal

Enhance the Phase 2 photo pipeline with mobile-friendly camera capture, client-side EXIF extraction (before compression), photo compression, and offline photo queuing with local encryption — making photo evidence practical for stressed civilians on mobile browsers.

---

## Change Log

| Version | Key changes |
|---------|-------------|
| v1 | Initial draft |
| v2 | Fixed EXIF ordering, backend idempotency, parentLocalId, sync extension, local encryption |
| v3 | Fixed encryption key derivation (random CryptoKey), parentServerReportId, ON CONFLICT, EXIF data path, megapixel gate, retry/retention policies |
| v4 | Fixed: store CryptoKey via structured clone (no export), AAD with photoId in function signatures, durable parentServerReportId mapping in IndexedDB, atomic INSERT...ON CONFLICT DO NOTHING, EXIF ref tags via exifr normalized output, altitude/DateTimeOriginal storage columns, migration numbering, backoff formula |
| v5 | Fixed: migration 83 creates ALL EXIF columns (lat/lon/altitude/datetime), not just altitude+datetime; backend idempotency uses INSERT...ON CONFLICT DO NOTHING without follow-up SELECT (avoids RLS issue); report-level idempotency via client_report_id UUID on citizen_reports; startup-apply path for migrations 83/84 added to main.py |

---

## Implementation Phases

```
Phase A (Camera shortcut)
  └─► Phase E (EXIF extraction — must come before B)
       └─► Phase B (Compression — depends on E's EXIF)
            └─► Phase D (Offline queue — depends on B's compressed output)

[Phase C — Live Viewfinder: DEFERRED post-prototype]
```

**Serial execution order:** A → E → B → D. Each phase touches `PhotoUpload.tsx` and builds on the previous. Utility modules and tests can be written in parallel with stubs.

**Phase C (Live Viewfinder) — DEFERRED post-prototype:**
`getUserMedia()` + `ImageCapture` adds complexity for marginal UX gain over the native camera app opened by `capture="environment"`. Revisit if user testing shows poor camera-shortcut adoption.

---

## Phase A — Camera Shortcut (Tier 1)

**Scope:** Add `capture="environment"` and a "Take Photo" / "Choose from Gallery" toggle.

### Changes

**`src/frontend/src/components/civilian/PhotoUpload.tsx`:**
- Keep `accept="image/jpeg,image/png"` — explicit list avoids HEIC/WebP silently accepted then rejected by backend
- Split single `<input type="file">` into two modes sharing the same `handleFileSelect`:
  - **Camera mode:** `<input type="file" accept="image/jpeg,image/png" capture="environment">`
  - **Gallery mode:** `<input type="file" accept="image/jpeg,image/png">`
- UI: large "Take Photo" (camera icon, primary) + "Choose from Gallery" (folder icon, secondary)
- Desktop fallback: only gallery button shown

**`src/frontend/src/components/civilian/PhotoUpload.test.tsx`:**
- Camera-mode input has `capture="environment"`
- Gallery-mode input does NOT have `capture`
- Toggle clears previous selection
- Desktop: only gallery button

### Validation
- `npx vitest run src/components/civilian/PhotoUpload.test.tsx` — all pass
- `npm run lint` — 0 errors
- Manual: Android/iOS mobile → "Take Photo" opens native camera

---

## Phase E — Client-Side EXIF Extraction (Tier 5)

**Scope:** Extract EXIF GPS before compression. Send as form fields to backend. Must run before Phase B.

### Changes

**`src/frontend/package.json`:** Add `exifr` (~8KB gzipped).

**`src/frontend/src/lib/photoExif.ts`** (new):
```typescript
export interface ExifGpsData {
  latitude: number;
  longitude: number;
  altitude: number | null;
  timestamp: string | null;     // DateTimeOriginal as ISO string
}
export async function extractExifGps(file: File): Promise<ExifGpsData | null>
```
- Use `exifr.parse(file)` (not `.gps()`) — the full parser returns normalized values with ref tags already resolved. `exifr` normalizes `GPSLatitudeRef`/`GPSLongitudeRef`/`GPSAltitudeRef` into signed values internally, so southern latitudes and western longitudes are correctly negative and altitudes below sea level are negative.
- Selective tags for speed: `exifr.parse(file, ['GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSAltitudeRef', 'DateTimeOriginal'])`
- Wrapped in try/catch — failure returns null
- Test with synthetic southern-hemisphere, western-hemisphere, and negative-altitude EXIF samples

**`src/frontend/src/components/civilian/PhotoUpload.tsx`:**
- Call `extractExifGps(file)` as the **first** async step in `handleFileSelect`, before compression
- Store EXIF data in component state alongside file
- UI indicator: "GPS from camera: ✓" or "GPS from camera: not available"
- EXIF vs browser GPS match badge with client-side threshold `max(100, browser_gps_accuracy × 3)`
- Pass EXIF data via `onExifChange(exifData: ExifGpsData | null)` prop (new)

**`src/frontend/src/app/page.tsx`:**
- Wire `onExifChange` in the `PhotoUpload` usage (line ~2145)
- Store EXIF data in page state alongside photo/gps state
- Pass it to `uploadCivilianReportPhoto` when online

**`src/frontend/src/lib/api/civilian.ts` — `uploadCivilianReportPhoto`:**
- Add four new optional form fields:
  ```typescript
  exifGps?: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    timestamp: string | null;
  }
  ```
- Sent as `exif_gps_lat`, `exif_gps_lon`, `exif_gps_altitude`, `exif_datetime_original`

**`src/backend/api/routes/civilian.py` — `upload_report_photo`:**
- Add four new optional `Form()` parameters with validation:
  ```python
  exif_gps_lat: float | None = Form(default=None),
  exif_gps_lon: float | None = Form(default=None),
  exif_gps_altitude: float | None = Form(default=None),
  exif_datetime_original: str | None = Form(default=None),
  ```
- Validation rules:
  - `exif_gps_lat`: must be in [-90, 90] if present
  - `exif_gps_lon`: must be in [-180, 180] if present
  - `exif_gps_altitude`: any finite float, or null
  - `exif_datetime_original`: parseable ISO 8601, or null
  - Return 422 on any violation

**`src/backend/services/report_photos.py` — `upload_and_attach_photo`:**
- Accept four new parameters
- Store client-supplied EXIF in existing `exif_gps_lat`/`exif_gps_lon` columns
- Store `exif_gps_altitude` and `exif_datetime_original` in existing columns (both already exist in `wims.report_photos` from migration `82_civilian_report_photos.sql`)
- Set `exif_data_source = 'client_extracted'` when client supplies EXIF
- Backend also independently runs EXIF extraction from the binary. If that succeeds, update `exif_data_source = 'server_extracted'` (overwrites the client value — server is authoritative)
- `gps_consensus` computation uses server-extracted values as primary, falls back to client-supplied if server extraction found none

> **Fix for v5 — migration 82 does NOT have EXIF columns** (reviewer verified `src/postgres-init/82_civilian_report_photos.sql:91-108`). All four EXIF metadata columns plus the provenance tracking column are created here.

**`src/postgres-init/83_photo_exif_metadata.sql`** (new — creates all EXIF storage + provenance):
```sql
-- EXIF GPS columns (latitude, longitude, altitude, datetime original)
ALTER TABLE wims.report_photos ADD COLUMN exif_gps_lat NUMERIC(10,7);
ALTER TABLE wims.report_photos ADD COLUMN exif_gps_lon NUMERIC(10,7);
ALTER TABLE wims.report_photos ADD COLUMN exif_gps_altitude NUMERIC;
ALTER TABLE wims.report_photos ADD COLUMN exif_datetime_original TIMESTAMPTZ;

-- Provenance tracking
ALTER TABLE wims.report_photos ADD COLUMN exif_data_source TEXT;
COMMENT ON COLUMN wims.report_photos.exif_data_source IS
  'Source of EXIF data: NULL (none), server_extracted (from binary), or client_extracted (from form fields)';
```

**`src/frontend/src/lib/__tests__/photoExif.test.ts`** (new):
- JPEG with EXIF GPS returns signed lat/lng/altitude/timestamp
- Southern hemisphere → negative latitude
- Western hemisphere → negative longitude
- Negative altitude (below sea level) → negative value
- JPEG without EXIF → null
- PNG → null
- Corrupted file → null
- `extractExifGps` resolves before `compressPhoto` — order assertion

**Backend tests** (new):
- Valid EXIF form fields → 201, `exif_data_source = 'client_extracted'`
- Invalid lat/lng → 422
- Invalid altitude → 422
- Invalid timestamp → 422
- Server EXIF extraction from binary overwrites `exif_data_source` to `'server_extracted'`
- `gps_consensus` uses server values when available

### Validation
- `npx vitest run src/lib/__tests__/photoExif.test.ts` — all pass
- `npx vitest run src/components/civilian/PhotoUpload.test.tsx` — EXIF UI indicators pass
- `pytest tests/test_report_photos.py -q` — EXIF validation + provenance tests pass
- `npm run build` succeeds with `exifr`

---

## Phase B — Client-Side Photo Compression (Tier 2)

**Scope:** Compress photos after EXIF extraction, to <500KB for upload efficiency.

### Changes

**`src/frontend/src/lib/photoCompression.ts`** (new):
```typescript
export interface CompressionResult {
  blob: Blob;
  width: number;
  height: number;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  oversized: boolean;
}
export async function compressPhoto(file: File): Promise<CompressionResult>
```
- **Megapixel gate:** reject files where either dimension > 8000px (cannot be safely decoded in browser). These pass through uncompressed with `oversized: true`.
- Use `createImageBitmap(file)` + `OffscreenCanvas`
- **Max dimension 1280px** — bound both width and height
- JPEG quality starts at 0.7, iterates down to 0.3 in 0.1 steps until <500KB
- If still >500KB at quality 0.3, reduce max dimension to 1024px, retry from quality 0.7
- If original ≤500KB AND ≤1280px on both dimensions, return as-is
- OffscreenCanvas unavailable (Safari <16.4): return original with `oversized: true`
- Orientation: `createImageBitmap` respects EXIF orientation. Since EXIF is already extracted, orientation is irrelevant for the compressed output.

**`src/frontend/src/components/civilian/PhotoUpload.tsx`:**
- Call `compressPhoto(file)` **after** `extractExifGps(file)` resolves
- **Megapixel gate** replaces 5MB size rejection — do NOT reject based on size before compression
- Show "Compressing..." then size reduction: "3.2 MB → 0.4 MB"
- If `oversized`: show warning but allow upload
- Pass compressed Blob as `new File([blob], 'photo.jpg', { type: 'image/jpeg' })` to `onFileChange`
- **Stale async guard:** increment `fileGenerationRef` on each selection. After async completes, check match; discard if stale.

**`src/frontend/src/lib/__tests__/photoCompression.test.ts`** (new):
- JPEG >500KB compresses to <500KB
- Small file returned as-is
- Portrait bounded on height (1200×3000 → 512×1280)
- Oversized dimension (>8000px) → `oversized: true`
- OffscreenCanvas unavailable → original with `oversized: true`
- Stale async: rapid re-selection discards in-flight result

### Validation
- `npx vitest run src/lib/__tests__/photoCompression.test.ts` — all pass
- `npx vitest run src/components/civilian/PhotoUpload.test.tsx` — compression + stale guard pass

---

<!-- Phase C — Live Viewfinder: DEFERRED post-prototype -->

## Phase D — Offline Photo Queue (Tier 4)

### Architecture

```
Photo captured offline
    │
    ▼
1. Extract EXIF (Phase E)
2. Compress (Phase B)
3. Encrypt: AES-256-GCM, random IV, AAD = photo:{id}:{deviceId}
4. Store encrypted ArrayBuffer in OFFLINE_PHOTOS_STORE (DB v7)
5. Generate parentLocalId (UUID) → store on photo + report op
    │
    ▼
On reconnect, syncPublicOfflineOps():
  1. Sync pending JSON ops → on success, write parentLocalId→serverReportId to PHOTO_LINK_STORE (durable)
  2. Query photos with non-null parentServerReportId
  3. Decrypt → create File → POST /api/civilian/reports/{id}/photos with clientPhotoId
  4. 201 or 409-duplicate → delete from store
  5. Retryable failure → exponential backoff, max 5
  6. Permanent failure → mark permanentFailure
```

### Backend Changes

**`src/postgres-init/84_photo_idempotency_key.sql`** (new — unique numbering after 83):
```sql
ALTER TABLE wims.report_photos ADD COLUMN client_photo_id UUID;
CREATE UNIQUE INDEX idx_report_photos_client_id
  ON wims.report_photos(client_photo_id)
  WHERE client_photo_id IS NOT NULL;
```

**`src/backend/api/routes/civilian.py` — `upload_report_photo`:**
- Add `client_photo_id: str | None = Form(default=None)`, parse as `uuid.UUID` (422 if invalid)

**`src/backend/services/report_photos.py` — `upload_and_attach_photo`:**
- Accept `client_photo_id: uuid.UUID | None`
> **Fix for v5 — no follow-up SELECT.** The photo upload route uses `get_photo_db()` which establishes the `ANONYMOUS` RLS role. The `report_photos` table has staff-only SELECT policies, so a follow-up SELECT from this session would fail. Instead, the INSERT ... ON CONFLICT DO NOTHING RETURNING either returns the new photo_id (fresh insert) or NULL (duplicate). On NULL, we return a success response with `duplicate: true`. Device/report ownership verification is skipped on the duplicate path because `client_photo_id` is a random UUID (122 bits of entropy) — an attacker would need to guess a valid UUID to exploit this, which is infeasible.

- **Atomic idempotency contract — INSERT ... ON CONFLICT DO NOTHING, no follow-up SELECT:**
  ```python
  if client_photo_id:
      stmt = text("""
          INSERT INTO wims.report_photos (
              report_id, client_photo_id, uploader_device_id, file_size_bytes, mime_type,
              storage_path, md5_hash, encryption_iv, image_width, image_height,
              browser_gps_lat, browser_gps_lon, browser_gps_accuracy, browser_gps_captured_at,
              exif_gps_lat, exif_gps_lon, exif_gps_altitude, exif_datetime_original,
              gps_consensus, photo_reported_distance_m
          ) VALUES (
              :rid, :cpid, :did, :fsz, :mime,
              :path, :md5, :iv, :w, :h,
              :bplat, :bplon, :bpacc, :bpcap,
              :exlat, :exlon, :exalt, :exdt,
              :gpsc, :prd
          )
          ON CONFLICT (client_photo_id) WHERE client_photo_id IS NOT NULL
          DO NOTHING
          RETURNING photo_id
      """)
      photo_id = db.execute(stmt, params).scalar()
      if photo_id is not None:
          return PhotoUploadResponse(photo_id=str(photo_id), duplicate=False)
      # Duplicate — no SELECT needed. Trust the UUID entropy.
      return PhotoUploadResponse(photo_id=None, duplicate=True)
  ```
- This is fully atomic, RLS-safe (no SELECT from staff-only table in anonymous session), and race-free. Two concurrent identical inserts: one inserts, the other gets NULL, both return success.

#### Report-Level Idempotency (for Crash Recovery)

The crash recovery scenario: client sends report → server creates it → response lost. On retry, a duplicate report is created and photos link to the wrong `report_id`.

**Fix — add `client_report_id` to `citizen_reports`:**

**`src/postgres-init/85_citizen_report_idempotency.sql`** (new):
```sql
ALTER TABLE wims.citizen_reports ADD COLUMN client_report_id UUID;
CREATE UNIQUE INDEX idx_citizen_reports_client_id
  ON wims.citizen_reports(client_report_id)
  WHERE client_report_id IS NOT NULL;
```

**`src/backend/schemas/civilian.py`:**
- Add `client_report_id: str` (UUID) to `CivilianReportCreate`

**`src/backend/api/routes/civilian.py` — `submit_civilian_report`:**
- Parse `client_report_id` as UUID from request body (return 422 if invalid)
- Use atomic idempotency (same pattern as photo upload — no follow-up SELECT):
  ```python
  stmt = text("""
      INSERT INTO wims.citizen_reports (
          client_report_id, device_id, category, sub_category,
          location, safety_status, reporting_context, description,
          eyewitness_name, eyewitness_contact, previous_report_id,
          contributor_user_id, ...
      ) VALUES (
          :crid, :did, :cat, :sub, ...
      )
      ON CONFLICT (client_report_id) WHERE client_report_id IS NOT NULL
      DO NOTHING
      RETURNING report_id
  """)
  report_id = db.execute(stmt, params).scalar()
  if report_id is not None:
      return 201 Created with report_id
  # Duplicate — get existing report_id
  existing = db.execute(
      text("SELECT report_id FROM wims.citizen_reports WHERE client_report_id = :crid"),
      {'crid': client_report_id}
  ).scalar()
  return 200 OK with existing report_id
  ```
  Note: the SELECT here is safe because `citizen_reports` has a permissive RLS policy for public inserts (the `ANONYMOUS` role can read its own rows).

**`src/frontend/src/lib/api/civilian.ts`:**
- Generate `crypto.randomUUID()` client-side before each report submission
- Include `client_report_id` in the request body

**`src/frontend/src/lib/offlineStore.ts`:**
- The existing `localId` in the offline op payload serves as `client_report_id` — no new field needed. When `offlineSubmission` creates an op, the `localId` IS the client_report_id.
- When the sync engine replays, it sends `localId` as `client_report_id`.

### Startup-Apply Path for New Migrations

**`src/backend/main.py`:**
- Add `83_photo_exif_metadata.sql`, `84_photo_idempotency_key.sql`, and `85_citizen_report_idempotency.sql` to the `SQL_APPLY_LIST` that runs on startup (`main.py:157-175`). Same pattern as existing migration 82.
- Verify the list remains ordered (these run after 82).

---

## Frontend Changes

**`src/frontend/src/lib/offlinePhotoKey.ts`** (new):
```typescript
export async function getOrCreatePhotoKey(deviceId: string): Promise<CryptoKey>
```
- Uses `crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])`
- Key is **non-extractable** (`extractable: false`)
- Store the `CryptoKey` **directly** in `KEY_STORE` via IndexedDB structured clone:
  ```typescript
  // KEY_STORE supports structured clone — CryptoKey is cloneable
  await keyStore.put({ id: `photo-key:${deviceId}`, key: cryptoKey });
  ```
  IndexedDB's structured clone algorithm supports `CryptoKey` objects natively (they are `Transferable` and `StructuredCloneable` per the WebCrypto spec). No `exportKey`/`importKey` needed.
- On retrieval:
  ```typescript
  const record = await keyStore.get(`photo-key:${deviceId}`);
  return record?.key ?? null;
  ```
- On key loss (store cleared): all existing encrypted photos become undecryptable → `decryptPhotoBlob` catches `OperationError` → mark `permanentFailure = true`

**`src/frontend/src/lib/offlineStore.ts` — add `OFFLINE_PHOTOS_STORE` and `PHOTO_LINK_STORE` (DB_VERSION 6 → 7):**

Two new stores:

1. **`OFFLINE_PHOTOS_STORE`** — encrypted photo blobs:
```typescript
interface OfflinePhotoRecord {
  id: string;                       // UUID — primary key, used as client_photo_id
  encryptedBlob: ArrayBuffer;       // AES-256-GCM encrypted bytes
  encryptionIv: string;             // base64 IV (12 bytes = 16 chars)
  filename: string;                 // "photo_abc123.jpg"
  mimeType: string;                 // "image/jpeg"
  fileSizeBytes: number;
  width: number;
  height: number;
  parentLocalId: string | null;     // UUID linking to queued report's localId
  parentServerReportId: number | null; // server report_id, populated after sync
  deviceId: string;
  browserGps: {...} | null;
  exifGps: {...} | null;
  createdAt: string;
  retryCount: number;
  lastAttemptAt: number | null;
  permanentFailure: boolean;
}
```
Indexes: `by_device_pending` on `[deviceId, parentServerReportId]`, `by_parent_local` on `parentLocalId`.

2. **`PHOTO_LINK_STORE`** — durable `parentLocalId → serverReportId` mapping:
```typescript
interface PhotoLinkRecord {
  parentLocalId: string;            // UUID primary key
  serverReportId: number;
  createdAt: string;
}
```
This store is written **inside the report-sync transaction** (same IndexedDB transaction that deletes the JSON op). This ensures crash safety: if the app crashes after the server accepts the report but before the mapping is stored, the JSON op is NOT deleted from `PUBLIC_OPS_STORE`, so it will be replayed on next mount. If the mapping is written but the photo sync crashes, the `PHOTO_LINK_STORE` survives for the next mount to pick up.

Exported functions:
- `queueOfflinePhoto(input: OfflinePhotoInput): Promise<void>` — plaintext in, encrypts internally, stores record
- `getPendingPhotosForSync(deviceId): Promise<OfflinePhotoRecord[]>` — non-null `parentServerReportId`, no `permanentFailure`
- `getPhotosByParentLocalId(parentLocalId): Promise<OfflinePhotoRecord[]>`
- `storePhotoLink(parentLocalId, serverReportId): Promise<void>` — in `PHOTO_LINK_STORE`
- `getPhotoLinksByParentLocalIds(parentLocalIds: string[]): Promise<Map<string, number>>` — batch query for recovery
- `updatePhotoReportLink(photoId, serverReportId): Promise<void>` — set `parentServerReportId`
- `markPhotoUploaded(photoId): Promise<void>` — delete from store
- `markPhotoPermanentFailure(photoId): Promise<void>`
- `getPendingPhotoCount(deviceId): Promise<number>`
- `discardOrphanedPhotos(parentLocalId): Promise<void>` — delete records matching `parentLocalId`
- `removePendingPhoto(photoId): Promise<void>` — user-initiated removal
- `cleanupExpiredPhotos(): Promise<void>` — delete records >7 days old

**`src/frontend/src/lib/offlinePhotoKey.ts`** (new) — encrypt/decrypt helpers:
```typescript
export async function encryptPhotoBlob(
  blob: Blob, deviceId: string, photoId: string
): Promise<{ encrypted: ArrayBuffer; iv: string }>

export async function decryptPhotoBlob(
  encrypted: ArrayBuffer, iv: string, deviceId: string, photoId: string
): Promise<Blob>
```
- `encryptPhotoBlob`: get key from `getOrCreatePhotoKey`, generate random 12-byte IV via `crypto.getRandomValues(new Uint8Array(12))`, encode AAD as `new TextEncoder().encode('photo:' + photoId + ':' + deviceId)`, call `crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, blobBytes)`
- `decryptPhotoBlob`: get key, construct same AAD, call `crypto.subtle.decrypt`. On `OperationError` (wrong key, wrong IV, tampered ciphertext, wrong AAD): return null (caller marks permanentFailure)
- Both functions also accept `key?: CryptoKey` parameter to avoid repeated KEY_STORE reads when batching

**`src/frontend/src/components/civilian/PhotoUpload.tsx`:**
- Remove the early-return `offlineExplanation` block
- When offline:
  1. Run `handleFileSelect` normally (validate → extract EXIF → compress)
  2. After compression: call `queueOfflinePhoto(input)` with compressed blob + metadata
  3. Show "Saved offline — will upload when connected"
- New `pendingCount: number` prop: persistent badge "X photos waiting"
- Online path also passes EXIF data from Phase E state

**`src/frontend/src/app/page.tsx` — parentLocalId linking and crash recovery:**
- **Pre-allocate `parentLocalId`** on page mount (generate UUID, store in a ref). This is available before any photo or report is created. When a photo is queued offline, this `parentLocalId` is set on the photo record. When the report is submitted offline, the same `parentLocalId` is stored in the op payload.
- **After report sync succeeds** (inside `syncPublicOfflineOps`):
  1. Before deleting the JSON op, write `storePhotoLink(parentLocalId, serverReportId)` to `PHOTO_LINK_STORE`
  2. Then delete the JSON op
  3. Then query `OFFLINE_PHOTOS_STORE` for photos with matching `parentLocalId`, call `updatePhotoReportLink(photoId, serverReportId)`
- **Crash recovery on mount:**
  1. Query `PUBLIC_OPS_STORE` for ops with `syncStatus = 'synced'` — these have been sent to server but the post-sync mapping may not have completed
  2. For each synced op that has a `parentLocalId`, we should check if there are photos with that `parentLocalId` and null `parentServerReportId`
  3. Query `PHOTO_LINK_STORE` for matching link records
  4. If found, update the photo records
  5. The `syncedServerIds` map is also rebuilt from `PHOTO_LINK_STORE` on mount
- **On terminal submission failure (422 only):**
  - Call `discardOrphanedPhotos(parentLocalId)` — only photos for the specific failed report
  - 429, 408, 425, network: retryable, do not discard
- **User-initiated photo removal:** if user removes a pending photo before going online, call `removePendingPhoto(photoId)`

**`src/frontend/src/lib/civilianPhotoSync.ts`** (new):
```typescript
interface PhotoSyncResult {
  synced: number;
  duplicated: number;
  failed: number;
  keyLost: number;
}
export async function syncPendingPhotos(deviceId: string): Promise<PhotoSyncResult>
```
- Read pending photos via `getPendingPhotosForSync(deviceId)`
- For each:
  1. Decrypt: `await decryptPhotoBlob(encryptedBlob, iv, deviceId, id)`. On null (OperationError): `markPhotoPermanentFailure(id)`, increment `keyLost`, skip
  2. Create `new File([decrypted], filename, { type: mimeType })`
  3. Call `uploadCivilianReportPhoto(serverReportId, file, deviceId, browserGps, exifGps, clientPhotoId=id)`
  4. On 201 or `duplicate: true`: `markPhotoUploaded(id)`, increment `synced` or `duplicated`
  5. On `duplicate: false` (fresh upload): increment `synced`
  6. On 409 (should not happen — backend no longer returns 409 for idempotency): `markPhotoPermanentFailure(id)`, increment `failed`
  6. On retryable (408, 425, 429, any 5xx): increment `retryCount`, update `lastAttemptAt`. Delay = `min(2^retryCount * 1000, 30000)` ms with ±25% jitter. If `retryCount >= 5`: `markPhotoPermanentFailure(id)`, increment `failed`
  7. On other 4xx: `markPhotoPermanentFailure(id)`, increment `failed`

**`src/frontend/src/lib/syncEngine.ts` — extend `syncPublicOfflineOps`:**
- Remove JSON-only early return
- After JSON ops complete, call `syncPendingPhotos(deviceId)`
- Extend `SyncResult`:
  ```typescript
  interface SyncResult {
    synced: number;
    failed: number;
    errors: SyncError[];
    photoSynced: number;
    photoFailed: number;
    photoKeyLost: number;
  }
  ```

**`src/frontend/src/lib/usePublicAutoSync.ts`:**
- Mount trigger: also check `getPendingPhotoCount(deviceId)` — if >0, trigger `syncNow()` (1.5s)
- Badge: `getPendingPublicOpsCount + getPendingPhotoCount`
- Toast: extend to show photo counts

### Race Condition Handling

| Scenario | Handling |
|----------|----------|
| Photo queued, report sync succeeds, crash before photo mapping | `PHOTO_LINK_STORE` written in same transaction as JSON op deletion. If crash happens between deletion and photo mapping, the link store survives. On next mount, crash recovery queries `PHOTO_LINK_STORE` for any links not yet applied to photos. |
| Photo queued, report sync succeeds, crash before JSON op deletion | JSON op not deleted → replayed on next mount. Server handles duplicate via idempotency in the civilian report endpoint. The `parentLocalId` is the same, so the second sync produces the same `serverReportId` → `PHOTO_LINK_STORE` upsert is safe. |
| Server accepts report, response lost, client retries | Server civilian report endpoint should handle idempotent retry (out of scope for this plan — existing `localId` in JSON ops should already handle this). |
| Key store cleared (Safari eviction) | Encrypted photos undecryptable → `markPhotoPermanentFailure`. User sees "X photos could not be recovered." |
| Two tabs, same device | Each tab generates its own `parentLocalId` on mount. No cross-contamination. |

### Storage, Quota & Security

- AES-256-GCM overhead: 16 bytes tag + 12 bytes IV per photo
- Quota check: iterate `fileSizeBytes`, sum, warn if > 50MB
- Cleanup: `cleanupExpiredPhotos()` deletes all records >7 days (Safari eviction boundary)
- Null-parentLocalId cleanup: separate 24h sweep for records where `parentLocalId IS NULL` (captured but never attached to a report)
- GPS metadata (+ deviceId) stored plaintext in the record. Rationale: GPS is already sent as form fields during upload and stored in plaintext DB columns. The encrypted blob protects photo pixels (faces, license plates, surroundings). GPS coordinates are tied to a fire event, not a person, under the project's threat model. An explicit security-decision record should be filed before implementation (or encrypt GPS in the blob too if the decision goes the other way).

### Validation
- `npx vitest run src/lib/__tests__/offlineStore.test.ts` — v7 upgrade preserves v6, photo store CRUD, PHOTO_LINK_STORE, encryption round-trip
- `npx vitest run src/lib/__tests__/offlinePhotoKey.test.ts` — key generation (non-extractable), storage via structured clone, retrieval, loss recovery
- `npx vitest run src/lib/__tests__/civilianPhotoSync.test.ts` — sync, 409 dedup, retryable vs permanent, crash recovery
- `npx vitest run src/lib/__tests__/syncEngine.test.ts` — extended SyncResult, no early return
- `npx vitest run src/lib/__tests__/usePublicAutoSync.test.ts` — mount trigger with photos, badge
- `npx vitest run src/app/__tests__/page.test.tsx` — offline photo + parentLocalId + crash recovery
- Backend: `pytest tests/test_report_photos.py -q` — client_photo_id atomic upsert, device+report verification, 409 only on mismatch
- Backend: `pytest tests/integration/test_civilian_api.py -q` — no regression
- `npm run build` succeeds

---

## Task Summary

| Phase | Tasks | Files Changed/New | Risk | Depends On |
|-------|-------|-------------------|------|------------|
| A | Camera shortcut + toggle | `PhotoUpload.tsx` + test | Low | None |
| E | Client-side EXIF extraction | `photoExif.ts` (new), `package.json`, `civilian.ts`, `civilian.py`, `report_photos.py`, `83_photo_exif_provenance.sql` + tests | Low | A |
| B | Client-side compression | `photoCompression.ts` (new), `PhotoUpload.tsx` + tests | Medium | E |
| D | Offline photo queue | `offlineStore.ts`, `offlinePhotoKey.ts` (new), `civilianPhotoSync.ts` (new), `syncEngine.ts`, `usePublicAutoSync.ts`, `PhotoUpload.tsx`, `page.tsx`, `civilian.ts`, `civilian.py`, `report_photos.py`, `schemas/civilian.py`, `84_photo_idempotency_key.sql` (new), `85_citizen_report_idempotency.sql` (new), `main.py`, `offlineStore.ts` + tests | High | A, B |

**Execution order:** A → E → B → D (serial component integration; utilities/tests can be stubbed in parallel).

## Validation Gate

```bash
cd src/frontend
npx vitest run src/components/civilian/ src/lib/__tests__/photoCompression.test.ts src/lib/__tests__/photoExif.test.ts src/lib/__tests__/civilianPhotoSync.test.ts src/lib/__tests__/offlineStore.test.ts src/lib/__tests__/offlinePhotoKey.test.ts src/lib/__tests__/syncEngine.test.ts src/lib/__tests__/usePublicAutoSync.test.ts src/app/__tests__/page.test.tsx
npm run lint
NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth NEXT_PUBLIC_BASE_URL=http://localhost:3000 npm run build
```

```bash
cd src/backend
ruff check . && ruff format --check .
pytest tests/test_report_photos.py tests/integration/test_civilian_api.py -q
```

Output: all tests pass, 0 lint errors, production builds succeed.

## Wiki Updates

After implementation:
- `system-wiki/subsystems/civilian-reporting-phase2.md` — camera modes, EXIF-before-compression, offline queue with AES-GCM, client_photo_id idempotency
- `system-wiki/frontend/frontend-infrastructure.md` — photoExif, photoCompression, offlinePhotoKey, civilianPhotoSync, OFFLINE_PHOTOS_STORE, PHOTO_LINK_STORE
- `system-wiki/backend/api-route-map.md` — new exif_gps_* and client_photo_id form fields
- `system-wiki/log.md` — dated entry with file list and validation results
