-- Reference seed (NCR ON CONFLICT pattern) — safe for greenfield re-runs
INSERT INTO wims.ref_regions (region_name, region_code)
VALUES ('National Capital Region', 'NCR')
ON CONFLICT (region_code) DO NOTHING;
