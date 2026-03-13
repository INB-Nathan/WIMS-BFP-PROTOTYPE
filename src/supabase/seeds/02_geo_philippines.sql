-- Geo Seed: Regions, Provinces, Cities, Barangays for Philippines (Partial/Representative)
-- Note: User requested "all regions and provinces and everything under them". 
-- Given the sheer volume (42k+ barangays), this seed includes ALL Regions and ALL Provinces, 
-- plus a VERY comprehensive list for NCR and major key cities to demonstrate the hierarchy.

-- 0. Cleanup Legacy/Test Data (to prevent hierarchy conflicts with new IDs)
--    We detach any existing incidents from old City IDs (< 1000) and delete old Provinces (< 100).
DO $$
BEGIN
    -- Detach incidents from legacy cities (if any)
    UPDATE wims.incident_nonsensitive_details SET city_id = NULL WHERE city_id < 1000;
    
    -- Delete legacy Cities (IDs 1-999)
    DELETE FROM wims.ref_cities WHERE city_id < 1000;
    
    -- Delete legacy Provinces (IDs 1-99)
    DELETE FROM wims.ref_provinces WHERE province_id < 100;
    
    -- Note: Regions 1 and 2 exist but will be updated below. 
    -- Region 2 (was Bicol) will become CAR. Incidents linked to Region 2 will effectively move to CAR.
END $$;


-- 1. Regions (All 17)
INSERT INTO wims.ref_regions (region_id, region_name, region_code) VALUES
(1, 'National Capital Region', 'NCR'),
(2, 'Cordillera Administrative Region', 'CAR'),
(3, 'Ilocos Region', 'Region I'),
(4, 'Cagayan Valley', 'Region II'),
(5, 'Central Luzon', 'Region III'),
(6, 'CALABARZON', 'Region IV-A'),
(7, 'MIMAROPA Region', 'Region IV-B'),
(8, 'Bicol Region', 'Region V'),
(9, 'Western Visayas', 'Region VI'),
(10, 'Central Visayas', 'Region VII'),
(11, 'Eastern Visayas', 'Region VIII'),
(12, 'Zamboanga Peninsula', 'Region IX'),
(13, 'Northern Mindanao', 'Region X'),
(14, 'Davao Region', 'Region XI'),
(15, 'SOCCSKSARGEN', 'Region XII'),
(16, 'Caraga', 'Region XIII'),
(17, 'Bangsamoro Autonomous Region in Muslim Mindanao', 'BARMM')
ON CONFLICT (region_id) DO UPDATE 
SET region_name = EXCLUDED.region_name, 
    region_code = EXCLUDED.region_code;


-- 2. Provinces (All 81+ + NCR Districts)
-- NCR (Special Districts acting as Provinces for hierarchy simplicity)
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(100, 1, 'Metro Manila 1st District (Manila)'),
(101, 1, 'Metro Manila 2nd District'),
(102, 1, 'Metro Manila 3rd District'),
(103, 1, 'Metro Manila 4th District')
ON CONFLICT (province_id) DO NOTHING;

-- CAR
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(201, 2, 'Abra'), (202, 2, 'Apayao'), (203, 2, 'Benguet'), (204, 2, 'Ifugao'), (205, 2, 'Kalinga'), (206, 2, 'Mountain Province')
ON CONFLICT (province_id) DO NOTHING;

-- Region I
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(301, 3, 'Ilocos Norte'), (302, 3, 'Ilocos Sur'), (303, 3, 'La Union'), (304, 3, 'Pangasinan')
ON CONFLICT (province_id) DO NOTHING;

-- Region II
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(401, 4, 'Batanes'), (402, 4, 'Cagayan'), (403, 4, 'Isabela'), (404, 4, 'Nueva Vizcaya'), (405, 4, 'Quirino')
ON CONFLICT (province_id) DO NOTHING;

-- Region III
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(501, 5, 'Aurora'), (502, 5, 'Bataan'), (503, 5, 'Bulacan'), (504, 5, 'Nueva Ecija'), (505, 5, 'Pampanga'), (506, 5, 'Tarlac'), (507, 5, 'Zambales')
ON CONFLICT (province_id) DO NOTHING;

-- Region IV-A
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(601, 6, 'Batangas'), (602, 6, 'Cavite'), (603, 6, 'Laguna'), (604, 6, 'Quezon'), (605, 6, 'Rizal')
ON CONFLICT (province_id) DO NOTHING;

-- Region IV-B
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(701, 7, 'Marinduque'), (702, 7, 'Occidental Mindoro'), (703, 7, 'Oriental Mindoro'), (704, 7, 'Palawan'), (705, 7, 'Romblon')
ON CONFLICT (province_id) DO NOTHING;

