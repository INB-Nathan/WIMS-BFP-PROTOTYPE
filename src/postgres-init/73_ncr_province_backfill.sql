-- 73_ncr_province_backfill.sql
-- Dependencies: 29_seed_incidents.sql (seed data fix), 21_all_regions.sql (fire districts)
-- Idempotent: YES (WHERE province_district = 'Metro Manila' guard)
--
-- Backfill NCR incidents that have province_district = 'Metro Manila' to use
-- the correct BFP fire district name based on city_municipality.
-- This aligns existing data with the canonical ref_provinces entries.

BEGIN;

UPDATE wims.incident_nonsensitive_details AS nd
SET province_district = mapping.fire_district
FROM (
    SELECT
        nd2.incident_id,
        nd2.city_municipality,
        CASE
            -- Fire District 1: City of Manila
            WHEN nd2.city_municipality IN ('City of Manila', 'Manila') THEN 'Fire District 1'

            -- Fire District 2: Caloocan, Malabon, Navotas, Valenzuela
            WHEN nd2.city_municipality IN ('Caloocan City', 'Caloocan') THEN 'Fire District 2'
            WHEN nd2.city_municipality IN ('Malabon City', 'Malabon') THEN 'Fire District 2'
            WHEN nd2.city_municipality IN ('Navotas City', 'Navotas') THEN 'Fire District 2'
            WHEN nd2.city_municipality IN ('Valenzuela City', 'Valenzuela') THEN 'Fire District 2'

            -- Fire District 3: Pasay, Makati, Parañaque, Las Piñas, Muntinlupa
            WHEN nd2.city_municipality IN ('Pasay City', 'Pasay') THEN 'Fire District 3'
            WHEN nd2.city_municipality IN ('Makati City', 'Makati') THEN 'Fire District 3'
            WHEN nd2.city_municipality IN ('Parañaque City', 'Parañaque', 'Paranaque City', 'Paranaque') THEN 'Fire District 3'
            WHEN nd2.city_municipality IN ('Las Piñas City', 'Las Pinas City', 'Las Piñas', 'Las Pinas') THEN 'Fire District 3'
            WHEN nd2.city_municipality IN ('Muntinlupa City', 'Muntinlupa') THEN 'Fire District 3'

            -- Fire District 4: Marikina, Pasig, Pateros, Taguig, Mandaluyong, San Juan
            WHEN nd2.city_municipality IN ('Marikina City', 'Marikina') THEN 'Fire District 4'
            WHEN nd2.city_municipality IN ('Pasig City', 'Pasig') THEN 'Fire District 4'
            WHEN nd2.city_municipality IN ('Pateros') THEN 'Fire District 4'
            WHEN nd2.city_municipality IN ('Taguig City', 'Taguig') THEN 'Fire District 4'
            WHEN nd2.city_municipality IN ('Mandaluyong City', 'Mandaluyong') THEN 'Fire District 4'
            WHEN nd2.city_municipality IN ('San Juan City', 'San Juan') THEN 'Fire District 4'

            -- Fire District 5: Quezon City
            WHEN nd2.city_municipality IN ('Quezon City') THEN 'Fire District 5'

            ELSE nd2.province_district  -- no match, keep original
        END AS fire_district
    FROM wims.incident_nonsensitive_details nd2
    JOIN wims.fire_incidents fi2 ON fi2.incident_id = nd2.incident_id
    WHERE fi2.region_id = 1
      AND nd2.province_district = 'Metro Manila'
) mapping
WHERE nd.incident_id = mapping.incident_id
  AND nd.province_district = 'Metro Manila';

-- Sync to analytics_incident_facts for the same incidents
UPDATE wims.analytics_incident_facts AS af
SET province_name = mapping.fire_district
FROM (
    SELECT
        nd2.incident_id,
        CASE
            WHEN nd2.city_municipality IN ('City of Manila', 'Manila') THEN 'Fire District 1'

            WHEN nd2.city_municipality IN ('Caloocan City', 'Caloocan') THEN 'Fire District 2'
            WHEN nd2.city_municipality IN ('Malabon City', 'Malabon') THEN 'Fire District 2'
            WHEN nd2.city_municipality IN ('Navotas City', 'Navotas') THEN 'Fire District 2'
            WHEN nd2.city_municipality IN ('Valenzuela City', 'Valenzuela') THEN 'Fire District 2'

            WHEN nd2.city_municipality IN ('Pasay City', 'Pasay') THEN 'Fire District 3'
            WHEN nd2.city_municipality IN ('Makati City', 'Makati') THEN 'Fire District 3'
            WHEN nd2.city_municipality IN ('Parañaque City', 'Parañaque', 'Paranaque City', 'Paranaque') THEN 'Fire District 3'
            WHEN nd2.city_municipality IN ('Las Piñas City', 'Las Pinas City', 'Las Piñas', 'Las Pinas') THEN 'Fire District 3'
            WHEN nd2.city_municipality IN ('Muntinlupa City', 'Muntinlupa') THEN 'Fire District 3'

            WHEN nd2.city_municipality IN ('Marikina City', 'Marikina') THEN 'Fire District 4'
            WHEN nd2.city_municipality IN ('Pasig City', 'Pasig') THEN 'Fire District 4'
            WHEN nd2.city_municipality IN ('Pateros') THEN 'Fire District 4'
            WHEN nd2.city_municipality IN ('Taguig City', 'Taguig') THEN 'Fire District 4'
            WHEN nd2.city_municipality IN ('Mandaluyong City', 'Mandaluyong') THEN 'Fire District 4'
            WHEN nd2.city_municipality IN ('San Juan City', 'San Juan') THEN 'Fire District 4'

            WHEN nd2.city_municipality IN ('Quezon City') THEN 'Fire District 5'

            ELSE nd2.province_district
        END AS fire_district
    FROM wims.incident_nonsensitive_details nd2
    JOIN wims.fire_incidents fi2 ON fi2.incident_id = nd2.incident_id
    WHERE fi2.region_id = 1
      AND nd2.province_district = 'Metro Manila'
) mapping
WHERE af.incident_id = mapping.incident_id
  AND af.province_name = 'Metro Manila';

COMMIT;
