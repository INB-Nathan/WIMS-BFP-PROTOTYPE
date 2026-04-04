-- WIMS auth performance + integrity indexes
-- Safe to run on top of existing schema (IF NOT EXISTS makes idempotent)

-- ─────────────────────────────────────────────────────────────────────────────
-- Auth indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- keycloak_id powers every JWT→user lookup in get_current_wims_user.
-- The UNIQUE constraint creates a backing B-tree index, but an explicit
-- index documents the lookup pattern and survives constraint changes.
CREATE INDEX IF NOT EXISTS idx_wims_users_keycloak_id ON wims.users (keycloak_id);

-- Composite index for the active-user lookup used in auth.py:get_current_wims_user.
-- Covers the WHERE keycloak_id = :kid AND is_active = TRUE filter.
CREATE INDEX IF NOT EXISTS idx_wims_users_keycloak_id_active
  ON wims.users (keycloak_id, is_active)
  WHERE is_active = TRUE;

-- used_by lookup in get_regional_encoder / get_regional_user
CREATE INDEX IF NOT EXISTS idx_wims_users_user_id_role
  ON wims.users (user_id, role)
  WHERE is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- incident_id FK indexes — eliminates seq scans on child tables when joining
-- or cascading deletes from fire_incidents.  Every child table that holds a
-- FK reference to fire_incidents.incident_id needs this.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_incident_attachments_incident_id
  ON wims.incident_attachments (incident_id);

CREATE INDEX IF NOT EXISTS idx_incident_nonsensitive_details_incident_id
  ON wims.incident_nonsensitive_details (incident_id);

CREATE INDEX IF NOT EXISTS idx_incident_sensitive_details_incident_id
  ON wims.incident_sensitive_details (incident_id);

CREATE INDEX IF NOT EXISTS idx_incident_verification_history_incident_id
  ON wims.incident_verification_history (incident_id);

CREATE INDEX IF NOT EXISTS idx_involved_parties_incident_id
  ON wims.involved_parties (incident_id);

CREATE INDEX IF NOT EXISTS idx_operational_challenges_incident_id
  ON wims.operational_challenges (incident_id);

CREATE INDEX IF NOT EXISTS idx_responding_units_incident_id
  ON wims.responding_units (incident_id);
