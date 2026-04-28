-- 04_import_incidents.sql
-- Dependencies: 01_extensions_roles.sql, 03_users.sql
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.data_import_batches (
  batch_id SERIAL PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES wims.ref_regions(region_id),
  uploaded_by UUID REFERENCES wims.users(user_id),
  upload_timestamp TIMESTAMPTZ DEFAULT now(),
  record_count INTEGER DEFAULT 0,
  batch_checksum_hash VARCHAR,
  sync_status VARCHAR DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS wims.fire_incidents (
  incident_id SERIAL PRIMARY KEY,
  import_batch_id INTEGER REFERENCES wims.data_import_batches(batch_id),
  encoder_id UUID REFERENCES wims.users(user_id),
  region_id INTEGER NOT NULL REFERENCES wims.ref_regions(region_id),
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  verification_status VARCHAR DEFAULT 'DRAFT' CHECK (
    verification_status IN ('DRAFT', 'PENDING', 'PENDING_VALIDATION', 'VERIFIED', 'REJECTED')
  ),
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fire_incidents_location ON wims.fire_incidents USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_fire_incidents_region_created ON wims.fire_incidents (region_id, created_at DESC);

COMMIT;
