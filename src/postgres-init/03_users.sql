-- 03_users.sql
-- Dependencies: 01_extensions_roles.sql (schema + roles exist)
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_id UUID NOT NULL UNIQUE,
  username VARCHAR NOT NULL UNIQUE,
  role VARCHAR NOT NULL,
  assigned_region_id INTEGER REFERENCES wims.ref_regions(region_id),
  contact_number    VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT users_role_check CHECK (
    role IN (
      'CIVILIAN_REPORTER',
      'REGIONAL_ENCODER',
      'NATIONAL_VALIDATOR',
      'NATIONAL_ANALYST',
      'SYSTEM_ADMIN'
    )
  )
);

-- Bootstrap inserts (safe for re-runs via ON CONFLICT)
-- Suricata EVE ingestion service account
INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'svc_suricata',
    'NATIONAL_ANALYST',
    TRUE
)
ON CONFLICT (user_id) DO NOTHING;

-- Bootstrap Keycloak-backed dev users (deterministic UUIDs matching Keycloak realm)
INSERT INTO wims.users (user_id, keycloak_id, username, role, assigned_region_id, is_active)
VALUES
  ('11111111-1111-4111-8111-111111111111'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'encoder_test',   'REGIONAL_ENCODER',   NULL, TRUE),
  ('22222222-2222-4222-8222-222222222222'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'validator_test', 'NATIONAL_VALIDATOR', NULL, TRUE),
  ('33333333-3333-4333-8333-333333333333'::uuid, '33333333-3333-4333-8333-333333333333'::uuid, 'analyst_test',  'NATIONAL_ANALYST',   NULL, TRUE),
  ('44444444-4444-4444-8444-444444444444'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, 'analyst1_test', 'NATIONAL_ANALYST',   NULL, TRUE),
  ('55555555-5555-4555-8555-555555555555'::uuid, '55555555-5555-4555-8555-555555555555'::uuid, 'admin_test',   'SYSTEM_ADMIN',       NULL, TRUE)
ON CONFLICT (username) DO UPDATE
SET
  keycloak_id = EXCLUDED.keycloak_id,
  role = EXCLUDED.role,
  assigned_region_id = EXCLUDED.assigned_region_id,
  is_active = TRUE,
  updated_at = now();

COMMIT;
