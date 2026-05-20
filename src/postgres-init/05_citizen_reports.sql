-- 05_citizen_reports.sql
-- Civilian Reporting Phase 2 — structured public signal records
-- Dependencies: 01_wims_initial.sql (wims schema), 03_seed_reference.sql (ref_regions exists), 04_import_incidents.sql (fire_incidents exists), 03_users.sql (users exists)
-- Idempotent: YES
--
-- Civilian reports are PUBLIC SIGNAL RECORDS, not official fire_incidents.
-- Official incident creation remains part of the regional/fire-station AFOR workflow.
-- This table replaces the original free-text description schema with structured fields,
-- expanded terminal statuses, cluster workflow state, and audit trail support.

BEGIN;

-- ─── citizen_reports ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wims.citizen_reports (
    report_id              SERIAL PRIMARY KEY,
    location               GEOGRAPHY(POINT, 4326) NOT NULL,

    -- Structured report content (replaces free-text description)
    category               VARCHAR(32) NOT NULL CHECK (
        category IN ('STRUCTURAL', 'NON_STRUCTURAL', 'TRANSPORTATION', 'UNSURE')
    ),
    sub_category           VARCHAR(120),

    -- Reporting context and safety signal
    reporting_context      VARCHAR(32) NOT NULL DEFAULT 'WITNESS' CHECK (
        reporting_context IN ('WITNESS', 'NEARBY', 'SECONDHAND')
    ),
    safety_status          VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN' CHECK (
        safety_status IN ('I_AM_SAFE', 'I_NEED_HELP', 'SOMEONE_ELSE_NEEDS_HELP', 'UNKNOWN')
    ),

    -- Witness fields (direct eyewitness, not reporter for SECONDHAND)
    witness_name           VARCHAR(160),
    witness_phone          VARCHAR(80),

    -- Reporter device and network signals (privacy-safe, rate-limiting only)
    device_id              UUID,
    ip_hash                TEXT,

    -- Timing
    reported_at            TIMESTAMPTZ,          -- civilian's observed time
    created_at             TIMESTAMPTZ DEFAULT now(),

    -- Trust and severity
    trust_score            INTEGER DEFAULT 0 CHECK (trust_score >= 0 AND trust_score <= 100),

    -- Geography resolution
    region_id              INTEGER REFERENCES wims.ref_regions(region_id),
    nearest_station_id     INTEGER,  -- FK resolved after ref_fire_stations via 05b_citizen_reports_station_fk.sql

    -- Row status (terminal states block append; new reports reference via previous_report_id)
    status                 VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (
        status IN (
            'PENDING',
            'UNDER_REVIEW',
            'LINKED',
            'ACTIONED',
            'REJECTED_BOGUS',
            'REJECTED_DUPLICATE',
            'REJECTED_INSUFFICIENT',
            'REJECTED_TIMEOUT'
        )
    ),
    status_explanation     TEXT,                 -- civilian-visible; required for ACTIONED / REJECTED_*

    -- Internal validator note (never shown to civilians)
    internal_note          TEXT,

    -- Append chain (child reports link to parent; increments parent link_count)
    linked_to_report_id    INTEGER REFERENCES wims.citizen_reports(report_id),
    link_count             INTEGER DEFAULT 0,

    -- Previous report reference (historical context; does NOT reopen/mutate the old report)
    previous_report_id     INTEGER REFERENCES wims.citizen_reports(report_id),

    -- Submission metadata
    reported_via           VARCHAR(16) DEFAULT 'WEB' CHECK (
        reported_via IN ('WEB', 'MOBILE_APP', 'API')
    ),
    phone_latitude        FLOAT,
    phone_longitude       FLOAT,
    gps_distance_m        FLOAT,                -- distance between GPS coords and pinned location
    gps_warning_confirmed BOOLEAN DEFAULT FALSE,

    -- Source URL for analytics only
    source_url            TEXT,

    -- Audit trail
    validated_by           UUID REFERENCES wims.users(user_id),
    verified_incident_id  INTEGER REFERENCES wims.fire_incidents(incident_id),  -- legacy promotion path; deprecated in Phase 2

    CONSTRAINT chk_actioned_requires_validator
        CHECK (status != 'ACTIONED' OR validated_by IS NOT NULL)

    -- CONSTRAINT chk_status_explanation_required
    --     CHECK (
    --         status NOT IN ('ACTIONED', 'REJECTED_BOGUS', 'REJECTED_DUPLICATE', 'REJECTED_INSUFFICIENT', 'REJECTED_TIMEOUT')
    --         OR status_explanation IS NOT NULL
    --     )
    -- NOTE: constraint commented out to allow NULL during initial bootstrap seeding.
    -- Re-enable via a migration AFTER seed data has been backfilled with explanations.
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_citizen_reports_location
    ON wims.citizen_reports USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_citizen_reports_status
    ON wims.citizen_reports (status);

