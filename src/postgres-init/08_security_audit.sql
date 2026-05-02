-- 08_security_audit.sql
-- Dependencies: 01_extensions_roles.sql, 03_users.sql
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.regional_public_keys (
  key_id SERIAL PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES wims.ref_regions(region_id),
  public_key_pem TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- ARCHITECTURAL DECISION RECORD: BFP SECURITY OPERATIONS INTENT
-- Table: security_threat_logs (Suricata IDS Ingestion)
-- Scope: GLOBAL (Intentionally NOT region-filtered)
-- Justification: Cybersecurity threats are borderless. To defend the WIMS-BFP
-- network, SYSTEM_ADMIN (CRUD) and NATIONAL_ANALYST (Read-Only) require complete,
-- unfiltered visibility into all regional IDS logs to perform lateral movement
-- analysis and national threat correlation.
CREATE TABLE IF NOT EXISTS wims.security_threat_logs (
  log_id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT now(),
  source_ip VARCHAR,
  destination_ip VARCHAR,
  suricata_sid INTEGER CHECK (suricata_sid > 0),
  severity_level VARCHAR,
  raw_payload VARCHAR(65535),
  xai_narrative VARCHAR(10000),
  xai_confidence DOUBLE PRECISION,
  admin_action_taken TEXT,
  resolved_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES wims.users(user_id)
);

CREATE TABLE IF NOT EXISTS wims.system_audit_trails (
  audit_id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES wims.users(user_id),
  action_type VARCHAR,
  table_affected VARCHAR,
  record_id INTEGER,
  ip_address VARCHAR,
  user_agent TEXT,
  timestamp TIMESTAMPTZ DEFAULT now()
);

COMMIT;
