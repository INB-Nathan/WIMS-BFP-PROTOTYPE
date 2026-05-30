-- 41_fix_immutable_rule_for_archive.sql
-- Purpose : Allow soft-archival/unarchival on VERIFIED incidents.
--
-- Migration 29 narrowed the original blanket rule to permit the VERIFIED→REPLACED
-- transition, but still blocked all other updates to VERIFIED rows — including
-- setting is_archived=TRUE without touching verification_status.
-- That silently made PATCH .../archive a no-op for VERIFIED incidents.
--
-- This migration further narrows the rule to also allow archive-view recovery
-- (is_archived FALSE→TRUE and TRUE→FALSE) while continuing to block all other mutations.
-- Idempotent: YES (DROP RULE IF EXISTS before CREATE RULE)

BEGIN;

DROP RULE IF EXISTS no_update_verified ON wims.fire_incidents;

-- Block all updates to VERIFIED rows EXCEPT:
--   1. The VERIFIED→REPLACED transition (validator Replace Existing workflow)
--   2. Setting is_archived from FALSE to TRUE (archival by validator or encoder)
--   3. Setting is_archived from TRUE to FALSE (unarchival by validator or encoder)
CREATE RULE no_update_verified AS
    ON UPDATE TO wims.fire_incidents
    WHERE (
        OLD.verification_status = 'VERIFIED'
        AND NEW.verification_status != 'REPLACED'
        AND NOT (NEW.is_archived = TRUE AND OLD.is_archived = FALSE)
        AND NOT (NEW.is_archived = FALSE AND OLD.is_archived = TRUE)
    )
    DO INSTEAD NOTHING;

COMMENT ON TABLE wims.fire_incidents IS
    'no_update_verified rule: blocks all updates to VERIFIED rows EXCEPT the '
    'VERIFIED→REPLACED transition and is_archived archive/unarchive transitions.';

COMMIT;
