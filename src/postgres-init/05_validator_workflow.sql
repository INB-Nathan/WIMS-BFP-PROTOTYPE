-- =============================================================================
-- Migration: 002_validator_workflow.sql
-- Purpose  : Implements the encoder → validator review workflow.
--
-- Changes
-- -------
--   1. Normalize wims.users role constraint to include NATIONAL_VALIDATOR
--      (was stored as 'VALIDATOR' in seed; application code expects 'NATIONAL_VALIDATOR').
--   2. Migrate any existing VALIDATOR rows to NATIONAL_VALIDATOR.
--   3. Ensure validator test user has an assigned_region_id (defaults to region 1).
--   4. Align fire_incidents verification_status CHECK to include PENDING_VALIDATION.
--   5. Create wims.incident_verification_history (audit trail).
--   6. Create RLS UPDATE policy: NATIONAL_VALIDATOR may only update incidents
--      in their assigned region.
--
-- Idempotent: safe to re-run.
-- Run via:
--   docker compose exec postgres psql -U postgres -d wims \
--     -f /docker-entrypoint-initdb.d/002_validator_workflow.sql
--   OR from project root:
--   docker compose exec -T postgres psql -U postgres -d wims \
--     < src/postgres-init/002_validator_workflow.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Normalize wims.users role CHECK constraint
--    The seed script used 'VALIDATOR'; application code uses 'NATIONAL_VALIDATOR'.
--    We drop and recreate the constraint to include both during the transition
--    window, then normalise existing data, then tighten if desired.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    -- Drop old constraint if it does not already include NATIONAL_VALIDATOR
    IF EXISTS (
        SELECT 1
        FROM   pg_constraint c
        JOIN   pg_namespace  n ON n.oid = c.connamespace
        WHERE  n.nspname = 'wims'
          AND  c.conname  = 'users_role_check'
          AND  pg_get_constraintdef(c.oid) NOT LIKE '%NATIONAL_VALIDATOR%'
    ) THEN
        ALTER TABLE wims.users DROP CONSTRAINT users_role_check;
        RAISE NOTICE 'Dropped old users_role_check (did not contain NATIONAL_VALIDATOR).';
    END IF;

    -- Re-add with full authoritative set (idempotent: only if absent)
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint c
        JOIN   pg_namespace  n ON n.oid = c.connamespace
        WHERE  n.nspname = 'wims'
          AND  c.conname  = 'users_role_check'
    ) THEN
        ALTER TABLE wims.users
            ADD CONSTRAINT users_role_check
            CHECK (role IN (
                'CIVILIAN_REPORTER',
                'REGIONAL_ENCODER',
                'VALIDATOR',            -- legacy seed value; kept for backwards compat
                'NATIONAL_VALIDATOR',   -- authoritative application value
                'NATIONAL_ANALYST',
                'ANALYST',              -- legacy alias
                'SYSTEM_ADMIN'
            ));
        RAISE NOTICE 'Created new users_role_check including NATIONAL_VALIDATOR.';
    END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 2. Migrate existing VALIDATOR rows → NATIONAL_VALIDATOR
-- ---------------------------------------------------------------------------

UPDATE wims.users
SET    role       = 'NATIONAL_VALIDATOR',
       updated_at = now()
WHERE  role = 'VALIDATOR';

-- Log how many rows were touched (visible in psql output)
DO $$
DECLARE
    n INT;
BEGIN
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'Migrated % user row(s) from VALIDATOR → NATIONAL_VALIDATOR.', n;
END $$;


-- ---------------------------------------------------------------------------
-- 3. Ensure validator_test user has an assigned_region_id
--    (seed-dev-users.sh leaves it NULL; our dependency requires a value).
--    Defaults to region_id = 1.  Skip if user does not exist yet.
-- ---------------------------------------------------------------------------

UPDATE wims.users
SET    assigned_region_id = COALESCE(assigned_region_id, 1),
       updated_at         = now()
WHERE  username   = 'validator_test'
  AND  role       = 'NATIONAL_VALIDATOR'
  AND  assigned_region_id IS NULL;


-- ---------------------------------------------------------------------------
-- 4. Align fire_incidents verification_status CHECK
--    DB must allow PENDING_VALIDATION (used by public DMZ route since day 1).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM   pg_constraint c
        JOIN   pg_namespace  n ON n.oid = c.connamespace
        WHERE  n.nspname = 'wims'
          AND  c.conname  = 'fire_incidents_verification_status_check'
          AND  pg_get_constraintdef(c.oid) NOT LIKE '%PENDING_VALIDATION%'
    ) THEN
        ALTER TABLE wims.fire_incidents
            DROP CONSTRAINT fire_incidents_verification_status_check;

        ALTER TABLE wims.fire_incidents
            ADD CONSTRAINT fire_incidents_verification_status_check
            CHECK (verification_status IN (
                'DRAFT',
                'PENDING',
                'PENDING_VALIDATION',
                'VERIFIED',
                'REJECTED'
            ));

        RAISE NOTICE 'Rebuilt fire_incidents_verification_status_check with PENDING_VALIDATION.';
    ELSE
        RAISE NOTICE 'fire_incidents_verification_status_check already up-to-date; skipped.';
    END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 5. Create wims.incident_verification_history
