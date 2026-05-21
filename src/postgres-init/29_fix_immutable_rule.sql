-- 29_fix_immutable_rule.sql
-- Purpose : Allow the VERIFIED → REPLACED status transition so that the
--           validator "Replace Existing" action can archive the original incident.
--           The original no_update_verified rule (migration 17) fired on ALL
--           updates to VERIFIED rows — including the legitimate archival UPDATE
--           that sets is_archived=TRUE and verification_status='REPLACED'.
--           The rule uses DO INSTEAD NOTHING, so the UPDATE silently became a
--           no-op with no error, leaving the original un-archived.
-- Idempotent: YES (DROP RULE IF EXISTS before CREATE RULE)

BEGIN;

-- Drop old blanket rule and replace with a narrower one that allows
-- REPLACED transitions (validator archival) but still blocks all others.
DROP RULE IF EXISTS no_update_verified ON wims.fire_incidents;

CREATE RULE no_update_verified AS
    ON UPDATE TO wims.fire_incidents
    WHERE (
        OLD.verification_status = 'VERIFIED'
        AND NEW.verification_status != 'REPLACED'
    )
    DO INSTEAD NOTHING;

COMMENT ON TABLE wims.fire_incidents IS
    'no_update_verified rule: blocks all updates to VERIFIED rows EXCEPT the '
    'VERIFIED→REPLACED archival transition used by the validator Replace Existing action.';

COMMIT;
