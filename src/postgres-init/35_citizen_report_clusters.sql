-- 35_citizen_report_clusters.sql
-- Civilian Reporting Phase 2 — Validator Cluster Workflow State
-- Dependencies: 05_citizen_reports.sql (citizen_reports must exist)
-- Idempotent: YES
--
-- Durable workflow state for validator clustering of related civilian reports.
-- Read-time PostGIS ST_DWithin remains the discovery/suggestion mechanism;
-- this table stores explicit validator decisions about membership and workflow.

BEGIN;

-- ─── citizen_report_clusters ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wims.citizen_report_clusters (
    cluster_id               SERIAL PRIMARY KEY,

    -- Anchor: highest-priority report that triggered/anchors this cluster
    anchor_report_id         INTEGER NOT NULL
        REFERENCES wims.citizen_reports(report_id)
        ON DELETE RESTRICT,

    -- Cluster workflow status
    status                   VARCHAR(32) NOT NULL DEFAULT 'CLUSTER_MONITORING' CHECK (
        status IN (
            'CLUSTER_MONITORING',
            'CLUSTER_UNDER_REVIEW',
            'CLUSTER_ACTIONED',
            'CLUSTER_CLOSED'
        )
    ),

    -- Civilian-visible note (shown on tracking page for related reports)
    status_note              TEXT,

    -- Validator-only operational note (never shown to civilians)
    internal_note            TEXT,

    -- Claim / lock metadata
    assigned_to              UUID REFERENCES wims.users(user_id),
    review_started_at        TIMESTAMPTZ,

    -- Timestamps
    created_at                TIMESTAMPTZ DEFAULT now(),
    updated_at                TIMESTAMPTZ DEFAULT now(),
    closed_at                 TIMESTAMPTZ,

    -- Merge tracking (when CLUSTER_CLOSED due to merge, record target)
    merged_into_cluster_id    INTEGER REFERENCES wims.citizen_report_clusters(cluster_id),

    -- Last actor
    acted_by                 UUID REFERENCES wims.users(user_id),

    CONSTRAINT chk_closed_requires_status
        CHECK (
            merged_into_cluster_id IS NULL
            OR status = 'CLUSTER_CLOSED'
        )
);

-- ─── citizen_report_cluster_members ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wims.citizen_report_cluster_members (
    cluster_id       INTEGER NOT NULL
        REFERENCES wims.citizen_report_clusters(cluster_id)
        ON DELETE CASCADE,
    report_id        INTEGER NOT NULL
        REFERENCES wims.citizen_reports(report_id)
        ON DELETE CASCADE,
    linked_by        UUID REFERENCES wims.users(user_id),
    created_at       TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (cluster_id, report_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clusters_location
    ON wims.citizen_report_clusters (anchor_report_id);

CREATE INDEX IF NOT EXISTS idx_clusters_status
    ON wims.citizen_report_clusters (status);

CREATE INDEX IF NOT EXISTS idx_clusters_assigned
    ON wims.citizen_report_clusters (assigned_to)
    WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clusters_created
    ON wims.citizen_report_clusters (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster
    ON wims.citizen_report_cluster_members (cluster_id);

CREATE INDEX IF NOT EXISTS idx_cluster_members_report
    ON wims.citizen_report_cluster_members (report_id);

COMMIT;