--    Append-only audit table — one row per validator decision.
--    Matches IncidentVerificationHistory ORM model exactly.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wims.incident_verification_history (
    history_id         SERIAL PRIMARY KEY,

    -- Which record was acted upon ('OFFICIAL' = fire_incidents, 'CIVILIAN' = citizen_reports)
    target_type        VARCHAR(16)  NOT NULL
                           CHECK (target_type IN ('OFFICIAL', 'CIVILIAN')),
    target_id          INTEGER      NOT NULL,

    -- Who made the decision (FK to wims.users; kept even if user is later deactivated)
    action_by_user_id  UUID         NOT NULL
                           REFERENCES wims.users(user_id) ON DELETE RESTRICT,

    -- Status transition
    previous_status    VARCHAR(32)  NOT NULL,
    new_status         VARCHAR(32)  NOT NULL,

    -- Optional free-text from the validator
    notes              TEXT,

    action_timestamp   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Backward-compat: upgrade legacy table shape if it already exists.
-- Legacy columns were: incident_id, comments (without target_type/target_id/notes).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'wims'
          AND table_name = 'incident_verification_history'
          AND column_name = 'incident_id'
    ) THEN
        ALTER TABLE wims.incident_verification_history
            ADD COLUMN IF NOT EXISTS target_type VARCHAR(16),
            ADD COLUMN IF NOT EXISTS target_id INTEGER,
            ADD COLUMN IF NOT EXISTS notes TEXT;

        UPDATE wims.incident_verification_history
        SET target_type = COALESCE(target_type, 'OFFICIAL'),
            target_id = COALESCE(target_id, incident_id),
            notes = COALESCE(notes, comments)
        WHERE target_type IS NULL OR target_id IS NULL OR notes IS NULL;

        ALTER TABLE wims.incident_verification_history
            ALTER COLUMN target_type SET NOT NULL,
            ALTER COLUMN target_id SET NOT NULL;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'wims'
              AND c.conname = 'incident_verification_history_target_type_check'
        ) THEN
            ALTER TABLE wims.incident_verification_history
                ADD CONSTRAINT incident_verification_history_target_type_check
                CHECK (target_type IN ('OFFICIAL', 'CIVILIAN'));
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'wims'
              AND c.conname = 'incident_verification_history_action_by_user_id_fkey'
        ) THEN
            ALTER TABLE wims.incident_verification_history
                ADD CONSTRAINT incident_verification_history_action_by_user_id_fkey
                FOREIGN KEY (action_by_user_id) REFERENCES wims.users(user_id) ON DELETE RESTRICT;
        END IF;
    END IF;
END $$;

COMMENT ON TABLE wims.incident_verification_history IS
    'Append-only audit trail. One row per NATIONAL_VALIDATOR decision. Never updated.';

-- Index: most common query is "show all decisions for incident X"
CREATE INDEX IF NOT EXISTS idx_ivh_target
    ON wims.incident_verification_history (target_type, target_id);

-- Index: "show all decisions by validator Y"
CREATE INDEX IF NOT EXISTS idx_ivh_action_by
    ON wims.incident_verification_history (action_by_user_id);


-- ---------------------------------------------------------------------------
-- 6. RLS UPDATE policy — NATIONAL_VALIDATOR, same region only
--
--    Requires Row Level Security to already be enabled on wims.fire_incidents
--    (assumed from existing schema).  Policy is additive — it does not replace
--    existing encoder or admin policies.
--
--    Logic:
--      The GUC wims.current_user_id is set by database.py set_rls_context().
--      We look up the current user's role and assigned_region_id from wims.users
--      and allow the UPDATE only when:
--        a) user is NATIONAL_VALIDATOR, AND
--        b) incident.region_id = user.assigned_region_id
--
--    SYSTEM_ADMIN bypass: SYSTEM_ADMIN rows are granted ALL on wims.fire_incidents
--    via a separate policy (assumed pre-existing from 01_wims_initial.sql).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    -- Drop and recreate so reruns are safe
    DROP POLICY IF EXISTS validator_update_own_region ON wims.fire_incidents;

    CREATE POLICY validator_update_own_region
        ON wims.fire_incidents
        AS PERMISSIVE
        FOR UPDATE
        TO PUBLIC   -- evaluated against the PostgreSQL session role, filtered by USING
        USING (
            -- Fast path: check current user's role and region in one sub-select
            EXISTS (
                SELECT 1
                FROM   wims.users u
                WHERE  u.user_id            = current_setting('wims.current_user_id', TRUE)::uuid
                  AND  u.role               = 'NATIONAL_VALIDATOR'
                  AND  u.assigned_region_id = wims.fire_incidents.region_id
                  AND  u.is_active          = TRUE
            )
        )
        WITH CHECK (
            -- Same condition on the new row values (prevents region_id reassignment)
            EXISTS (
                SELECT 1
                FROM   wims.users u
                WHERE  u.user_id            = current_setting('wims.current_user_id', TRUE)::uuid
                  AND  u.role               = 'NATIONAL_VALIDATOR'
                  AND  u.assigned_region_id = wims.fire_incidents.region_id
                  AND  u.is_active          = TRUE
            )
        );

    RAISE NOTICE 'Created RLS policy: validator_update_own_region on wims.fire_incidents.';
END $$;

-- Ensure RLS is enabled on fire_incidents (idempotent)
ALTER TABLE wims.fire_incidents ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Migration 002_validator_workflow complete ===';
    RAISE NOTICE '  users_role_check              — aligned';
    RAISE NOTICE '  VALIDATOR rows                — migrated to NATIONAL_VALIDATOR';
    RAISE NOTICE '  validator_test region         — assigned (region 1 if was NULL)';
    RAISE NOTICE '  fire_incidents status check   — includes PENDING_VALIDATION';
    RAISE NOTICE '  incident_verification_history — created (if not exists)';
    RAISE NOTICE '  validator_update_own_region   — RLS policy active';
END $$;

COMMIT;
