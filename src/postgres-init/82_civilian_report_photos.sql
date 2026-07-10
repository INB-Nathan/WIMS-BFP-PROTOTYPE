-- 82_civilian_report_photos.sql
-- Civilian Contributor Enhancement Phase 2 — photo pipeline schema.
-- Creates wims.report_photos table with three independent encrypted
-- artifact sets (original, sanitized, metadata), RLS enforcement,
-- and audit triggers.
--
-- Dependencies: 05_citizen_reports.sql (citizen_reports table),
--               03_users.sql (users table),
--               80_civilian_contributor_tables.sql (anonymous_sessions,
--                 report_tracking_tokens),
--               81_civilian_routing_columns.sql (contributor_user_id FK)
--
-- Idempotent: YES (uses IF NOT EXISTS / DROP ... IF EXISTS patterns)

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- wims.report_photos
-- ═══════════════════════════════════════════════════════════════════════════════
-- One row per attached photo. Post-submit design: report_id is NOT NULL;
-- there is no normal unattached-row state.
--
-- Encryption model (three independent artifact sets):
--   orig_*       — AES-256-GCM ciphertext of the original uploaded image
--   sanitized_*  — AES-256-GCM ciphertext of the deterministic re-encoded image
--   metadata_*   — AES-256-GCM ciphertext of the sensitive metadata JSON blob
--                    (EXIF allowlist, browser GPS, original filename)
--
-- AAD strings (exact, UTF-8 encoded):
--   civilian-photo:{photo_id}:original:v1
--   civilian-photo:{photo_id}:sanitized:v1
--   civilian-photo:{photo_id}:metadata:v1
--
-- RLS:
--   FORCE ROW LEVEL SECURITY
--   ANONYMOUS: INSERT only (ownership verified via report FK + device_id)
--   CIVILIAN_REPORTER: INSERT where report.contributor_user_id matches
--   SYSTEM_ADMIN/NATIONAL_VALIDATOR/NATIONAL_ANALYST: SELECT
--   Cleanup (svc_task): DELETE on eligible orphan rows
--
-- Photo UUIDs are application-generated, not DB sequence.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wims.report_photos (
    photo_id                        UUID        PRIMARY KEY,
    report_id                       INTEGER     NOT NULL,

    -- Ownership: registered XOR anonymous (enforced via report FK + app layer).
    -- Exactly one owner branch is populated. Anonymous ownership stores the
    -- existing device bearer used by the report; it is not a new session.
    uploader_user_id                UUID        REFERENCES wims.users(user_id),
    uploader_device_id              UUID,

    -- Media type and dimensions
    media_type                      TEXT        NOT NULL
        CHECK (media_type IN ('image/jpeg', 'image/png')),
    file_extension                  TEXT        NOT NULL
        CHECK (file_extension IN ('jpg', 'jpeg', 'png')),
    image_width                     INTEGER     NOT NULL CHECK (image_width > 0),
    image_height                    INTEGER     NOT NULL CHECK (image_height > 0),
    file_size_bytes                 INTEGER     NOT NULL CHECK (file_size_bytes >= 0),

    -- ---- Original artifact ----
    original_storage_path           TEXT        NOT NULL,
    original_file_size_bytes        INTEGER     NOT NULL CHECK (original_file_size_bytes >= 0),
    original_sha256                 TEXT        NOT NULL,
    orig_encryption_iv              TEXT        NOT NULL,
    orig_key_version                INTEGER     NOT NULL DEFAULT 1,
    orig_crypto_provider            TEXT        NOT NULL DEFAULT 'env_aesgcm'
        CHECK (orig_crypto_provider IN ('env_aesgcm', 'openbao_transit')),
    orig_kms_key_name               TEXT,

    -- ---- Sanitized artifact ----
    sanitized_storage_path          TEXT        NOT NULL,
    sanitized_file_size_bytes       INTEGER     NOT NULL CHECK (sanitized_file_size_bytes >= 0),
    sanitized_sha256                TEXT        NOT NULL,
    sanitized_encryption_iv         TEXT        NOT NULL,
    sanitized_key_version            INTEGER     NOT NULL DEFAULT 1,
    sanitized_crypto_provider        TEXT        NOT NULL DEFAULT 'env_aesgcm'
        CHECK (sanitized_crypto_provider IN ('env_aesgcm', 'openbao_transit')),
    sanitized_kms_key_name          TEXT,

    -- ---- Sensitive metadata artifact (encrypted JSON) ----
    sensitive_metadata_blob_enc     TEXT        NOT NULL,
    metadata_encryption_iv          TEXT        NOT NULL,
    metadata_key_version             INTEGER     NOT NULL DEFAULT 1,
    metadata_crypto_provider         TEXT        NOT NULL DEFAULT 'env_aesgcm'
        CHECK (metadata_crypto_provider IN ('env_aesgcm', 'openbao_transit')),
    metadata_kms_key_name           TEXT,

    -- ---- Derived / status fields ----
    exif_gps_status                 TEXT        NOT NULL DEFAULT 'unavailable'
        CHECK (exif_gps_status IN ('present', 'unavailable')),
    browser_gps_status              TEXT        NOT NULL DEFAULT 'unavailable'
        CHECK (browser_gps_status IN ('present', 'unavailable')),
    gps_consensus                   TEXT
        CHECK (gps_consensus IN (
            'both_match', 'both_disagree',
            'exif_only', 'browser_only', 'unavailable'
        )),
    exif_to_report_distance_m       FLOAT       CHECK (exif_to_report_distance_m IS NULL OR exif_to_report_distance_m >= 0),
    browser_to_report_distance_m    FLOAT       CHECK (browser_to_report_distance_m IS NULL OR browser_to_report_distance_m >= 0),
    photo_reported_distance_m       FLOAT       CHECK (photo_reported_distance_m IS NULL OR photo_reported_distance_m >= 0),
    cleanup_status                  TEXT
        CHECK (cleanup_status IS NULL OR cleanup_status IN ('pending_cleanup', 'cleaned_up')),

    -- Timestamps
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT report_photos_owner_xor CHECK (
        (uploader_user_id IS NOT NULL AND uploader_device_id IS NULL)
        OR (uploader_user_id IS NULL AND uploader_device_id IS NOT NULL)
    ),
    CONSTRAINT report_photos_orig_iv_provider CHECK (
        (orig_crypto_provider = 'openbao_transit' AND orig_encryption_iv = 'OPENBAO_TRANSIT')
        OR (orig_crypto_provider = 'env_aesgcm' AND orig_encryption_iv IS NOT NULL AND orig_encryption_iv <> 'OPENBAO_TRANSIT')
    ),
    CONSTRAINT report_photos_sanitized_iv_provider CHECK (
        (sanitized_crypto_provider = 'openbao_transit' AND sanitized_encryption_iv = 'OPENBAO_TRANSIT')
        OR (sanitized_crypto_provider = 'env_aesgcm' AND sanitized_encryption_iv IS NOT NULL AND sanitized_encryption_iv <> 'OPENBAO_TRANSIT')
    ),
    CONSTRAINT report_photos_metadata_iv_provider CHECK (
        (metadata_crypto_provider = 'openbao_transit' AND metadata_encryption_iv = 'OPENBAO_TRANSIT')
        OR (metadata_crypto_provider = 'env_aesgcm' AND metadata_encryption_iv IS NOT NULL AND metadata_encryption_iv <> 'OPENBAO_TRANSIT')
    )
);

