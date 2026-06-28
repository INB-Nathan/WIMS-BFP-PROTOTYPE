-- 76_add_xai_confidence_breakdown.sql
-- Per-category confidence breakdown for AI analysis on security threat logs.
-- Stores { anomaly_detection, classification, overall } as JSONB alongside
-- the existing xai_confidence scalar.
-- Dependencies: 08_security_audit.sql (security_threat_logs table)
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.security_threat_logs
  ADD COLUMN IF NOT EXISTS xai_confidence_breakdown JSONB DEFAULT NULL;

COMMENT ON COLUMN wims.security_threat_logs.xai_confidence_breakdown
  IS 'Per-category AI confidence: {anomaly_detection, classification, overall}';

COMMIT;
