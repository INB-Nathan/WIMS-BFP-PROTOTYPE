-- 38_seed_security_threat_logs.sql
-- Idempotent Suricata threat telemetry seed rows for local/VPS demo data.

BEGIN;

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
  resolved_at
)
SELECT
  now() - (v.minutes_ago || ' minutes')::interval,
  v.source_ip,
  v.destination_ip,
  v.suricata_sid,
  v.severity_level,
  v.raw_payload,
  v.xai_narrative,
  v.xai_confidence,
  v.admin_action_taken,
  CASE WHEN v.resolved THEN now() - interval '5 minutes' ELSE NULL END
FROM (
  VALUES
    (
      3,
      '203.0.113.44',
      '10.10.0.15',
      2024218,
      'HIGH',
      '{"timestamp":"2026-05-26T05:09:00.000000+0000","event_type":"alert","src_ip":"203.0.113.44","src_port":51544,"dest_ip":"10.10.0.15","dest_port":443,"proto":"TCP","alert":{"signature_id":2024218,"signature":"ET WEB_SERVER Possible SQL Injection Attempt UNION SELECT","category":"Web Application Attack","severity":3}}',
      'Likely SQL injection probe against the public web edge. Review nginx/backend access logs for matching URI and block repeated source IPs if confirmed.',
      0.91::double precision,
      NULL,
      FALSE
    ),
    (
      9,
      '198.51.100.77',
      '10.10.0.20',
      2010935,
      'HIGH',
      '{"timestamp":"2026-05-26T05:03:00.000000+0000","event_type":"alert","src_ip":"198.51.100.77","src_port":43812,"dest_ip":"10.10.0.20","dest_port":22,"proto":"TCP","alert":{"signature_id":2010935,"signature":"ET SCAN Potential SSH Scan","category":"Attempted Information Leak","severity":3}}',
      'External SSH scan pattern. UFW currently allows SSH; consider provider firewall source restriction or fail2ban if repeated.',
      0.88::double precision,
      'Monitoring; SSH remains limited to port 22 with UFW allow rule.',
      FALSE
    ),
    (
      16,
      '192.0.2.19',
      '10.10.0.15',
      2100498,
      'MEDIUM',
      '{"timestamp":"2026-05-26T04:56:00.000000+0000","event_type":"alert","src_ip":"192.0.2.19","src_port":53211,"dest_ip":"10.10.0.15","dest_port":443,"proto":"TCP","alert":{"signature_id":2100498,"signature":"GPL WEB_SERVER 403 Forbidden","category":"Web Application Activity","severity":2}}',
      'Medium-confidence web probing event. Correlate with HTTP status spikes and request paths.',
      0.72::double precision,
      NULL,
      FALSE
    ),
    (
      23,
      '198.51.100.23',
      '10.10.0.15',
      2027758,
      'MEDIUM',
      '{"timestamp":"2026-05-26T04:49:00.000000+0000","event_type":"alert","src_ip":"198.51.100.23","src_port":50191,"dest_ip":"10.10.0.15","dest_port":80,"proto":"TCP","alert":{"signature_id":2027758,"signature":"ET POLICY curl User-Agent Outbound","category":"Potential Corporate Privacy Violation","severity":2}}',
      NULL,
      NULL::double precision,
      'Reviewed as benign scanner traffic after HTTPS redirect hardening.',
      TRUE
    ),
    (
      31,
      '203.0.113.88',
      '10.10.0.15',
      2001219,
      'LOW',
      '{"timestamp":"2026-05-26T04:41:00.000000+0000","event_type":"alert","src_ip":"203.0.113.88","src_port":60122,"dest_ip":"10.10.0.15","dest_port":443,"proto":"TCP","alert":{"signature_id":2001219,"signature":"ET SCAN Nmap Scripting Engine User-Agent Detected","category":"Attempted Information Leak","severity":1}}',
      'Low severity reconnaissance indicator. Keep for trend visibility.',
      0.64::double precision,
      NULL,
      FALSE
    ),
    (
      45,
      '192.0.2.55',
      '10.10.0.31',
      2013504,
      'LOW',
      '{"timestamp":"2026-05-26T04:27:00.000000+0000","event_type":"alert","src_ip":"192.0.2.55","src_port":49152,"dest_ip":"10.10.0.31","dest_port":53,"proto":"UDP","alert":{"signature_id":2013504,"signature":"ET DNS Query for Suspicious TLD","category":"Potentially Bad Traffic","severity":1}}',
      NULL,
      NULL::double precision,
      NULL,
      FALSE
    )
) AS v(
  minutes_ago,
  source_ip,
  destination_ip,
  suricata_sid,
  severity_level,
  raw_payload,
  xai_narrative,
  xai_confidence,
  admin_action_taken,
  resolved
)
WHERE NOT EXISTS (
  SELECT 1
  FROM wims.security_threat_logs existing
  WHERE existing.source_ip = v.source_ip
    AND existing.destination_ip = v.destination_ip
    AND existing.suricata_sid = v.suricata_sid
);

COMMIT;
