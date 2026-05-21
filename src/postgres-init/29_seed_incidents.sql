-- 29_seed_incidents.sql
-- Dependencies: 21_all_regions.sql, 28_analytics_geography_denorm.sql
-- Idempotent: YES
-- Purpose: deterministic verified incident data for analyst dashboard/export flows.

BEGIN;

-- Ensure the regions used below exist even when this file is run manually.
INSERT INTO wims.ref_regions (region_id, region_name, region_code)
VALUES
    (1, 'National Capital Region', 'NCR'),
    (6, 'Region IV-A - CALABARZON', 'IV-A'),
    (8, 'Region V - Bicol Region', 'V')
ON CONFLICT (region_code) DO UPDATE
    SET region_name = EXCLUDED.region_name;

-- Keep the serial sequence ahead of deterministic region IDs.
SELECT setval(
    'wims.ref_regions_region_id_seq',
    GREATEST((SELECT COALESCE(MAX(region_id), 1) FROM wims.ref_regions), 18),
    true
);

-- One deterministic import batch for all seeded incidents.
WITH batch AS (
    INSERT INTO wims.data_import_batches (
        region_id,
        uploaded_by,
        record_count,
        batch_checksum_hash,
        sync_status
    )
    SELECT
        1,
        '11111111-1111-4111-8111-111111111111'::uuid,
        12,
        'seed-incidents-2026-05-16',
        'SEEDED'
    WHERE NOT EXISTS (
        SELECT 1
        FROM wims.data_import_batches
        WHERE batch_checksum_hash = 'seed-incidents-2026-05-16'
    )
    RETURNING batch_id
)
SELECT batch_id
FROM batch;

DO $$
DECLARE
    seed_batch_id INTEGER;
    seed_row RECORD;
    seeded_incident_id INTEGER;
