-- Minimal seed for integration tests: one region for fire_incidents FK
INSERT INTO wims.ref_regions (region_name, region_code)
VALUES ('National Capital Region', 'NCR')
ON CONFLICT (region_code) DO NOTHING;
