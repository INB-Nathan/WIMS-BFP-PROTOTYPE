-- 21_all_regions.sql
-- Dependencies: 02_ref_geography.sql, 03_users.sql
-- Idempotent: YES
-- Adds all 18 PH regions + their provinces; adds province_district/city_municipality
-- text columns to incident_nonsensitive_details; assigns canonical encoder users to regions.

BEGIN;

-- ── 1. Schema additions ───────────────────────────────────────────────────────

ALTER TABLE wims.incident_nonsensitive_details
    ADD COLUMN IF NOT EXISTS province_district TEXT,
    ADD COLUMN IF NOT EXISTS city_municipality TEXT;

COMMENT ON COLUMN wims.incident_nonsensitive_details.province_district IS
    'Free-text province or district name (replaces city_id FK-based join for province display).';
COMMENT ON COLUMN wims.incident_nonsensitive_details.city_municipality IS
    'Free-text city or municipality name (replaces city_id FK-based join for city display).';

-- ── 2. All 18 PH regions ─────────────────────────────────────────────────────
-- NCR is already inserted as region_id=1 via 14_seed_ncr.sql.
-- Use explicit region_id values so the frontend static data can hardcode them.

INSERT INTO wims.ref_regions (region_id, region_name, region_code)
VALUES
    (1,  'National Capital Region',                 'NCR'),
    (2,  'Cordillera Administrative Region',        'CAR'),
    (3,  'Region I - Ilocos Region',               'I'),
    (4,  'Region II - Cagayan Valley',              'II'),
    (5,  'Region III - Central Luzon',              'III'),
    (6,  'Region IV-A - CALABARZON',               'IV-A'),
    (7,  'Region IV-B - MIMAROPA',                 'IV-B'),
    (8,  'Region V - Bicol Region',                 'V'),
    (9,  'Region VI - Western Visayas',             'VI'),
    (10, 'Region VII - Central Visayas',            'VII'),
    (11, 'Region VIII - Eastern Visayas',           'VIII'),
    (12, 'Region IX - Zamboanga Peninsula',         'IX'),
    (13, 'Region X - Northern Mindanao',            'X'),
    (14, 'Region XI - Davao Region',                'XI'),
    (15, 'Region XII - SOCCSKSARGEN',              'XII'),
    (16, 'Region XIII - CARAGA',                    'XIII'),
    (17, 'BARMM',                                   'BARMM'),
    (18, 'NIR - Negros Island Region',              'NIR')
ON CONFLICT (region_code) DO UPDATE
    SET region_name = EXCLUDED.region_name;

-- Fix the SERIAL sequence so future INSERTs don't conflict
SELECT setval('wims.ref_regions_region_id_seq', 18, true);

-- ── 3. Provinces per region ───────────────────────────────────────────────────

-- NCR: replace old 'Metro Manila' with BFP fire districts
DELETE FROM wims.ref_provinces WHERE region_id = 1 AND province_name = 'Metro Manila';

