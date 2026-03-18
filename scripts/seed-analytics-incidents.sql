-- =============================================================================
-- Seed verified incidents for the National Analyst dashboard analytics.
-- Populates heatmap, trends, and comparative endpoints.
-- Run via: ./scripts/seed-analytics-incidents.sh
-- =============================================================================

-- 1. Ensure reference regions exist (idempotent)
INSERT INTO wims.ref_regions (region_name, region_code)
VALUES
  ('National Capital Region', 'NCR'),
  ('Calabarzon', 'Region IV-A'),
  ('Bicol Region', 'Region V')
ON CONFLICT (region_code) DO NOTHING;

-- 2. Insert verified incidents with nonsensitive details (batch insert)
-- Uses a CTE to create incidents and details in one pass.
DO $$
DECLARE
  r RECORD;
  alarm_levels TEXT[] := ARRAY['1','2','3','4','5','Task Force Bravo','General Alarm'];
  categories TEXT[] := ARRAY['STRUCTURAL','NON_STRUCTURAL','VEHICULAR'];
  region_ids INT[];
  n INT;
BEGIN
  SELECT ARRAY_AGG(region_id) INTO region_ids FROM wims.ref_regions;

  IF region_ids IS NULL OR array_length(region_ids, 1) IS NULL THEN
    RAISE NOTICE 'No regions found; skipping seed.';
    RETURN;
  END IF;

  FOR n IN 1..100 LOOP
    INSERT INTO wims.fire_incidents (region_id, location, verification_status, is_archived)
    VALUES (
      region_ids[1 + (floor(random() * array_length(region_ids, 1))::int % array_length(region_ids, 1))],
      ST_SetSRID(ST_MakePoint(
        120.9 + (random() * 0.4),
        14.5 + (random() * 0.4)
      ), 4326)::geography,
      'VERIFIED',
      FALSE
    )
    RETURNING incident_id INTO r;

    INSERT INTO wims.incident_nonsensitive_details (
      incident_id,
      notification_dt,
      alarm_level,
      general_category
    )
    VALUES (
      r.incident_id,
      NOW() - (random() * interval '90 days'),
      alarm_levels[1 + (floor(random() * array_length(alarm_levels, 1))::int % array_length(alarm_levels, 1))],
      categories[1 + (floor(random() * array_length(categories, 1))::int % array_length(categories, 1))]
    );
  END LOOP;

  RAISE NOTICE 'Inserted 100 verified incidents for analytics.';
END $$;
