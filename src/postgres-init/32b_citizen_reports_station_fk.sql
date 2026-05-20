-- 32b_citizen_reports_station_fk.sql
-- Civilian Reporting Phase 2 — live DB compatibility + nearest station FK
-- Dependencies: 05_citizen_reports.sql (citizen_reports), 32_ref_fire_stations.sql
-- Idempotent: YES
--
-- The nearest_station_id FK was deferred from 05_citizen_reports.sql because
-- ref_fire_stations is created by 32_ref_fire_stations.sql which runs later.
-- This file also upgrades older dev databases where citizen_reports was already
-- created by the Phase 1 free-text schema before 05_citizen_reports.sql was
-- rewritten. Fresh bootstrap is a no-op for these ALTER ADD COLUMN statements.

BEGIN;

-- Phase 2 citizen_reports columns for existing Phase 1 dev databases.
ALTER TABLE wims.citizen_reports
  ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'UNSURE',
  ADD COLUMN IF NOT EXISTS sub_category VARCHAR(120),
  ADD COLUMN IF NOT EXISTS reporting_context VARCHAR(32) NOT NULL DEFAULT 'WITNESS',
  ADD COLUMN IF NOT EXISTS safety_status VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS witness_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS witness_phone VARCHAR(80),
  ADD COLUMN IF NOT EXISTS device_id UUID,
  ADD COLUMN IF NOT EXISTS ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS region_id INTEGER REFERENCES wims.ref_regions(region_id),
  ADD COLUMN IF NOT EXISTS nearest_station_id INTEGER,
  ADD COLUMN IF NOT EXISTS status_explanation TEXT,
  ADD COLUMN IF NOT EXISTS internal_note TEXT,
  ADD COLUMN IF NOT EXISTS linked_to_report_id INTEGER REFERENCES wims.citizen_reports(report_id),
  ADD COLUMN IF NOT EXISTS link_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previous_report_id INTEGER REFERENCES wims.citizen_reports(report_id),
  ADD COLUMN IF NOT EXISTS reported_via VARCHAR(16) DEFAULT 'WEB',
  ADD COLUMN IF NOT EXISTS phone_latitude FLOAT,
  ADD COLUMN IF NOT EXISTS phone_longitude FLOAT,
  ADD COLUMN IF NOT EXISTS gps_distance_m FLOAT,
  ADD COLUMN IF NOT EXISTS gps_warning_confirmed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

UPDATE wims.citizen_reports
SET status = CASE status
  WHEN 'VERIFIED' THEN 'ACTIONED'
  WHEN 'FALSE_ALARM' THEN 'REJECTED_BOGUS'
  WHEN 'DUPLICATE' THEN 'REJECTED_DUPLICATE'
  ELSE status
END
WHERE status IN ('VERIFIED', 'FALSE_ALARM', 'DUPLICATE');

-- Drop old Phase 1 CHECK constraints that reject Phase 2 status values.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'wims.citizen_reports'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE wims.citizen_reports DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END
$$;

ALTER TABLE wims.citizen_reports
  DROP CONSTRAINT IF EXISTS chk_citizen_reports_category,
  DROP CONSTRAINT IF EXISTS chk_citizen_reports_reporting_context,
  DROP CONSTRAINT IF EXISTS chk_citizen_reports_safety_status,
  DROP CONSTRAINT IF EXISTS chk_citizen_reports_status,
  DROP CONSTRAINT IF EXISTS chk_citizen_reports_reported_via,
  DROP CONSTRAINT IF EXISTS chk_actioned_requires_validator;

ALTER TABLE wims.citizen_reports
  ADD CONSTRAINT chk_citizen_reports_category
    CHECK (category IN ('STRUCTURAL', 'NON_STRUCTURAL', 'TRANSPORTATION', 'UNSURE')),
  ADD CONSTRAINT chk_citizen_reports_reporting_context
    CHECK (reporting_context IN ('WITNESS', 'NEARBY', 'SECONDHAND')),
  ADD CONSTRAINT chk_citizen_reports_safety_status
    CHECK (safety_status IN ('I_AM_SAFE', 'I_NEED_HELP', 'SOMEONE_ELSE_NEEDS_HELP', 'UNKNOWN')),
  ADD CONSTRAINT chk_citizen_reports_status
    CHECK (status IN (
      'PENDING',
      'UNDER_REVIEW',
      'LINKED',
      'ACTIONED',
      'REJECTED_BOGUS',
      'REJECTED_DUPLICATE',
      'REJECTED_INSUFFICIENT',
      'REJECTED_TIMEOUT'
    )),
  ADD CONSTRAINT chk_citizen_reports_reported_via
    CHECK (reported_via IN ('WEB', 'MOBILE_APP', 'API'));

ALTER TABLE wims.citizen_reports
  ADD CONSTRAINT chk_actioned_requires_validator
    CHECK (status != 'ACTIONED' OR validated_by IS NOT NULL)
    NOT VALID;

CREATE INDEX IF NOT EXISTS idx_citizen_reports_status
    ON wims.citizen_reports (status);
CREATE INDEX IF NOT EXISTS idx_citizen_reports_device
    ON wims.citizen_reports (device_id)
    WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_citizen_reports_linked_to
    ON wims.citizen_reports (linked_to_report_id)
    WHERE linked_to_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_citizen_reports_previous
    ON wims.citizen_reports (previous_report_id)
    WHERE previous_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_citizen_reports_created
    ON wims.citizen_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_citizen_reports_nearest_station
    ON wims.citizen_reports (nearest_station_id)
    WHERE nearest_station_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_citizen_reports_region
    ON wims.citizen_reports (region_id)
    WHERE region_id IS NOT NULL;

-- Add FK constraint for nearest_station_id
DO $$
BEGIN
  ALTER TABLE wims.citizen_reports
    ADD CONSTRAINT fk_citizen_reports_nearest_station
    FOREIGN KEY (nearest_station_id)
    REFERENCES wims.ref_fire_stations(station_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

COMMIT;