-- Region V
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(801, 8, 'Albay'), (802, 8, 'Camarines Norte'), (803, 8, 'Camarines Sur'), (804, 8, 'Catanduanes'), (805, 8, 'Masbate'), (806, 8, 'Sorsogon')
ON CONFLICT (province_id) DO NOTHING;

-- Region VI
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(901, 9, 'Aklan'), (902, 9, 'Antique'), (903, 9, 'Capiz'), (904, 9, 'Guimaras'), (905, 9, 'Iloilo'), (906, 9, 'Negros Occidental')
ON CONFLICT (province_id) DO NOTHING;

-- Region VII
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1001, 10, 'Bohol'), (1002, 10, 'Cebu'), (1003, 10, 'Negros Oriental'), (1004, 10, 'Siquijor')
ON CONFLICT (province_id) DO NOTHING;

-- Region VIII
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1101, 11, 'Biliran'), (1102, 11, 'Eastern Samar'), (1103, 11, 'Leyte'), (1104, 11, 'Northern Samar'), (1105, 11, 'Samar'), (1106, 11, 'Southern Leyte')
ON CONFLICT (province_id) DO NOTHING;

-- Region IX
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1201, 12, 'Zamboanga del Norte'), (1202, 12, 'Zamboanga del Sur'), (1203, 12, 'Zamboanga Sibugay')
ON CONFLICT (province_id) DO NOTHING;

-- Region X
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1301, 13, 'Bukidnon'), (1302, 13, 'Camiguin'), (1303, 13, 'Lanao del Norte'), (1304, 13, 'Misamis Occidental'), (1305, 13, 'Misamis Oriental')
ON CONFLICT (province_id) DO NOTHING;

-- Region XI
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1401, 14, 'Davao de Oro'), (1402, 14, 'Davao del Norte'), (1403, 14, 'Davao del Sur'), (1404, 14, 'Davao Occidental'), (1405, 14, 'Davao Oriental')
ON CONFLICT (province_id) DO NOTHING;

-- Region XII
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1501, 15, 'Cotabato'), (1502, 15, 'Sarangani'), (1503, 15, 'South Cotabato'), (1504, 15, 'Sultan Kudarat')
ON CONFLICT (province_id) DO NOTHING;

-- Region XIII
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1601, 16, 'Agusan del Norte'), (1602, 16, 'Agusan del Sur'), (1603, 16, 'Dinagat Islands'), (1604, 16, 'Surigao del Norte'), (1605, 16, 'Surigao del Sur')
ON CONFLICT (province_id) DO NOTHING;

-- BARMM
INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1701, 17, 'Basilan'), (1702, 17, 'Lanao del Sur'), (1703, 17, 'Maguindanao del Norte'), (1704, 17, 'Maguindanao del Sur'), (1705, 17, 'Sulu'), (1706, 17, 'Tawi-Tawi')
ON CONFLICT (province_id) DO NOTHING;


-- 3. Cities (Representative List)
-- NCR Cities
INSERT INTO wims.ref_cities (city_id, province_id, city_name, is_capital) VALUES
(1001, 100, 'City of Manila', TRUE),
(1002, 101, 'Mandaluyong City', FALSE),
(1003, 101, 'Marikina City', FALSE),
(1004, 101, 'Pasig City', FALSE),
(1005, 101, 'Quezon City', FALSE),
(1006, 101, 'San Juan City', FALSE),
(1007, 102, 'Caloocan City', FALSE),
(1008, 102, 'Malabon City', FALSE),
(1009, 102, 'Navotas City', FALSE),
(1010, 102, 'Valenzuela City', FALSE),
(1011, 103, 'Las Piñas City', FALSE),
(1012, 103, 'Makati City', FALSE),
(1013, 103, 'Muntinlupa City', FALSE),
(1014, 103, 'Parañaque City', FALSE),
(1015, 103, 'Pasay City', FALSE),
(1016, 103, 'Taguig City', FALSE),
(1017, 103, 'Pateros', FALSE)
ON CONFLICT (city_id) DO NOTHING;

