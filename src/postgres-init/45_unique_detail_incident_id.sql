-- 45_unique_detail_incident_id.sql
-- Adds UNIQUE constraints on incident_id in both detail tables to enforce the
-- one-to-one relationship with fire_incidents and enable ON CONFLICT upserts.
-- Idempotent: YES

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_nsd_incident_id'
          AND conrelid = 'wims.incident_nonsensitive_details'::regclass
    ) THEN
        ALTER TABLE wims.incident_nonsensitive_details
            ADD CONSTRAINT uq_nsd_incident_id UNIQUE (incident_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_sd_incident_id'
          AND conrelid = 'wims.incident_sensitive_details'::regclass
    ) THEN
        ALTER TABLE wims.incident_sensitive_details
            ADD CONSTRAINT uq_sd_incident_id UNIQUE (incident_id);
    END IF;
END $$;

COMMIT;