INSERT INTO wims.ref_provinces (region_id, province_name)
VALUES
    -- NCR (region_id=1): BFP fire districts (used as province/district)
    (1, 'Fire District 1'),
    (1, 'Fire District 2'),
    (1, 'Fire District 3'),
    (1, 'Fire District 4'),
    (1, 'Fire District 5'),

    -- CAR (region_id=2)
    (2, 'Abra'),
    (2, 'Apayao'),
    (2, 'Benguet'),
    (2, 'Ifugao'),
    (2, 'Kalinga'),
    (2, 'Mountain Province'),

    -- Region I (region_id=3)
    (3, 'Ilocos Norte'),
    (3, 'Ilocos Sur'),
    (3, 'La Union'),
    (3, 'Pangasinan'),

    -- Region II (region_id=4)
    (4, 'Batanes'),
    (4, 'Cagayan'),
    (4, 'Isabela'),
    (4, 'Nueva Vizcaya'),
    (4, 'Quirino'),

    -- Region III (region_id=5)
    (5, 'Aurora'),
    (5, 'Bataan'),
    (5, 'Bulacan'),
    (5, 'Nueva Ecija'),
    (5, 'Pampanga'),
    (5, 'Tarlac'),
    (5, 'Zambales'),

    -- Region IV-A (region_id=6)
    (6, 'Batangas'),
    (6, 'Cavite'),
    (6, 'Laguna'),
    (6, 'Quezon'),
    (6, 'Rizal'),

    -- Region IV-B (region_id=7)
    (7, 'Marinduque'),
    (7, 'Occidental Mindoro'),
    (7, 'Oriental Mindoro'),
    (7, 'Palawan'),
    (7, 'Romblon'),

    -- Region V (region_id=8)
    (8, 'Albay'),
    (8, 'Camarines Norte'),
    (8, 'Camarines Sur'),
    (8, 'Catanduanes'),
    (8, 'Masbate'),
    (8, 'Sorsogon'),

    -- Region VI (region_id=9)
    (9, 'Aklan'),
    (9, 'Antique'),
    (9, 'Capiz'),
    (9, 'Guimaras'),
    (9, 'Iloilo'),

    -- Region VII (region_id=10)
    (10, 'Bohol'),
    (10, 'Cebu'),

    -- Region VIII (region_id=11)
    (11, 'Biliran'),
    (11, 'Eastern Samar'),
    (11, 'Leyte'),
    (11, 'Northern Samar'),
    (11, 'Samar'),
    (11, 'Southern Leyte'),

    -- Region IX (region_id=12)
    (12, 'Zamboanga del Norte'),
    (12, 'Zamboanga del Sur'),
    (12, 'Zamboanga Sibugay'),

    -- Region X (region_id=13)
    (13, 'Bukidnon'),
    (13, 'Camiguin'),
    (13, 'Lanao del Norte'),
    (13, 'Misamis Occidental'),
    (13, 'Misamis Oriental'),

    -- Region XI (region_id=14)
    (14, 'Davao de Oro'),
    (14, 'Davao del Norte'),
    (14, 'Davao del Sur'),
    (14, 'Davao Occidental'),
    (14, 'Davao Oriental'),

    -- Region XII (region_id=15)
    (15, 'North Cotabato'),
    (15, 'Sarangani'),
    (15, 'South Cotabato'),
    (15, 'Sultan Kudarat'),

    -- Region XIII (region_id=16)
    (16, 'Agusan del Norte'),
    (16, 'Agusan del Sur'),
    (16, 'Dinagat Islands'),
    (16, 'Surigao del Norte'),
    (16, 'Surigao del Sur'),

    -- BARMM (region_id=17)
    (17, 'Basilan'),
    (17, 'Lanao del Sur'),
    (17, 'Maguindanao del Norte'),
    (17, 'Maguindanao del Sur'),
    (17, 'Sulu'),
    (17, 'Tawi-Tawi'),

    -- NIR (region_id=18)
    (18, 'Negros Occidental'),
    (18, 'Negros Oriental'),
    (18, 'Siquijor')
ON CONFLICT (region_id, province_name) DO NOTHING;

-- ── 4. Assign canonical dev encoders to their regions ───────────────────────

WITH encoder_regions(username, region_id) AS (
    VALUES
        ('encoder_ncr', 1),
        ('encoder_car', 2),
        ('encoder_r01', 3),
        ('encoder_r02', 4),
        ('encoder_r03', 5),
        ('encoder_r04a', 6),
        ('encoder_r04b', 7),
        ('encoder_r05', 8),
        ('encoder_r06', 9),
        ('encoder_r07', 10),
        ('encoder_r08', 11),
        ('encoder_r09', 12),
        ('encoder_r10', 13),
        ('encoder_r11', 14),
        ('encoder_r12', 15),
        ('encoder_r13', 16),
        ('encoder_barmm', 17),
        ('encoder_nir', 18)
)
UPDATE wims.users u
SET assigned_region_id = er.region_id, updated_at = now()
FROM encoder_regions er
WHERE u.username = er.username
  AND (u.assigned_region_id IS NULL OR u.assigned_region_id != er.region_id);

COMMIT;
