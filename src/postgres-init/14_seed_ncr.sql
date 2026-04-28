-- 14_seed_ncr.sql
-- Dependencies: 02_ref_geography.sql
-- Idempotent: YES
-- Expanded from old 03_seed_reference.sql — NCR seed only (per design contract)

BEGIN;

INSERT INTO wims.ref_regions (region_name, region_code)
VALUES ('National Capital Region', 'NCR')
ON CONFLICT (region_code) DO NOTHING;

COMMIT;
