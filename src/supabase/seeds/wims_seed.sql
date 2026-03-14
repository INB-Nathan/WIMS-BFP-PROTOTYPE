-- =============================================================================
-- WIMS-BFP Seed Data Script
-- Purpose: Populate the 'wims' schema with initial reference data and test users/incidents.
-- Usage: Run this script in the Supabase SQL Editor after 'wims_schema.sql'.
-- =============================================================================

-- Disable RLS temporarily for seeding if running as a superuser/service_role to avoid policy checks blocking inserts.
-- However, since this script is likely run via SQL Editor (postgres role), we can just proceed.

-- 1. Reference Data (Regions, Provinces, Cities)

INSERT INTO wims.ref_regions (region_id, region_name, region_code) VALUES
(1, 'National Capital Region', 'NCR'),
(2, 'Bicol Region', 'Region V');

INSERT INTO wims.ref_provinces (province_id, region_id, province_name) VALUES
(1, 1, 'Metro Manila'),
(2, 2, 'Albay'),
(3, 2, 'Camarines Sur');

INSERT INTO wims.ref_cities (city_id, province_id, city_name, zip_code, is_capital) VALUES
-- NCR Cities
(1, 1, 'Quezon City', '1100', FALSE),
(2, 1, 'Manila', '1000', TRUE),
(3, 1, 'Makati City', '1200', FALSE),
-- Region V Cities
(4, 2, 'Legazpi City', '4500', TRUE),
(5, 2, 'Tabaco City', '4511', FALSE),
(6, 3, 'Naga City', '4400', FALSE);


-- 2. Test Users (Linked to auth.users)
-- We use explicit UUIDs so you can create matching auth users in Supabase Auth if needed,
-- or just use these for testing Foreign Key constraints.
-- Passwords are managed by Supabase Auth (GoTrue), not here.

-- Test User IDs:
-- Encoder (NCR):   ac90c0e1-a5a6-4332-bab1-d817cc484243
-- Validator (NCR): 0231f88d-a873-46e2-91d5-8b48de9eb8d9
-- Analyst (NHQ):   a0eebc99-9c0b-4ef8-bb6d-6bb9bd380003
-- Admin (NHQ):     a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004

-- NOTE: In a real Supabase Auth setup, you would create users via the Auth API or Dashboard.
-- For this seed script to work purely in SQL (without actual Auth users existing),
-- we might need to insert into auth.users IF we have permissions (service_role),
-- OR we just insert into wims.users and rely on relaxed FK constraints during dev (if auth schema is accessible).
-- Supabase SQL Editor usually has access to `auth` schema.

DO $$
BEGIN
    -- Try to insert into auth.users if possible (for local dev/testing functionality)
    -- This might fail on some hosted instances if `auth` schema is locked down, but usually fine in SQL Editor.
    -- We use a dummy email/password hash.
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN
        INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role)
        VALUES
            ('ac90c0e1-a5a6-4332-bab1-d817cc484243', 'encoder_ncr@bfp.gov.ph', 'dummyhash', NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW(), 'authenticated'),
            ('0231f88d-a873-46e2-91d5-8b48de9eb8d9', 'validator_ncr@bfp.gov.ph', 'dummyhash', NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW(), 'authenticated'),
            ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380003', 'analyst_nhq@bfp.gov.ph', 'dummyhash', NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW(), 'authenticated'),
            ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'admin_nhq@bfp.gov.ph', 'dummyhash', NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW(), 'authenticated')
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;


INSERT INTO wims.users (user_id, username, role, assigned_region_id, is_active) VALUES
('ac90c0e1-a5a6-4332-bab1-d817cc484243', 'encoder_ncr', 'ENCODER', 1, TRUE),
('0231f88d-a873-46e2-91d5-8b48de9eb8d9', 'validator_ncr', 'VALIDATOR', 1, TRUE),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380003', 'analyst_nhq', 'ANALYST', 1, TRUE),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'admin_nhq', 'ADMIN', 1, TRUE); -- Admin assigned to NCR but effectively global via role


-- 3. Incident Data

