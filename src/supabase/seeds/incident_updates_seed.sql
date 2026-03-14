-- =============================================================================
-- Incident Updates and New Seeds
-- Run this if you already have users and reference data in your DB
-- using the specific Validator and Encoder UUIDs.
-- =============================================================================

-- 1. Update existing incidents to match dashboard categories
UPDATE wims.incident_nonsensitive_details SET general_category = 'STRUCTURAL', specific_type = 'Residential' WHERE incident_id = 1001;
UPDATE wims.incident_nonsensitive_details SET general_category = 'STRUCTURAL', specific_type = 'Mercantile' WHERE incident_id = 1002;
UPDATE wims.incident_nonsensitive_details SET general_category = 'STRUCTURAL', specific_type = 'Mixed Occupancies' WHERE incident_id = 1003;
UPDATE wims.incident_nonsensitive_details SET general_category = 'NON_STRUCTURAL', specific_type = 'Rubbish Fire' WHERE incident_id = 1004;
UPDATE wims.incident_nonsensitive_details SET general_category = 'STRUCTURAL', specific_type = 'Single and Two Family Dwelling' WHERE incident_id = 1005;

-- 1.25 Insert Reference Data (Regions, Provinces, Cities) required for FK constraints
INSERT INTO wims.ref_regions (region_id, region_name, region_code) VALUES
(1, 'National Capital Region', 'NCR'),
(2, 'Bicol Region', 'Region V')
ON CONFLICT (region_id) DO NOTHING;

INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1, 1, 'Metro Manila'),
(2, 2, 'Albay'),
(3, 2, 'Camarines Sur')
ON CONFLICT (province_id) DO NOTHING;

INSERT INTO wims.ref_cities (city_id, province_id, city_name, zip_code, is_capital) VALUES
(1, 1, 'Quezon City', '1100', FALSE),
(2, 1, 'Manila', '1000', TRUE),
(3, 1, 'Makati City', '1200', FALSE),
(4, 2, 'Legazpi City', '4500', TRUE),
(5, 2, 'Tabaco City', '4511', FALSE),
(6, 3, 'Naga City', '4400', FALSE)
ON CONFLICT (city_id) DO NOTHING;

-- 1.5 Insert Data Import Batches (required for FK constraints)
-- If these ID's already exist, use ON CONFLICT DO NOTHING to avoid duplicate key errors.
INSERT INTO wims.data_import_batches (batch_id, region_id, uploaded_by, record_count, batch_checksum_hash, sync_status) VALUES
(101, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 5, 'sha256_dummy_hash_1', 'COMPLETED'),
(102, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 3, 'sha256_dummy_hash_2', 'PENDING'),
(103, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 10, 'sha256_dummy_hash_3', 'COMPLETED')
ON CONFLICT (batch_id) DO NOTHING;

-- 2. Insert new incidents (IDs 1006 to 1010)
-- Using the Encoder UUID: ac90c0e1-a5a6-4332-bab1-d817cc484243
INSERT INTO wims.fire_incidents (incident_id, import_batch_id, encoder_id, region_id, verification_status, is_archived) VALUES
(1006, 103, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1007, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1008, 102, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'PENDING', FALSE),
(1009, 103, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1010, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE);

INSERT INTO wims.incident_nonsensitive_details (incident_id, city_id, barangay, alarm_level, general_category, specific_type, civilian_injured, estimated_damage_php) VALUES
(1006, 3, 'Makati CBD', '1st Alarm', 'STRUCTURAL', 'Business', 0, 50000.00),
(1007, 1, 'EDSA', '2nd Alarm', 'VEHICULAR', 'Automobile', 1, 300000.00),
(1008, 2, 'Port Area', '3rd Alarm', 'VEHICULAR', 'Truck', 0, 1500000.00),
(1009, 3, 'Forbes Park', '1st Alarm', 'NON_STRUCTURAL', 'Grass Fire', 0, 5000.00),
(1010, 1, 'Diliman', 'Task Force Bravo', 'STRUCTURAL', 'Educational', 0, 5000000.00);

INSERT INTO wims.incident_sensitive_details (incident_id, caller_name, caller_number, street_address, narrative_report, disposition_status) VALUES
(1006, 'Lapu Lapu', '09224445555', 'Ayala Ave, Makati', 'Office building fire alarm...', 'Resolved'),
(1007, 'Gabriela S', '09235556666', 'EDSA, Quezon City', 'Car caught fire on highway...', 'Under Investigation'),
(1008, 'Antonio L', '09246667777', 'Pier 4, Port Area', 'Cargo truck engine fire...', 'Resolved'),
(1009, 'Melchora A', '09257778888', 'McKinley Rd, Forbes Park', 'Dry grass burning near wall...', 'Resolved'),
(1010, 'Apolinario M', '09268889999', 'UP Campus, Diliman', 'Laboratory chemicals reacted...', 'Resolved');

INSERT INTO wims.responding_units (incident_id, station_name, engine_number, responder_type, arrival_dt) VALUES
(1006, 'Makati Fire Station', 'E-789', 'BFP', NOW() - INTERVAL '5 hours'),
(1007, 'QC Fire Station', 'E-333', 'BFP', NOW() - INTERVAL '6 hours'),
(1008, 'Manila Fire Station', 'E-111', 'BFP', NOW() - INTERVAL '7 hours'),
(1009, 'Makati Fire Station', 'E-222', 'BFP', NOW() - INTERVAL '8 hours'),
(1010, 'Diliman Fire Station', 'E-444', 'BFP', NOW() - INTERVAL '9 hours');
