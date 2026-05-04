-- =============================================================================
-- Migration: 18_submitted_snapshot.sql
-- Purpose  : M4-G — Add submitted_snapshot column to fire_incidents.
--            Stores a JSONB snapshot of incident_nonsensitive_details at the
--            first PENDING transition. Written once, never updated.
--            Validators read this to compute a diff vs the current state.
-- =============================================================================

ALTER TABLE wims.fire_incidents
    ADD COLUMN IF NOT EXISTS submitted_snapshot JSONB;

COMMENT ON COLUMN wims.fire_incidents.submitted_snapshot IS
    'Snapshot of incident_nonsensitive_details at first PENDING transition (M4-G). Written once.';