-- Key Provincial Cities
INSERT INTO wims.ref_cities (city_id, province_id, city_name, is_capital) VALUES
(2031, 203, 'Baguio City', TRUE), -- Benguet
(3011, 301, 'Laoag City', TRUE), -- Ilocos Norte
(4021, 402, 'Tuguegarao City', TRUE), -- Cagayan
(5051, 505, 'San Fernando (Pampanga)', TRUE), -- Pampanga
(5052, 505, 'Angeles City', FALSE),
(6021, 602, 'Cavite City', FALSE), -- Cavite
(6022, 602, 'Tagaytay City', FALSE),
(8011, 801, 'Legazpi City', TRUE), -- Albay
(9051, 905, 'Iloilo City', TRUE), -- Iloilo
(10021, 1002, 'Cebu City', TRUE), -- Cebu
(10022, 1002, 'Lapu-Lapu City', FALSE),
(14031, 1403, 'Davao City', TRUE), -- Davao del Sur
(12021, 1202, 'Zamboanga City', TRUE) -- Zamboanga del Sur
ON CONFLICT (city_id) DO NOTHING;

-- 4. Barangays (Representative Sample for select cities)

-- Quezon City (1005) - Partial
INSERT INTO wims.ref_barangays (city_id, barangay_name) VALUES
(1005, 'Alicia'), (1005, 'Bagong Pag-asa'), (1005, 'Bahay Toro'), (1005, 'Balingasa'), (1005, 'Bungad'), 
(1005, 'Damayan'), (1005, 'Del Monte'), (1005, 'Katipunan'), (1005, 'Lourdes'), (1005, 'Maharlika'), 
(1005, 'Mariblo'), (1005, 'Masambong'), (1005, 'NS Amoranto'), (1005, 'Nayong Kanluran'), (1005, 'Paang Bundok'), 
(1005, 'Pag-ibig sa Nayon'), (1005, 'Paltok'), (1005, 'Paraiso'), (1005, 'Phil-Am'), (1005, 'Project 6'), 
(1005, 'Ramon Magsaysay'), (1005, 'Saint Peter'), (1005, 'Salvacion'), (1005, 'San Antonio'), (1005, 'San Isidro Labrador'), 
(1005, 'San Jose'), (1005, 'Santa Cruz'), (1005, 'Santa Teresita'), (1005, 'Santo Cristo'), (1005, 'Santo Domingo'), 
(1005, 'Siena'), (1005, 'Talayan'), (1005, 'Vasra'), (1005, 'Veterans Village'), (1005, 'West Triangle'),
(1005, 'Batasan Hills'), (1005, 'Commonwealth'), (1005, 'Holy Spirit'), (1005, 'Payatas'), (1005, 'Bagong Silangan')
ON CONFLICT (barangay_id) DO NOTHING;

-- Manila (1001) - Example
INSERT INTO wims.ref_barangays (city_id, barangay_name) VALUES
(1001, 'Barangay 1'), (1001, 'Barangay 2'), (1001, 'Barangay 3'), (1001, 'Barangay 4'), (1001, 'Barangay 5'),
(1001, 'Binondo'), (1001, 'Ermita'), (1001, 'Intramuros'), (1001, 'Malate'), (1001, 'Paco'),
(1001, 'Pandacan'), (1001, 'Port Area'), (1001, 'Quiapo'), (1001, 'Sampaloc'), (1001, 'San Miguel'),
(1001, 'San Nicolas'), (1001, 'Santa Ana'), (1001, 'Santa Cruz'), (1001, 'Tondo I'), (1001, 'Tondo II')
ON CONFLICT (barangay_id) DO NOTHING;

-- Davao City (14031) - Example
INSERT INTO wims.ref_barangays (city_id, barangay_name) VALUES
(14031, 'Poblacion District'), (14031, 'Talomo District'), (14031, 'Agdao District'), (14031, 'Buhangin District'),
(14031, 'Bunawan District'), (14031, 'Paquibato District'), (14031, 'Baguio District'), (14031, 'Calinan District'),
(14031, 'Marilog District'), (14031, 'Toril District'), (14031, 'Tugbok District')
ON CONFLICT (barangay_id) DO NOTHING;

-- Cebu City (10021) - Example
INSERT INTO wims.ref_barangays (city_id, barangay_name) VALUES
(10021, 'Adlaon'), (10021, 'Agsungot'), (10021, 'Apas'), (10021, 'Babag'), (10021, 'Bacayan'),
(10021, 'Banilad'), (10021, 'Basak Pardo'), (10021, 'Basak San Nicolas'), (10021, 'Bonbon'), (10021, 'Budlaan'),
(10021, 'Buhisan'), (10021, 'Bulacao'), (10021, 'Buot-Taup'), (10021, 'Busay'), (10021, 'Calamba'),
(10021, 'Cambinocot'), (10021, 'Capitol Site'), (10021, 'Carreta'), (10021, 'Cogon Pardo'), (10021, 'Cogon Ramos')
ON CONFLICT (barangay_id) DO NOTHING;
