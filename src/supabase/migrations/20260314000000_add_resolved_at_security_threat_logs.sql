-- Add resolved_at to security_threat_logs for admin resolution tracking
ALTER TABLE wims.security_threat_logs ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