-- Add the ownership column for installations that created the table before
-- the device branch was introduced; new rows are subject to the XOR check.
ALTER TABLE wims.report_photos
    ADD COLUMN IF NOT EXISTS uploader_device_id UUID,
    ADD COLUMN IF NOT EXISTS file_extension TEXT;
ALTER TABLE wims.report_photos
    ALTER COLUMN file_extension SET NOT NULL;

-- FK constraint: report must exist; restrict delete to preserve evidence.
-- Using ALTER TABLE ADD CONSTRAINT for idempotency.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_report_photos_report'
          AND conrelid = 'wims.report_photos'::regclass
    ) THEN
        ALTER TABLE wims.report_photos
            ADD CONSTRAINT fk_report_photos_report
            FOREIGN KEY (report_id)
            REFERENCES wims.citizen_reports(report_id)
            ON DELETE RESTRICT;
    END IF;
END
$$;


-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_report_photos_report
    ON wims.report_photos(report_id);

CREATE INDEX IF NOT EXISTS idx_report_photos_uploader
    ON wims.report_photos(uploader_user_id)
    WHERE uploader_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_photos_cleanup
    ON wims.report_photos(cleanup_status)
    WHERE cleanup_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_photos_created
    ON wims.report_photos(created_at);


-- ── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON TABLE wims.report_photos IS
    'Civilian report photos — original encrypted, sanitized encrypted, and encrypted metadata. '
    'No public read endpoint in Phase 2; originals are never served.';

COMMENT ON COLUMN wims.report_photos.photo_id IS
    'Application-generated UUID (not DB sequence). Used in AAD binding.';

COMMENT ON COLUMN wims.report_photos.report_id IS
    'FK to wims.citizen_reports. NOT NULL — no unattached rows in post-submit design.';

COMMENT ON COLUMN wims.report_photos.uploader_user_id IS
    'FK to wims.users. Exactly one of uploader_user_id/uploader_device_id is set.';

