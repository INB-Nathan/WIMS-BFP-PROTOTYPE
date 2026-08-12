-- 81_civilian_routing_columns.sql
-- Civilian Contributor Enhancement — routing data columns and contributor/session
-- foreign keys on citizen_reports. Also tightens the ANONYMOUS SELECT policy.
-- See design spec §4.3, §12.1, §12.5.
-- Dependencies: 05_citizen_reports.sql, 80_civilian_contributor_tables.sql
-- Idempotent: YES

BEGIN;

-- ── Routing columns ──────────────────────────────────────────────────────────
-- OSRM or PostGIS-fallback distance/duration computed after report submission.
-- See spec §4.3 for column-level semantics.
ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_distance_m       FLOAT;
ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_duration_s       FLOAT;
ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_data_source      TEXT;
ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_execution_path   TEXT;
ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_candidate_count   INTEGER;
ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_updated_at       TIMESTAMPTZ;
ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS routing_geometry geometry(LineString, 4326);
COMMENT ON COLUMN wims.citizen_reports.routing_geometry IS
    'OSRM road-network route geometry (GeoJSON LineString stored as PostGIS geometry). NULL when OSRM unavailable or fallback routing used.';

-- ── Contributor / anonymous session FK columns ───────────────────────────────
-- contributor_user_id is NULL for unclaimed anonymous reports.
-- anonymous_session_id remains for ownership/audit even after claim.
ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS contributor_user_id      UUID REFERENCES wims.users(user_id);
ALTER TABLE wims.citizen_reports ADD COLUMN IF NOT EXISTS anonymous_session_id     UUID REFERENCES wims.anonymous_sessions(anonymous_session_id);

-- Indexes for contributor and session lookups (selective, for common query patterns).
CREATE INDEX IF NOT EXISTS idx_citizen_reports_contributor
    ON wims.citizen_reports(contributor_user_id)
    WHERE contributor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_citizen_reports_anonymous_session
    ON wims.citizen_reports(anonymous_session_id)
    WHERE anonymous_session_id IS NOT NULL;

-- ── RLS: tighten citizen_reports_select for ANONYMOUS ───────────────────────
-- Before registered contributor rollout, the ANONYMOUS sentinel role could
-- select ALL rows indiscriminately. Now that contributor_user_id may be set,
-- anonymous/no-GUC access must NOT read rows linked to a registered contributor.
-- The application-layer tracking-token endpoint still validates by token hash
-- and returns neutral 404 on failure (spec §12.5).
DROP POLICY IF EXISTS citizen_reports_select ON wims.citizen_reports;
CREATE POLICY citizen_reports_select
ON wims.citizen_reports FOR SELECT USING (
    wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_VALIDATOR')
    OR (
        wims.current_user_role() = 'ANONYMOUS'
        AND contributor_user_id IS NULL
    )
);

COMMIT;