-- Data Import Batches (NCR)
INSERT INTO wims.data_import_batches (batch_id, region_id, uploaded_by, record_count, batch_checksum_hash, sync_status) VALUES
(101, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 5, 'sha256_dummy_hash_1', 'COMPLETED'),
(102, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 3, 'sha256_dummy_hash_2', 'PENDING'),
(103, 1, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 10, 'sha256_dummy_hash_3', 'COMPLETED');

-- Fire Incidents
-- Statuses: DRAFT, PENDING, VERIFIED, REJECTED
INSERT INTO wims.fire_incidents (incident_id, import_batch_id, encoder_id, region_id, verification_status, is_archived) VALUES
(1001, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1002, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'PENDING', FALSE),
(1003, 102, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'DRAFT', FALSE),
(1004, 102, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'REJECTED', FALSE),
(1005, 103, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', TRUE), -- Archived
(1006, 103, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1007, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1008, 102, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'PENDING', FALSE),
(1009, 103, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE),
(1010, 101, 'ac90c0e1-a5a6-4332-bab1-d817cc484243', 1, 'VERIFIED', FALSE);

-- Incident Non-Sensitive Details
INSERT INTO wims.incident_nonsensitive_details (incident_id, city_id, barangay, alarm_level, general_category, specific_type, civilian_injured, estimated_damage_php) VALUES
(1001, 1, 'Batasan Hills', '1st Alarm', 'STRUCTURAL', 'Residential', 0, 50000.00),
(1002, 2, 'Tondo', '3rd Alarm', 'STRUCTURAL', 'Mercantile', 2, 1500000.00),
(1003, 3, 'Poblacion', 'Task Force Alpha', 'STRUCTURAL', 'Mixed Occupancies', 0, 0.00), -- Draft
(1004, 1, 'Cubao', '1st Alarm', 'NON_STRUCTURAL', 'Rubbish Fire', 0, 1000.00),
(1005, 2, 'Sampaloc', '2nd Alarm', 'STRUCTURAL', 'Single and Two Family Dwelling', 1, 200000.00),
(1006, 3, 'Makati CBD', '1st Alarm', 'STRUCTURAL', 'Business', 0, 50000.00),
(1007, 1, 'EDSA', '2nd Alarm', 'VEHICULAR', 'Automobile', 1, 300000.00),
(1008, 2, 'Port Area', '3rd Alarm', 'VEHICULAR', 'Truck', 0, 1500000.00),
(1009, 3, 'Forbes Park', '1st Alarm', 'NON_STRUCTURAL', 'Grass Fire', 0, 5000.00),
(1010, 1, 'Diliman', 'Task Force Bravo', 'STRUCTURAL', 'Educational', 0, 5000000.00);


-- Incident Sensitive Details (PII)
-- Note: In real app, these might be encrypted client-side. Here plain text for seed.
INSERT INTO wims.incident_sensitive_details (incident_id, caller_name, caller_number, street_address, narrative_report, disposition_status) VALUES
(1001, 'Juan Dela Cruz', '09171234567', 'Lot 1 Blk 2, Batasan Hills', 'Fire started at kitchen...', 'Resolved'),
(1002, 'Maria Clara', '09187654321', '123 Rizal Ave, Tondo', 'Suspected electrical overload...', 'Under Investigation'),
(1003, 'Jose Rizal', '09190000000', '456 JP Rizal St, Makati', 'Smoke verified, false alarm...', 'Draft Assessment'),
(1004, 'Andres B', '09201112222', 'Aurora Blvd, Cubao', 'Small rubbish fire near mrt...', 'Rejected'),
(1005, 'Emilio A', '09213334444', '789 España Blvd, Sampaloc', 'Old house fire...', 'Resolved'),
(1006, 'Lapu Lapu', '09224445555', 'Ayala Ave, Makati', 'Office building fire alarm...', 'Resolved'),
(1007, 'Gabriela S', '09235556666', 'EDSA, Quezon City', 'Car caught fire on highway...', 'Under Investigation'),
(1008, 'Antonio L', '09246667777', 'Pier 4, Port Area', 'Cargo truck engine fire...', 'Resolved'),
(1009, 'Melchora A', '09257778888', 'McKinley Rd, Forbes Park', 'Dry grass burning near wall...', 'Resolved'),
(1010, 'Apolinario M', '09268889999', 'UP Campus, Diliman', 'Laboratory chemicals reacted...', 'Resolved');


-- Involved Parties & Responding Units
INSERT INTO wims.involved_parties (incident_id, full_name, involvement_type, age, gender) VALUES
(1001, 'Pedro Penduko', 'OWNER', 45, 'MALE'),
(1002, 'Sisa Crazy', 'VICTIM', 30, 'FEMALE');

INSERT INTO wims.responding_units (incident_id, station_name, engine_number, responder_type, arrival_dt) VALUES
(1001, 'Batasan Fire Station', 'E-123', 'BFP', NOW() - INTERVAL '1 hour'),
(1002, 'Tondo Fire Station', 'E-456', 'BFP', NOW() - INTERVAL '2 hours'),
(1006, 'Makati Fire Station', 'E-789', 'BFP', NOW() - INTERVAL '5 hours'),
(1007, 'QC Fire Station', 'E-333', 'BFP', NOW() - INTERVAL '6 hours'),
(1008, 'Manila Fire Station', 'E-111', 'BFP', NOW() - INTERVAL '7 hours'),
(1009, 'Makati Fire Station', 'E-222', 'BFP', NOW() - INTERVAL '8 hours'),
(1010, 'Diliman Fire Station', 'E-444', 'BFP', NOW() - INTERVAL '9 hours');


-- 4. Logs & Audit Trails

-- Security Threat Logs (Suricata-style)
INSERT INTO wims.security_threat_logs (timestamp, source_ip, destination_ip, suricata_sid, severity_level, raw_payload, xai_narrative, xai_confidence) VALUES
(NOW() - INTERVAL '5 minutes', '192.168.1.100', '10.0.0.5', 2001219, 'Medium', 'GET /admin/login HTTP/1.1...', 'Potential brute force attempt detected.', 0.85),
(NOW() - INTERVAL '10 minutes', '45.33.22.11', '10.0.0.5', 2100498, 'High', 'SELECT * FROM users...', 'SQL Injection pattern matched in query param.', 0.98),
(NOW() - INTERVAL '1 hour', '192.168.1.105', '10.0.0.5', 2012345, 'Low', 'PING request...', 'ICMP Echo Request.', 0.20),
(NOW() - INTERVAL '2 hours', '172.16.0.4', '10.0.0.5', 2023456, 'Medium', 'POST /upload.php...', 'Suspicious file upload signature.', 0.75),
(NOW() - INTERVAL '1 day', '10.0.0.2', '10.0.0.5', 2000001, 'Low', 'Internal extensive scan...', 'Likely internal vulnerability scanner.', 0.10);


-- System Audit Trails
INSERT INTO wims.system_audit_trails (user_id, action_type, table_affected, record_id, ip_address, user_agent, timestamp) VALUES
('ac90c0e1-a5a6-4332-bab1-d817cc484243', 'LOGIN', 'auth', NULL, '192.168.1.50', 'Mozilla/5.0...', NOW() - INTERVAL '3 hours'),
('ac90c0e1-a5a6-4332-bab1-d817cc484243', 'INSERT', 'fire_incidents', 1001, '192.168.1.50', 'Mozilla/5.0...', NOW() - INTERVAL '2 hours'),
('0231f88d-a873-46e2-91d5-8b48de9eb8d9', 'LOGIN', 'auth', NULL, '192.168.1.51', 'Mozilla/5.0...', NOW() - INTERVAL '1 hour'),
('0231f88d-a873-46e2-91d5-8b48de9eb8d9', 'UPDATE', 'fire_incidents', 1001, '192.168.1.51', 'Mozilla/5.0...', NOW() - INTERVAL '50 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'LOGIN', 'auth', NULL, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '10 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'INSERT', 'fire_incidents', 1006, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '9 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'INSERT', 'fire_incidents', 1007, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '8 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'INSERT', 'fire_incidents', 1008, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '7 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'INSERT', 'fire_incidents', 1009, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '6 minutes'),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'INSERT', 'fire_incidents', 1010, '10.0.0.100', 'Mozilla/5.0...', NOW() - INTERVAL '5 minutes');