BEGIN
    SELECT batch_id
    INTO seed_batch_id
    FROM wims.data_import_batches
    WHERE batch_checksum_hash = 'seed-incidents-2026-05-16'
    ORDER BY batch_id
    LIMIT 1;

    FOR seed_row IN
        SELECT *
        FROM (
            VALUES
                (
                    'AFOR-SEED-NCR-QC01-STR-JAN-2026-0001',
                    1, 'NCR', 'Metro Manila', 'Quezon City', 'Batasan Hills',
                    121.0521, 14.6869, '2026-01-08 09:12:00+08'::timestamptz,
                    'Second Alarm', 'STRUCTURAL', 'Residential', 'Electrical ignition',
                    'Partial', 2, 5, 18, 0, 0, 1, 0, 42, 185000.00,
                    'Quezon City Fire Station 1', 'QC01', 'STR'
                ),
                (
                    'AFOR-SEED-NCR-MNL1-STR-JAN-2026-0002',
                    1, 'NCR', 'Metro Manila', 'Manila', 'Tondo',
                    120.9687, 14.6176, '2026-01-16 22:41:00+08'::timestamptz,
                    'Third Alarm', 'STRUCTURAL', 'Commercial', 'Open flame',
                    'Major', 6, 19, 63, 2, 0, 0, 0, 71, 950000.00,
                    'Manila Fire Station 2', 'MNL1', 'STR'
                ),
                (
                    'AFOR-SEED-NCR-MKT1-VEH-FEB-2026-0003',
                    1, 'NCR', 'Metro Manila', 'Makati', 'Poblacion',
                    121.0299, 14.5655, '2026-02-03 18:05:00+08'::timestamptz,
                    'First Alarm', 'VEHICULAR', 'Vehicle fire', 'Engine compartment',
                    'Contained', 0, 0, 0, 0, 0, 0, 0, 18, 75000.00,
                    'Makati Central Fire Station', 'MKT1', 'VEH'
                ),
                (
                    'AFOR-SEED-NCR-PAS1-STR-FEB-2026-0004',
                    1, 'NCR', 'Metro Manila', 'Pasig', 'San Antonio',
                    121.0614, 14.5821, '2026-02-21 14:27:00+08'::timestamptz,
                    'Task Force Bravo', 'STRUCTURAL', 'High-rise', 'Kitchen fire',
                    'Major', 4, 12, 41, 1, 0, 2, 0, 64, 1325000.00,
                    'Pasig City Fire Station', 'PAS1', 'STR'
                ),
                (
                    'AFOR-SEED-NCR-MUN1-NON-MAR-2026-0005',
                    1, 'NCR', 'Metro Manila', 'Muntinlupa', 'Alabang',
                    121.0437, 14.4231, '2026-03-04 07:55:00+08'::timestamptz,
                    'First Alarm', 'NON_STRUCTURAL', 'Grass fire', 'Open burning',
                    'Contained', 0, 0, 0, 0, 0, 0, 0, 21, 12000.00,
                    'Muntinlupa Fire Station', 'MUN1', 'NON'
                ),
                (
                    'AFOR-SEED-NCR-CAL1-STR-MAR-2026-0006',
                    1, 'NCR', 'Metro Manila', 'Caloocan', 'Bagong Silang',
                    121.0445, 14.7764, '2026-03-17 02:18:00+08'::timestamptz,
                    'General Alarm', 'STRUCTURAL', 'Residential cluster', 'Candle',
                    'Major', 12, 31, 109, 3, 1, 4, 0, 96, 2850000.00,
                    'Caloocan Fire Station', 'CAL1', 'STR'
                ),
                (
                    'AFOR-SEED-IVA-LIP1-STR-JAN-2026-0007',
                    6, 'IV-A', 'Batangas', 'Lipa City', 'Sabang',
                    121.1624, 13.9411, '2026-01-22 11:33:00+08'::timestamptz,
                    'Second Alarm', 'STRUCTURAL', 'Warehouse', 'Electrical ignition',
                    'Partial', 1, 1, 7, 0, 0, 0, 0, 53, 640000.00,
                    'Lipa City Fire Station', 'LIP1', 'STR'
                ),
                (
                    'AFOR-SEED-IVA-ANT1-NON-FEB-2026-0008',
                    6, 'IV-A', 'Rizal', 'Antipolo City', 'Cupang',
                    121.1762, 14.5840, '2026-02-12 15:49:00+08'::timestamptz,
                    'First Alarm', 'NON_STRUCTURAL', 'Rubbish fire', 'Open burning',
                    'Contained', 0, 0, 0, 0, 0, 0, 0, 25, 18000.00,
                    'Antipolo Fire Station', 'ANT1', 'NON'
                ),
                (
                    'AFOR-SEED-IVA-CAB1-VEH-MAR-2026-0009',
                    6, 'IV-A', 'Laguna', 'Cabuyao', 'Banay-Banay',
                    121.1251, 14.2476, '2026-03-09 20:16:00+08'::timestamptz,
                    'Second Alarm', 'VEHICULAR', 'Truck fire', 'Fuel leak',
                    'Partial', 0, 0, 0, 1, 0, 0, 0, 38, 315000.00,
                    'Cabuyao Fire Station', 'CAB1', 'VEH'
                ),
                (
                    'AFOR-SEED-V-LEG1-STR-JAN-2026-0010',
                    8, 'V', 'Albay', 'Legazpi City', 'Rawis',
                    123.7462, 13.1575, '2026-01-29 04:42:00+08'::timestamptz,
                    'Third Alarm', 'STRUCTURAL', 'Mixed occupancy', 'Cooking equipment',
                    'Major', 5, 11, 36, 1, 0, 1, 0, 67, 880000.00,
                    'Legazpi City Fire Station', 'LEG1', 'STR'
                ),
                (
                    'AFOR-SEED-V-NAG1-STR-FEB-2026-0011',
                    8, 'V', 'Camarines Sur', 'Naga City', 'Concepcion Pequena',
                    123.1948, 13.6297, '2026-02-24 13:10:00+08'::timestamptz,
                    'Second Alarm', 'STRUCTURAL', 'School', 'Electrical ignition',
                    'Partial', 1, 0, 0, 0, 0, 0, 0, 44, 420000.00,
                    'Naga City Fire Station', 'NAG1', 'STR'
                ),
                (
                    'AFOR-SEED-V-SOR1-NON-MAR-2026-0012',
                    8, 'V', 'Sorsogon', 'Sorsogon City', 'Bitan-o',
                    124.0039, 12.9742, '2026-03-28 16:36:00+08'::timestamptz,
                    'First Alarm', 'NON_STRUCTURAL', 'Wildland edge', 'Grass and brush',
                    'Contained', 0, 0, 0, 0, 0, 0, 0, 31, 26000.00,
                    'Sorsogon City Fire Station', 'SOR1', 'NON'
                )
        ) AS s(
            reference_number,
            region_id,
            region_code,
            province_name,
            municipality_name,
            barangay_name,
            lon,
            lat,
            notification_dt,
            alarm_level,
            general_category,
            sub_category,
            fire_origin,
            extent_of_damage,
            structures_affected,
            households_affected,
            individuals_affected,
            civilian_injured,
            civilian_deaths,
            firefighter_injured,
            firefighter_deaths,
            total_response_time_minutes,
            estimated_damage_php,
            fire_station_name,
            station_code,
            incident_type_code
        )
    LOOP
        SELECT incident_id
        INTO seeded_incident_id
        FROM wims.fire_incidents
        WHERE reference_number = seed_row.reference_number;

        IF seeded_incident_id IS NULL THEN
            INSERT INTO wims.fire_incidents (
                import_batch_id,
                encoder_id,
                region_id,
                location,
                verification_status,
                is_archived,
                reference_number,
                incident_type_code,
                created_at,
                updated_at
            )
            VALUES (
                seed_batch_id,
                '11111111-1111-4111-8111-111111111111'::uuid,
                seed_row.region_id,
                ST_SetSRID(ST_MakePoint(seed_row.lon, seed_row.lat), 4326)::geography,
                'VERIFIED',
                FALSE,
                seed_row.reference_number,
                seed_row.incident_type_code,
                seed_row.notification_dt,
                seed_row.notification_dt
            )
            RETURNING incident_id INTO seeded_incident_id;
        ELSE
            UPDATE wims.fire_incidents
            SET
                import_batch_id = seed_batch_id,
                region_id = seed_row.region_id,
                location = ST_SetSRID(ST_MakePoint(seed_row.lon, seed_row.lat), 4326)::geography,
                verification_status = 'VERIFIED',
                is_archived = FALSE,
                incident_type_code = seed_row.incident_type_code,
                updated_at = now()
            WHERE incident_id = seeded_incident_id;
        END IF;

        DELETE FROM wims.incident_nonsensitive_details
        WHERE incident_id = seeded_incident_id;

        INSERT INTO wims.incident_nonsensitive_details (
            incident_id,
            notification_dt,
            alarm_level,
            general_category,
            sub_category,
            responder_type,
            fire_origin,
            extent_of_damage,
            structures_affected,
            households_affected,
            individuals_affected,
            civilian_injured,
            civilian_deaths,
            firefighter_injured,
            firefighter_deaths,
            total_response_time_minutes,
            total_gas_consumed_liters,
            estimated_damage_php,
            fire_station_name,
            station_code,
            city_municipality,
            province_district,
            resources_deployed,
            alarm_timeline,
            problems_encountered,
            recommendations,
            stage_of_fire,
            extent_total_floor_area_sqm,
            extent_total_land_area_hectares,
            vehicles_affected
        )
        VALUES (
            seeded_incident_id,
            seed_row.notification_dt,
            seed_row.alarm_level,
            seed_row.general_category,
            seed_row.sub_category,
            'BFP',
            seed_row.fire_origin,
            seed_row.extent_of_damage,
            seed_row.structures_affected,
            seed_row.households_affected,
            seed_row.individuals_affected,
            seed_row.civilian_injured,
            seed_row.civilian_deaths,
            seed_row.firefighter_injured,
            seed_row.firefighter_deaths,
            seed_row.total_response_time_minutes,
            ROUND((8 + seed_row.total_response_time_minutes * 0.45)::numeric, 2),
            seed_row.estimated_damage_php,
            seed_row.fire_station_name,
            seed_row.station_code,
            seed_row.municipality_name,
            seed_row.province_name,
            jsonb_build_object('engine', 1, 'ambulance', 1),
            jsonb_build_object(
                'notification', seed_row.notification_dt,
                'arrival', seed_row.notification_dt + (seed_row.total_response_time_minutes || ' minutes')::interval
            ),
            '[]'::jsonb,
            'Seeded record for analyst dashboard and export testing.',
            'Fire Out',
            CASE WHEN seed_row.general_category = 'STRUCTURAL' THEN 120 + seed_row.structures_affected * 35 ELSE 0 END,
            CASE WHEN seed_row.general_category = 'NON_STRUCTURAL' THEN 0.2 ELSE 0 END,
            CASE WHEN seed_row.general_category = 'VEHICULAR' THEN 1 ELSE 0 END
        );

        DELETE FROM wims.incident_sensitive_details
        WHERE incident_id = seeded_incident_id;

        INSERT INTO wims.incident_sensitive_details (
            incident_id,
            street_address,
            landmark,
            caller_name,
            caller_number,
            receiver_name,
            owner_name,
            establishment_name,
            narrative_report,
            disposition,
            disposition_prepared_by,
            disposition_noted_by,
            personnel_on_duty,
            other_personnel,
            casualty_details,
            is_icp_present,
            icp_location
        )
        VALUES (
            seeded_incident_id,
            seed_row.barangay_name || ', ' || seed_row.municipality_name,
            seed_row.fire_station_name,
            'Seed Caller',
            '09990000000',
            'Seed Receiver',
            'Seed Owner',
            seed_row.sub_category,
            'Deterministic seeded incident for local analyst workflows.',
            'Closed',
            'Seed Duty Officer',
            'Seed Fire Marshal',
            jsonb_build_array(jsonb_build_object('name', 'Seed Crew', 'role', 'Responder')),
            '[]'::jsonb,
            jsonb_build_array(
                jsonb_build_object(
                    'civilian_injured', seed_row.civilian_injured,
                    'civilian_deaths', seed_row.civilian_deaths,
                    'firefighter_injured', seed_row.firefighter_injured,
                    'firefighter_deaths', seed_row.firefighter_deaths
                )
            ),
            TRUE,
            seed_row.fire_station_name
        );

        INSERT INTO wims.incident_verification_history (
            incident_id,
            target_type,
            target_id,
            action_by_user_id,
            previous_status,
            new_status,
            notes,
            action_label,
            comments,
            action_timestamp
        )
        SELECT
            seeded_incident_id,
            'OFFICIAL',
            seeded_incident_id,
            '22222222-2222-4222-8222-222222222222'::uuid,
            'PENDING_VALIDATION',
            'VERIFIED',
            'Seeded as VERIFIED for analyst dashboard and export testing.',
            'seed_verified',
            'Seeded as VERIFIED for analyst dashboard and export testing.',
            seed_row.notification_dt + interval '2 hours'
        WHERE NOT EXISTS (
            SELECT 1
            FROM wims.incident_verification_history
            WHERE incident_id = seeded_incident_id
              AND action_label = 'seed_verified'
        );

        INSERT INTO wims.analytics_incident_facts (
            incident_id,
            region_id,
            location,
            notification_dt,
            notification_date,
            alarm_level,
            general_category,
            civilian_injured,
            civilian_deaths,
            firefighter_injured,
            firefighter_deaths,
            total_response_time_minutes,
            estimated_damage_php,
            fire_station_name,
            barangay_name,
            municipality_name,
            province_name,
            synced_at
        )
        VALUES (
            seeded_incident_id,
            seed_row.region_id,
            ST_SetSRID(ST_MakePoint(seed_row.lon, seed_row.lat), 4326)::geography,
            seed_row.notification_dt,
            seed_row.notification_dt::date,
            seed_row.alarm_level,
            seed_row.general_category,
            seed_row.civilian_injured,
            seed_row.civilian_deaths,
            seed_row.firefighter_injured,
            seed_row.firefighter_deaths,
            seed_row.total_response_time_minutes,
            seed_row.estimated_damage_php,
            seed_row.fire_station_name,
            seed_row.barangay_name,
            seed_row.municipality_name,
            seed_row.province_name,
            now()
        )
        ON CONFLICT (incident_id) DO UPDATE SET
            region_id = EXCLUDED.region_id,
            location = EXCLUDED.location,
            notification_dt = EXCLUDED.notification_dt,
            notification_date = EXCLUDED.notification_date,
            alarm_level = EXCLUDED.alarm_level,
            general_category = EXCLUDED.general_category,
            civilian_injured = EXCLUDED.civilian_injured,
            civilian_deaths = EXCLUDED.civilian_deaths,
            firefighter_injured = EXCLUDED.firefighter_injured,
            firefighter_deaths = EXCLUDED.firefighter_deaths,
            total_response_time_minutes = EXCLUDED.total_response_time_minutes,
            estimated_damage_php = EXCLUDED.estimated_damage_php,
            fire_station_name = EXCLUDED.fire_station_name,
            barangay_name = EXCLUDED.barangay_name,
            municipality_name = EXCLUDED.municipality_name,
            province_name = EXCLUDED.province_name,
            synced_at = now();
    END LOOP;
END $$;

-- Idempotent cleanup: fix any pre-existing seed rows that still carry numeric alarm_level
-- values ('1','2','3') from before the seed VALUES were corrected.
UPDATE wims.incident_nonsensitive_details AS nd
SET alarm_level = CASE nd.alarm_level
    WHEN '1' THEN 'First Alarm'
    WHEN '2' THEN 'Second Alarm'
    WHEN '3' THEN 'Third Alarm'
    WHEN '4' THEN 'Fourth Alarm'
    WHEN '5' THEN 'Fifth Alarm'
    ELSE nd.alarm_level
END
FROM wims.fire_incidents fi
WHERE fi.incident_id = nd.incident_id
  AND fi.reference_number LIKE 'AFOR-SEED-%'
  AND nd.alarm_level ~ '^[1-5]$';

REFRESH MATERIALIZED VIEW wims.mv_incident_counts_daily;
REFRESH MATERIALIZED VIEW wims.mv_incident_by_region;
REFRESH MATERIALIZED VIEW wims.mv_incident_by_barangay;
REFRESH MATERIALIZED VIEW wims.mv_incident_type_distribution;

COMMIT;
