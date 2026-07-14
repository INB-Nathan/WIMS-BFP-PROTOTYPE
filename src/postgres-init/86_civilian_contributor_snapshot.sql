-- 86_civilian_contributor_snapshot.sql
-- Civilian Contributor trust-score snapshot schema cleanup.
--
-- Files 80-85 do not create wims.civilian_contributors; the table was
-- previously created only by Alembic revision 0006.  This file therefore
-- carries the canonical table definition as well as the 0007 cleanup so a
-- clean Docker volume and an Alembic-upgraded database converge.
--
-- The snapshot records the service formula version.  The retired public
-- leaderboard opt-in flag is intentionally absent from the active schema.
-- Dependencies: 03_users.sql, 80_civilian_contributor_tables.sql,
--               82_civilian_report_photos.sql
-- Idempotent: YES

BEGIN;

-- The CREATE is required for clean-volume bootstrap parity.  On a database
-- already upgraded through 0006 it is a no-op and the ALTER statements below
-- converge the existing table without changing its RLS boundary.
CREATE TABLE IF NOT EXISTS wims.civilian_contributors (
    user_id          UUID        NOT NULL PRIMARY KEY
                     REFERENCES wims.users(user_id)
                     ON DELETE CASCADE,
    trust_score      INTEGER     NOT NULL DEFAULT 0
                     CHECK (trust_score >= 0 AND trust_score <= 100),
    badge            TEXT        NOT NULL DEFAULT 'NOVICE'
                     CHECK (badge IN ('NOVICE', 'REGULAR', 'TRUSTED', 'GUARDIAN')),
    formula_version  TEXT        NOT NULL DEFAULT 'reliability-v1',
    dpa_consented_at TIMESTAMPTZ DEFAULT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE wims.civilian_contributors
    ADD COLUMN IF NOT EXISTS formula_version TEXT;
ALTER TABLE wims.civilian_contributors
    ALTER COLUMN formula_version SET DEFAULT 'reliability-v1';
UPDATE wims.civilian_contributors
SET formula_version = 'reliability-v1'
WHERE formula_version IS NULL;
ALTER TABLE wims.civilian_contributors
    ALTER COLUMN formula_version SET NOT NULL;
ALTER TABLE wims.civilian_contributors
    DROP COLUMN IF EXISTS opt_in_leaderboard;

-- 0015: DPA consent timestamp
ALTER TABLE wims.civilian_contributors
    ADD COLUMN IF NOT EXISTS dpa_consented_at TIMESTAMPTZ DEFAULT NULL;

-- Preserve the 0006 RLS contract on both fresh and upgraded databases.
ALTER TABLE wims.civilian_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.civilian_contributors FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS civilian_contributors_select ON wims.civilian_contributors;
CREATE POLICY civilian_contributors_select
    ON wims.civilian_contributors FOR SELECT
    USING (
        wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST')
        OR wims.current_user_role() = 'CIVILIAN_REPORTER'
    );

DROP POLICY IF EXISTS civilian_contributors_insert ON wims.civilian_contributors;
CREATE POLICY civilian_contributors_insert
    ON wims.civilian_contributors FOR INSERT
    WITH CHECK (wims.current_user_role() = 'CIVILIAN_REPORTER');

DROP POLICY IF EXISTS civilian_contributors_update ON wims.civilian_contributors;
CREATE POLICY civilian_contributors_update
    ON wims.civilian_contributors FOR UPDATE
    USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'CIVILIAN_REPORTER'))
    WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN', 'CIVILIAN_REPORTER'));

DROP POLICY IF EXISTS civilian_contributors_delete ON wims.civilian_contributors;
CREATE POLICY civilian_contributors_delete
    ON wims.civilian_contributors FOR DELETE
    USING (wims.current_user_role() = 'SYSTEM_ADMIN');

GRANT SELECT, INSERT, UPDATE, DELETE ON wims.civilian_contributors TO wims_app;

-- Keep the trust-score photo aggregation helper available on clean volumes;
-- this is the same SECURITY DEFINER function installed by revision 0006.
CREATE OR REPLACE FUNCTION wims.photo_bonus_for_report(
    p_report_id INTEGER
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = wims, pg_temp
AS $$
    WITH photo_stats AS (
        SELECT
            COUNT(*) FILTER (WHERE gps_consensus = 'both_match') AS agreed_photo_count,
            BOOL_OR(
                photo_reported_distance_m IS NOT NULL
                AND photo_reported_distance_m < 50
            ) AS has_close_photo
        FROM wims.report_photos
        WHERE report_id = p_report_id
    )
    SELECT
        (agreed_photo_count * 2)
        + CASE WHEN has_close_photo THEN 1 ELSE 0 END
    FROM photo_stats
$$;

REVOKE ALL ON FUNCTION wims.photo_bonus_for_report(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wims.photo_bonus_for_report(INTEGER) TO wims_app;

COMMIT;
