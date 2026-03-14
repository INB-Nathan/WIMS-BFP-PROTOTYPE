-- Seed data for wims.security_threat_logs
-- This script populates the table with synthetic "Suricata-like" security events
-- and corresponding "AI" narratives for the prototype.

INSERT INTO wims.security_threat_logs (
    timestamp,
    source_ip,
    destination_ip,
    suricata_sid,
    severity_level,
    raw_payload,
    xai_narrative,
    xai_confidence,
    admin_action_taken,
    reviewed_by
) VALUES
-- 1. High Severity: SQL Injection Attempt
(
    NOW() - INTERVAL '2 hours',
    '192.168.1.105',
    '10.0.0.5',
    '2010935',
    'HIGH',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET WEB_SERVER Possible SQL Injection Attempt", "category": "Web Application Attack"}, "payload": "GET /login?user=admin%27+OR+1%3D1-- HTTP/1.1"}',
    'The model detected a classic SQL injection pattern in the URL parameters. The attacker is attempting to bypass authentication by injecting a tautology (1=1). This is a high-confidence attack signature.',
    0.95,
    NULL,
    NULL
),
-- 2. Critical Severity: Multiple Failed Logins (Brute Force)
(
    NOW() - INTERVAL '4 hours',
    '203.0.113.42',
    '10.0.0.5',
    2002911,
    'CRITICAL',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET SCAN Potential SSH Brute Force", "category": "Attempted Administrator Privilege Gain"}, "count": 50, "duration": 60}',
    'Unusual volume of authentication failures detected from a single external IP address within a short window. The behavior indicates a scripted brute-force attack targeting the SSH service.',
    0.98,
    NULL,
    NULL
),
-- 3. Low Severity: Port Scanning
(
    NOW() - INTERVAL '1 day',
    '192.168.1.50',
    '10.0.0.0/24',
    2100498,
    'LOW',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "GPL SCAN PING NMAP", "category": "Network Scan"}, "payload": "ICMP Echo Request"}',
    'Routine network scanning activity detected. The signature matches Nmap discovery probes. This is likely an internal reconnaissance or a misconfigured monitoring tool, but warrants low-level attention.',
    0.65,
    'IGNORED', -- Previously handled
    (SELECT user_id FROM wims.users WHERE role = 'SYSTEM_ADMIN' LIMIT 1) -- Assign to a sysadmin if exists, else NULL (might fail if no users)
),
-- 4. Medium Severity: XSS Attempt
(
    NOW() - INTERVAL '30 minutes',
    '172.16.0.23',
    '10.0.0.5',
    2019401,
    'MEDIUM',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET WEB_SERVER Possible XSS Attempt", "category": "Web Application Attack"}, "payload": "<script>alert(1)</script>"}',
    'The request body contains script tags typical of a Cross-Site Scripting (XSS) attack. The payload is simple, suggesting a probe or testing tool rather than a sophisticated exploit.',
    0.85,
    NULL,
    NULL
),
-- 5. Low Severity: Policy Violation (Cleartext credentials)
(
    NOW() - INTERVAL '12 hours',
    '192.168.1.12',
    '10.0.0.8',
    2002878,
    'LOW',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET POLICY Cleartext Password in HTTP Request", "category": "Policy Violation"}, "payload": "POST /api/auth HTTP/1.1 ... password=admin"}',
    'Cleartext credentials were observed on the wire. This violates security policy but does not necessarily indicate an active compromise. It requires configuration review of the client application.',
    0.99,
    NULL,
    NULL
),
-- 6. High Severity: Escalate Demo
(
    NOW() - INTERVAL '5 hours',
    '33.44.55.66',
    '10.0.0.5',
    2019402,
    'HIGH',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET EXPLOIT Possible CVE-2023-XXXX", "category": "Attempted Administrator Privilege Gain"}, "payload": "...malicious payload..."}',
    'Pattern matching newly published CVE in edge deployment. Immediate escalation required. Automated containment initiated.',
    0.91,
    NULL,
    NULL
),
-- 7. Low Severity: False Positive Demo
(
    NOW() - INTERVAL '6 hours',
    '10.0.0.100',
    '10.0.0.5',
    2100499,
    'LOW',
    '{"proto": "UDP", "event_type": "alert", "alert": {"signature": "ET MALWARE Suspicious DNS Query", "category": "A Network Trojan was detected"}, "payload": "DNS query for unknown.local"}',
    'Suspicious DNS query detected. However, upon further context analysis, this domain belongs to an internal logging service that recently updated its hostname structure. Likely benign.',
    0.45,
    NULL,
    NULL
),
-- 8. Medium Severity: Resolved Demo
(
    NOW() - INTERVAL '1 day',
    '203.0.113.88',
    '10.0.0.5',
    2002879,
    'MEDIUM',
    '{"proto": "TCP", "event_type": "alert", "alert": {"signature": "ET SCAN Directory Traversal Attempt", "category": "Web Application Attack"}, "payload": "GET /images/../../../../etc/passwd HTTP/1.1"}',
    'Classic directory traversal string in GET request. Filter blocked the request successfully, no data exfiltrated.',
    0.89,
    NULL,
    NULL
);

-- Note: The subquery for `reviewed_by` might return NULL if no SYSTEM_ADMIN exists yet, which is fine.