CREATE INDEX IF NOT EXISTS idx_citizen_reports_device
    ON wims.citizen_reports (device_id)
    WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_citizen_reports_linked_to
    ON wims.citizen_reports (linked_to_report_id)
    WHERE linked_to_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_citizen_reports_previous
    ON wims.citizen_reports (previous_report_id)
    WHERE previous_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_citizen_reports_created
    ON wims.citizen_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citizen_reports_nearest_station
    ON wims.citizen_reports (nearest_station_id)
    WHERE nearest_station_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_citizen_reports_region
    ON wims.citizen_reports (region_id)
    WHERE region_id IS NOT NULL;

-- ─── citizen_report_clusters ──────────────────────────────────────────────────
-- Durable cluster workflow state; PostGIS ST_DWithin at read time is still used
-- for discovering suggested related reports, but human actions are stored here.
CREATE TABLE IF NOT EXISTS wims.citizen_report_clusters (
    cluster_id           SERIAL PRIMARY KEY,
    anchor_report_id     INTEGER NOT NULL REFERENCES wims.citizen_reports(report_id),

    -- Workflow status
    status               VARCHAR(32) NOT NULL DEFAULT 'CLUSTER_MONITORING' CHECK (
        status IN (
            'CLUSTER_MONITORING',
            'CLUSTER_UNDER_REVIEW',
            'CLUSTER_ACTIONED',
            'CLUSTER_CLOSED'
        )
    ),
    status_note          TEXT,                                    -- civilian-visible note
    internal_note        TEXT,                                    -- validator-only operational note

    -- Claim/lock metadata
    acted_by             UUID REFERENCES wims.users(user_id),
    assigned_to          UUID REFERENCES wims.users(user_id),
    review_started_at    TIMESTAMPTZ,

    -- Timestamps
    created_at           TIMESTAMPTZ DEFAULT now(),
    updated_at           TIMESTAMPTZ DEFAULT now(),
    closed_at            TIMESTAMPTZ,

    -- Merge tracking
    merged_into_cluster_id  INTEGER REFERENCES wims.citizen_report_clusters(cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_clusters_anchor
    ON wims.citizen_report_clusters (anchor_report_id);

CREATE INDEX IF NOT EXISTS idx_clusters_status
    ON wims.citizen_report_clusters (status);

CREATE INDEX IF NOT EXISTS idx_clusters_assigned
    ON wims.citizen_report_clusters (assigned_to)
    WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clusters_merged
    ON wims.citizen_report_clusters (merged_into_cluster_id)
    WHERE merged_into_cluster_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clusters_created
    ON wims.citizen_report_clusters (created_at DESC);

-- ─── citizen_report_cluster_members ────────────────────────────────────────────
-- Explicit validator-selected membership (distinct from computed suggested reports)
CREATE TABLE IF NOT EXISTS wims.citizen_report_cluster_members (
    cluster_id        INTEGER NOT NULL REFERENCES wims.citizen_report_clusters(cluster_id),
    report_id         INTEGER NOT NULL REFERENCES wims.citizen_reports(report_id),
    linked_by         UUID REFERENCES wims.users(user_id),
    created_at        TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (cluster_id, report_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_members_report
    ON wims.citizen_report_cluster_members (report_id);

-- ─── report_notification_tokens ─────────────────────────────────────────────────
-- FCM push notification token registry (created here so FK dependency is satisfied)
CREATE TABLE IF NOT EXISTS wims.report_notification_tokens (
    token_id   SERIAL PRIMARY KEY,
    report_id  INTEGER NOT NULL REFERENCES wims.citizen_reports(report_id) ON DELETE CASCADE,
    fcm_token  TEXT    NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_report_notification_token
        UNIQUE (report_id, fcm_token)
);

CREATE INDEX IF NOT EXISTS idx_notification_tokens_report
    ON wims.report_notification_tokens (report_id);

COMMIT;
