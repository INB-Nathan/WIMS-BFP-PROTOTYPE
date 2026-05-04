-- =============================================================================
-- Migration: 17_cross_region_validator.sql
-- Purpose  : M4-F — Replace region-scoped validator UPDATE policy with
--            cross-region policy. NATIONAL_VALIDATOR may now act on incidents
--            from any region.
-- =============================================================================

BEGIN;

-- Drop the old region-scoped policy from 15_validator_workflow.sql
DROP POLICY IF EXISTS validator_update_own_region ON wims.fire_incidents;

-- Create the new cross-region policy
DROP POLICY IF EXISTS validator_cross_region_update ON wims.fire_incidents;
CREATE POLICY validator_cross_region_update
    ON wims.fire_incidents
    AS PERMISSIVE
    FOR UPDATE
    TO PUBLIC
    USING (
        EXISTS (
            SELECT 1 FROM wims.users u
            WHERE u.user_id = current_setting('wims.current_user_id', TRUE)::uuid
              AND u.role = 'NATIONAL_VALIDATOR'
              AND u.is_active = TRUE
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM wims.users u
            WHERE u.user_id = current_setting('wims.current_user_id', TRUE)::uuid
              AND u.role = 'NATIONAL_VALIDATOR'
              AND u.is_active = TRUE
        )
    );

COMMENT ON POLICY validator_cross_region_update ON wims.fire_incidents IS
    'NATIONAL_VALIDATOR may UPDATE any incident across all regions (M4-F cross-region authority).';

ALTER TABLE wims.fire_incidents ENABLE ROW LEVEL SECURITY;

COMMIT;
