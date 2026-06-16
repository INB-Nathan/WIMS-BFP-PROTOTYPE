-- Seed anomaly_detections rows for the System Admin anomaly dashboard.
-- Populates varied anomaly types, statuses, severities, and timestamps
-- so the dashboard has data for pagination, filters, and aggregate counts.
--
-- subject_user_id references existing test users from 03_users.sql.
-- Uses ON CONFLICT (anomaly_type, dedup_key) DO NOTHING so the script
-- is safe to re-run.

INSERT INTO wims.anomaly_detections
    (anomaly_type, subject_user_id, severity, details, detected_at, status, dedup_key)
VALUES
    -- BULK_DELETE, HIGH, NEW (1)
    ('BULK_DELETE',
     '11111111-1111-4111-8111-111111111111'::uuid,
     'HIGH',
     '{"count": 12, "affected_table": "wims.incidents", "window_minutes": 5}',
     NOW() - INTERVAL '10 minutes',
     'NEW',
     'seed:bulk_delete:1'),

    -- BULK_DELETE, MEDIUM, ACKNOWLEDGED (2)
    ('BULK_DELETE',
     'ee000002-0000-4002-8002-000000000002'::uuid,
     'MEDIUM',
     '{"count": 7, "affected_table": "wims.incidents", "window_minutes": 5}',
     NOW() - INTERVAL '30 minutes',
     'ACKNOWLEDGED',
     'seed:bulk_delete:2'),

    -- BULK_DELETE, HIGH, RESOLVED (3)
    ('BULK_DELETE',
     '55555555-5555-4555-8555-555555555555'::uuid,
     'HIGH',
     '{"count": 15, "affected_table": "wims.system_audit_trails", "window_minutes": 3}',
     NOW() - INTERVAL '2 hours',
     'RESOLVED',
     'seed:bulk_delete:3'),

    -- OFF_HOURS, LOW, NEW (4)
    ('OFF_HOURS',
     NULL,
     'LOW',
     '{"action_type": "LOGIN", "local_hour": 3, "user_timezone": "Asia/Manila"}',
     NOW() - INTERVAL '1 hour',
     'NEW',
     'seed:off_hours:1'),

    -- OFF_HOURS, MEDIUM, NEW (5)
    ('OFF_HOURS',
     '11111111-1111-4111-8111-111111111111'::uuid,
     'MEDIUM',
     '{"action_type": "PII_EXPORT", "audit_id": 42, "local_hour": 2}',
     NOW() - INTERVAL '3 hours',
     'NEW',
     'seed:off_hours:2'),

    -- OFF_HOURS, MEDIUM, ACKNOWLEDGED (6)
    ('OFF_HOURS',
     'ee000003-0000-4003-8003-000000000003'::uuid,
     'MEDIUM',
     '{"action_type": "BATCH_UPDATE", "audit_id": 88, "local_hour": 1}',
     NOW() - INTERVAL '6 hours',
     'ACKNOWLEDGED',
     'seed:off_hours:3'),

    -- PRIVILEGE_ESCALATION, HIGH, NEW (7)
    ('PRIVILEGE_ESCALATION',
     'ee000004-0000-4004-8004-000000000004'::uuid,
     'HIGH',
     '{"action_type": "ROLE_CHANGE", "old_role": "REGIONAL_ENCODER", "new_role": "SYSTEM_ADMIN"}',
     NOW() - INTERVAL '45 minutes',
     'NEW',
     'seed:priv_esc:1'),

    -- PRIVILEGE_ESCALATION, CRITICAL, NEW (8)
    ('PRIVILEGE_ESCALATION',
     NULL,
     'CRITICAL',
     '{"action_type": "DIRECT_DB_WRITE", "table": "wims.users", "via": "psql"}',
     NOW() - INTERVAL '4 hours',
     'NEW',
     'seed:priv_esc:2'),

    -- PRIVILEGE_ESCALATION, HIGH, ACKNOWLEDGED (9)
    ('PRIVILEGE_ESCALATION',
     '55555555-5555-4555-8555-555555555555'::uuid,
     'HIGH',
     '{"action_type": "MFA_BYPASS", "method": "backup_code"}',
     NOW() - INTERVAL '8 hours',
     'ACKNOWLEDGED',
     'seed:priv_esc:3'),

    -- RAPID_IP_SWITCH, MEDIUM, NEW (10)
    ('RAPID_IP_SWITCH',
     '11111111-1111-4111-8111-111111111111'::uuid,
     'MEDIUM',
     '{"distinct_ip_count": 3, "window_minutes": 15, "ips": ["192.168.1.10", "10.0.0.50", "203.0.113.5"]}',
     NOW() - INTERVAL '20 minutes',
     'NEW',
     'seed:rapid_ip:1'),

    -- RAPID_IP_SWITCH, HIGH, ACKNOWLEDGED (11)
    ('RAPID_IP_SWITCH',
     'ee000002-0000-4002-8002-000000000002'::uuid,
     'HIGH',
     '{"distinct_ip_count": 5, "window_minutes": 10, "ips": ["1.2.3.4", "5.6.7.8", "9.10.11.12", "13.14.15.16", "17.18.19.20"]}',
     NOW() - INTERVAL '12 hours',
     'ACKNOWLEDGED',
     'seed:rapid_ip:2'),

    -- RAPID_IP_SWITCH, LOW, RESOLVED (12)
    ('RAPID_IP_SWITCH',
     NULL,
     'LOW',
     '{"distinct_ip_count": 2, "window_minutes": 30, "ips": ["10.0.0.5", "10.0.0.6"]}',
     NOW() - INTERVAL '1 day',
     'RESOLVED',
     'seed:rapid_ip:3'),

    -- SUSPICIOUS_QUERY_PATTERN, MEDIUM, NEW (13)
    ('SUSPICIOUS_QUERY_PATTERN',
     '00000000-0000-0000-0000-000000000002'::uuid,
     'MEDIUM',
     '{"query_pattern": "SELECT * FROM wims.incidents WHERE", "risk_score": 0.65}',
     NOW() - INTERVAL '90 minutes',
     'NEW',
     'seed:susp_query:1'),

    -- SUSPICIOUS_QUERY_PATTERN, LOW, RESOLVED (14)
    ('SUSPICIOUS_QUERY_PATTERN',
     NULL,
     'LOW',
     '{"query_pattern": "COUNT(*) FROM wims.users", "risk_score": 0.25}',
     NOW() - INTERVAL '3 days',
     'RESOLVED',
     'seed:susp_query:2'),

    -- BULK_DELETE, CRITICAL, NEW (15)
    ('BULK_DELETE',
     '00000000-0000-0000-0000-000000000002'::uuid,
     'CRITICAL',
     '{"count": 50, "affected_table": "wims.incidents", "window_minutes": 2}',
     NOW() - INTERVAL '5 minutes',
     'NEW',
     'seed:bulk_delete:4'),

    -- Additional rows for pagination (>20 total)
    ('BULK_DELETE',
     NULL,
     'LOW',
     '{"count": 3, "affected_table": "wims.ref_regions", "window_minutes": 10}',
     NOW() - INTERVAL '15 hours',
     'NEW',
     'seed:bulk_delete:5'),

    ('OFF_HOURS',
     'ee000005-0000-4005-8005-000000000005'::uuid,
     'LOW',
     '{"action_type": "VIEW_DASHBOARD", "local_hour": 23, "user_timezone": "Asia/Manila"}',
     NOW() - INTERVAL '18 hours',
     'RESOLVED',
     'seed:off_hours:4'),

    ('PRIVILEGE_ESCALATION',
     'ee000006-0000-4006-8006-000000000006'::uuid,
     'MEDIUM',
     '{"action_type": "PERMISSION_CHANGE", "resource": "wims.scheduled_reports"}',
     NOW() - INTERVAL '20 hours',
     'ACKNOWLEDGED',
     'seed:priv_esc:4'),

    ('RAPID_IP_SWITCH',
     '11111111-1111-4111-8111-111111111111'::uuid,
     'CRITICAL',
     '{"distinct_ip_count": 8, "window_minutes": 5, "ips": ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4", "5.5.5.5", "6.6.6.6", "7.7.7.7", "8.8.8.8"]}',
     NOW() - INTERVAL '22 hours',
     'NEW',
     'seed:rapid_ip:4'),

    ('SUSPICIOUS_QUERY_PATTERN',
     '00000000-0000-0000-0000-000000000001'::uuid,
     'HIGH',
     '{"query_pattern": "UPDATE wims.users SET role", "risk_score": 0.92}',
     NOW() - INTERVAL '23 hours',
     'NEW',
     'seed:susp_query:3')
ON CONFLICT (anomaly_type, dedup_key) DO NOTHING;
