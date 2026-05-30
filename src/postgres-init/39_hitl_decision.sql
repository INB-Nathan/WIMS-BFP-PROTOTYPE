-- 39_hitl_decision.sql
-- M8d: structured HITL decision audit log for security threat logs
-- Dependencies: 08_security_audit.sql
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.security_threat_logs
  ADD COLUMN IF NOT EXISTS hitl_decision JSONB;

COMMENT ON COLUMN wims.security_threat_logs.hitl_decision IS
  'Structured HITL decision record: { "action": "CONFIRM_THREAT"|"FALSE_POSITIVE"|"REQUEST_MORE_INFO", "note": string|null, "reviewed_by": uuid, "reviewed_at": ISO8601 }';

COMMIT;