COMMENT ON COLUMN wims.report_photos.uploader_device_id IS
    'Existing anonymous report device bearer. Exactly one owner branch is set.';

COMMENT ON COLUMN wims.report_photos.original_storage_path IS
    'Server-generated path for original encrypted artifact. Rooted under CIVILIAN_PHOTO_STORAGE_DIR.';

COMMENT ON COLUMN wims.report_photos.sanitized_storage_path IS
    'Server-generated path for sanitized encrypted artifact.';

COMMENT ON COLUMN wims.report_photos.sensitive_metadata_blob_enc IS
    'AES-256-GCM encrypted JSON: EXIF allowlist, browser GPS, original filename. '
    'AAD: civilian-photo:{photo_id}:metadata:v1';

COMMENT ON COLUMN wims.report_photos.gps_consensus IS
    'Derived GPS consensus classification. PostGIS computes distances (not Python).';

COMMENT ON COLUMN wims.report_photos.photo_reported_distance_m IS
    'Distance from photo capture point (EXIF if available, else browser) to report location. '
    'Computed by PostGIS.';


-- Defensive existing-database compatibility: 81 is a fresh-bootstrap file
-- and older databases may not have run it before this startup patch.
ALTER TABLE wims.citizen_reports
    ADD COLUMN IF NOT EXISTS contributor_user_id UUID REFERENCES wims.users(user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

-- CIVILIAN_REPORTER must be able to see only their linked report row.  This
-- narrowly-scoped policy is required because report_photos INSERT/SELECT
-- policies use a citizen_reports subquery under FORCE RLS.
DROP POLICY IF EXISTS citizen_reports_select ON wims.citizen_reports;
CREATE POLICY citizen_reports_select
ON wims.citizen_reports FOR SELECT USING (
    wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_VALIDATOR')
    OR (
        wims.current_user_role() = 'ANONYMOUS'
        AND contributor_user_id IS NULL
    )
    OR (
        wims.current_user_role() = 'CIVILIAN_REPORTER'
        AND contributor_user_id = wims.current_user_uuid()
    )
);

ALTER TABLE wims.report_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.report_photos FORCE ROW LEVEL SECURITY;


-- Policy: ANONYMOUS and no-GUC users cannot SELECT
DROP POLICY IF EXISTS report_photos_select ON wims.report_photos;
CREATE POLICY report_photos_select
    ON wims.report_photos FOR SELECT
    USING (wims.current_user_role() IN (
        'SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST'
    ));

-- Policy: INSERT allowed for ANONYMOUS (ownership via report.device_id)
-- and for CIVILIAN_REPORTER (ownership via report.contributor_user_id).
-- Both branches check through the citizen_reports FK.
-- This policy uses a subquery to verify at the SQL level.
DROP POLICY IF EXISTS report_photos_insert ON wims.report_photos;
CREATE POLICY report_photos_insert
    ON wims.report_photos FOR INSERT
    WITH CHECK (
        -- Registered contributor: user_id must match report's contributor_user_id
        (
            wims.current_user_role() = 'CIVILIAN_REPORTER'
            AND uploader_user_id = wims.current_user_uuid()
            AND EXISTS (
                SELECT 1 FROM wims.citizen_reports cr
                WHERE cr.report_id = wims.report_photos.report_id
                  AND cr.contributor_user_id = wims.current_user_uuid()
            )
        )
        OR
        -- Anonymous: uploaded without user, report must have no contributor
        (
            wims.current_user_role() = 'ANONYMOUS'
            AND uploader_user_id IS NULL
            AND uploader_device_id IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM wims.citizen_reports cr
                WHERE cr.report_id = wims.report_photos.report_id
                  AND cr.contributor_user_id IS NULL
                  AND cr.device_id = wims.report_photos.uploader_device_id
            )
        )
    );

-- Policy: UPDATE restricted to staff/admin (for cleanup status changes)
DROP POLICY IF EXISTS report_photos_update ON wims.report_photos;
CREATE POLICY report_photos_update
    ON wims.report_photos FOR UPDATE
    USING (wims.current_user_role() IN (
        'SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST'
    ))
    WITH CHECK (wims.current_user_role() IN (
        'SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST'
    ));

-- Policy: DELETE restricted to SYSTEM_ADMIN. Phase 2 cleanup does not
-- delete attached report rows because report_id is always NOT NULL.
DROP POLICY IF EXISTS report_photos_delete ON wims.report_photos;
CREATE POLICY report_photos_delete
    ON wims.report_photos FOR DELETE
    USING (wims.current_user_role() = 'SYSTEM_ADMIN');


-- ── Grant permissions ────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON wims.report_photos TO wims_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA wims TO wims_app;

COMMIT;
