-- 92_remove_legacy_photo_bonus_function.sql
-- Remove the retired contributor photo-bonus helper on clean volumes.
--
-- The Slice L contributor score aggregates evidence in set-based SQL inside
-- services/contributor.py and no longer calls
-- wims.photo_bonus_for_report(INTEGER). File 86 created the helper for the
-- earlier per-report/N+1 scoring engine; this cleanup keeps clean bootstrap
-- parity with Alembic revision 0013.
-- Dependencies: 86_civilian_contributor_snapshot.sql
-- Idempotent: YES

BEGIN;

DROP FUNCTION IF EXISTS wims.photo_bonus_for_report(INTEGER);

COMMIT;
