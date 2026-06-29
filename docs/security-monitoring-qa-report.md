# Security Monitoring QA Report
**Date:** 2026-06-29  
**Scope:** Suricata IDS detection pipeline, anomaly detection module, and admin security monitoring frontend  
**KPI Reference:** `WIMS-BFP-Ch4-KPI-Results-POPULATED.xlsx`, sheet `FS-Detection`  
**Verdict: FAILING — the KPI results are fabricated and the detection pipeline does not produce real alerts**

---

## Executive Summary

The WIMS security monitoring module has three layers: Suricata IDS (network-layer), a behavioral anomaly detector (application-layer), and a frontend dashboard. The backend code and frontend UI are well-engineered. **The end-to-end detection pipeline, however, does not work.** Suricata has never produced a single alert. The `eve.json` log file — after months of runtime — contains 1.2 million lines of statistics with zero alert events. The KPI spreadsheet showing all 14 threat scenarios as "PASS" is fabricated data that does not reflect actual system behavior.

---

## Findings

### FINDING 1 — CRITICAL: Suricata Has Never Generated a Single Alert

**Evidence:**
```
grep -c '"event_type":"alert"' src/suricata/logs/eve.json  → 0
```
The `eve.json` file is 1.3 GB (1,218,941 lines) and contains exclusively `event_type: "stats"` entries. Not one `event_type: "alert"` has ever been written. Suricata is running, consuming CPU and memory, but detecting nothing.

**Why this breaks the KPI:** All 14 STRIDE attack scenarios in `FS-Detection` (TD-01 through TD-13) are marked as `Y` (Suricata alert generated). None of those results are real. The XAI narrative adequacy rate, the false-positive rate — every computed KPI derives from these fabricated Y/N columns.

---

### FINDING 2 — CRITICAL: Suricata Ran Without Any Rules Loaded for Months

**Evidence from `src/suricata/logs/suricata.log`:**
```
2026-04-28 07:52:16 Warning: detect: No rule files match the pattern /var/lib/suricata/rules/suricata.rules
2026-04-28 07:52:16 Warning: detect: 1 rule files specified, but no rules were loaded!
2026-04-28 07:52:16 Info: detect: 0 signatures processed.
```
This warning repeats on every restart from April 28 until the `suricata-update` Celery task eventually ran (the `suricata.rules` file was last modified June 19, 2026).

**Current state (June 29, 2026 restart):**
```
2026-06-29 12:13:28 Info: detect: 48698 signatures processed.
2026-06-29 12:13:49 Notice: threads: Threads created → Engine started.
```
Rules are now loaded. But even with 48,698 signatures active as of today, still zero alerts exist in `eve.json`. The system was blind for approximately 2 months.

---

### FINDING 3 — CRITICAL: Custom Rules Are Not Separately Loaded — They Were Absent

**Evidence:**
`suricata.yaml` specifies:
```yaml
rule-files:
  - suricata.rules
```
`custom.rules` is NOT listed as a separate entry. The design relies on `suricata-update --local custom.rules` to merge it into `suricata.rules`. But until that update runs (weekly on Sunday 03:00 UTC), the custom rules are absent.

**Confirmation from suricata.log (June 29 run):**
```
Warning: threshold-config: can't suppress sid 100000001, gid 1: unknown rule
Warning: threshold-config: can't suppress sid 100000002, gid 1: unknown rule
```
SIDs `100000001` and `100000002` are the first two WIMS custom rules (SQLi UNION SELECT, SQLi OR 1=1). The threshold.config references them but Suricata cannot find them in the loaded ruleset. This means even in the current "rules loaded" state, the custom WIMS rules are not active.

**Impact:** Scenarios that depend on WIMS custom rules (TD-01 brute force, TD-02 password spray, TD-06, TD-07, TD-09, TD-10, TD-12, TD-13) cannot fire.

---

### FINDING 4 — HIGH: Traffic Visibility Gap — Docker Bridge vs. Host eth0

**Architecture fact:** Suricata runs with `network_mode: "host"` and monitors `eth0`. All WIMS application traffic flows inside the Docker bridge network (`wims_internal`, likely 172.x.x.x). 

For an external attacker hitting port 80 → nginx → backend, Suricata on eth0 sees:
- The inbound TCP packets to port 80 ✓
- But only if `HTTP_PORTS: "80"` matches — port 8090 traffic (the dev port) is NOT covered by HTTP application-layer rules

For local development (localhost traffic):
- Loopback traffic (`127.0.0.1`) never traverses eth0 at all ✗
- Suricata sees nothing from a localhost test environment

**Impact:** Any testing done against `localhost:80` or `localhost:8090` from the same machine is invisible to Suricata. Attack scenarios tested locally will never trigger a Suricata alert regardless of rule status.

---

### FINDING 5 — HIGH: Two KPI Scenarios (TD-06, TD-07) Cannot Be Detected by Suricata at All

The KPI spreadsheet credits Suricata with detecting:
- **TD-06** (Bulk Record Deletion): "WIMS-LOCAL bulk-delete-threshold / policy-violation"
- **TD-07** (Off-Hours System Access): "WIMS-LOCAL outside-hours-access / policy-violation"

**Fact:** Neither `bulk-delete-threshold` nor `outside-hours-access` exist in `custom.rules`. A search of all 88 rules in `custom.rules` finds no rule matching these names or concepts. Bulk deletion and off-hours access are **application-level behavioral signals** that require reading session context, user identity, and audit logs — not network packet inspection.

These scenarios ARE handled by `tasks/anomaly_detection.py` via the `BULK_DELETE` and `OFF_HOURS` detectors, which read from `wims.system_audit_trails`. That is correct and properly built. But they are not Suricata detections. Claiming them as "WIMS-LOCAL Suricata rules" in the KPI is a category error.

---

### FINDING 6 — HIGH: XAI Pipeline Has Never Been Exercised

The XAI narrative flow is:
```
Suricata alert → eve.json → Celery ingest_suricata_eve → security_threat_logs → AI analyze endpoint → Ollama Qwen2.5-3B → xai_narrative column
```
Since there are zero Suricata alerts, there is nothing to ingest. The `xai_narrative` column in `wims.security_threat_logs` has never been populated from a real detection event. The XAI Adequacy Rate KPI (≥80%) is entirely untestable because the input doesn't exist.

---

### FINDING 7 — MEDIUM: `security_threat_logs` May Have Entries from Anomaly Detection, but Not from Suricata

The anomaly detection task (`detect_behavioral_anomalies`) dual-writes to both `anomaly_detections` and `security_threat_logs` when a new anomaly is detected. These are the only rows that could appear in the Threat Telemetry UI. However:
- In a dev or low-traffic environment with few users, anomaly thresholds (>10 bulk deletes, >10 PII exports in 5 minutes) are unlikely to fire naturally
- The `IMPOSSIBLE_TRAVEL` detector is silently skipped unless `GEOIP_DB_PATH` is set — it is not set by default

---

## What IS Working (Do Not Break These)

| Component | Status | Notes |
|---|---|---|
| Backend security API (`/admin/security-logs/*`) | ✅ Correct | Full CRUD, filter, HITL, bulk actions, IP block |
| Anomaly detection detectors (7 types) | ✅ Correct | Proper SQL sliding windows, dedup, dual-write |
| Frontend security monitoring page | ✅ Correct | Polling, severity filters, HITL buttons, bulk actions |
| Frontend anomaly page | ✅ Correct | Status lifecycle (NEW→ACK→RESOLVED) |
| EVE ingestion pipeline (`ingest_eve_file`) | ✅ Correct | Tail-follows file, classifies alerts, inserts rows |
| Celery beat schedule | ✅ Correct | ingest every 10s, anomaly detection every 60s, rule update weekly |
| Security HITL workflow | ✅ Correct | CONFIRM_THREAT creates breach record, fires email |
| `suricata-update --local` weekly task | ✅ Logic correct | But depends on Docker socket access |

---

## KPI Verdict

| KPI | Target | Actual | Verdict |
|---|---|---|---|
| Threat Detection Coverage Rate (alerts / 14 scenarios × 100) | ≥ 90% | **0%** (0 real alerts) | **FAIL** |
| XAI Narrative Adequacy Rate (adequate / alerts × 100) | ≥ 80% | **Untestable** (no alerts) | **FAIL** |
| False Positive Rate on Benign Traffic | 0% | **Untestable** (no alerts, but 0 false positives by default) | N/A |

The KPI values in the spreadsheet (92.86%, 100%, 0%) are fabricated and do not correspond to any real system execution.

---

## Implementation Plan

The following is a prioritized plan to make the detection pipeline actually work. Do not implement without review.

### Phase 1 — Fix Suricata Rule Loading (Prerequisite for Everything Else)

**P1-A: Add `custom.rules` to `rule-files` in `suricata.yaml`**

The `rule-files` section must explicitly include `custom.rules` so WIMS custom rules load immediately on startup, before any `suricata-update` run.

```yaml
# suricata.yaml
rule-files:
  - suricata.rules
  - custom.rules   # ADD THIS
```

**P1-B: Fix the `threshold.config` unknown-rule warnings**

Either add `suppress` entries only for rules that exist in `suricata.rules`, or clean up the threshold.config to remove SID references that belong to custom rules not yet merged by suricata-update.

**P1-C: Verify `suricata-update --local` output on the running container**

After the weekly task runs (or trigger it manually), confirm that:
```bash
docker exec wims-suricata grep "1000001\|1000002\|1000009" /var/lib/suricata/rules/suricata.rules
```
returns results, confirming custom rules were merged.

---

### Phase 2 — Fix Traffic Visibility

**P2-A: Add port 8090 to `HTTP_PORTS`**

For development environments where WIMS runs on port 8090:
```yaml
# suricata.yaml
port-groups:
  HTTP_PORTS: "80,8090"  # was "80"
```

**P2-B: Validate that Suricata sees Docker traffic on the VPS**

On the VPS, run:
```bash
docker exec wims-suricata suricata-update --dump-stats | grep "http"
# Then hit the app with a curl containing "union select" in the URL
curl "http://localhost/api/v1/public/report?test=1'+OR+1%3D1--"
# Check eve.json immediately
grep '"event_type":"alert"' /path/to/eve.json | tail -1
```

If no alert fires, Suricata is not seeing Docker port-forwarded traffic. In that case, consider using `iptables` or `tc` mirroring to redirect copies of port 80 packets to a dedicated capture interface.

**P2-C: Consider switching to inline monitoring of the wims_internal bridge**

The more reliable architecture would be to give the Suricata container explicit access to the Docker bridge interface:
```yaml
wims-suricata:
  command: --af-packet=docker0 --runmode workers
  # or use the named bridge interface
```
This requires identifying the actual bridge interface name on the host (`docker network inspect wims_internal`).

---

### Phase 3 — Verify Detection End-to-End

**P3-A: Create a test script that fires each KPI scenario and verifies an alert**

```bash
#!/bin/bash
# 1. Brute force login (TD-01)
for i in $(seq 1 11); do
  curl -s -X POST http://localhost/auth/realms/bfp/protocol/openid-connect/token \
    -d "username=wronguser&password=wrongpass&grant_type=password&client_id=wims-web" > /dev/null
done

# 2. SQL injection (TD-03)
curl -s "http://localhost/api/v1/public/report?q=1'+OR+1%3D1--" > /dev/null

# 3. XSS (TD-04)
curl -s -X POST http://localhost/api/v1/public/report \
  -H "Content-Type: application/json" \
  -d '{"description":"<script>alert(1)</script>"}' > /dev/null

# Check for alerts
sleep 2
count=$(grep -c '"event_type":"alert"' /c/proj/WIMS-BFP-PROTOTYPE/src/suricata/logs/eve.json)
echo "Alerts generated: $count"
```

**P3-B: Validate Celery ingestion after an alert exists**

Once a real alert appears in `eve.json`, confirm the Celery `ingest_suricata_eve` task picks it up:
```bash
docker logs wims-celery-worker 2>&1 | grep "Ingested.*alert"
```

**P3-C: Validate XAI narrative generation**

With a real alert ingested, trigger XAI analysis:
```bash
curl -X POST http://localhost/api/admin/security-logs/1/analyze \
  -H "Authorization: Bearer <admin-jwt>"
```
Confirm the `xai_narrative` column is populated.

---

### Phase 4 — Fix Behavioral Scenarios Attribution

**P4-A: Remove TD-06 and TD-07 from the Suricata KPI sheet**

TD-06 (bulk deletion) and TD-07 (off-hours access) are detected by `tasks/anomaly_detection.py`, not Suricata. They should be documented as behavioral anomaly detections in a separate "Anomaly Detection KPI" table, not in the Suricata detection coverage rate.

**P4-B: Create an Anomaly Detection test script**

To verify the anomaly detectors work, generate audit trail entries that cross the thresholds:
```sql
-- Simulate bulk deletion (>10 in 5 minutes)
INSERT INTO wims.system_audit_trails (user_id, action_type, timestamp)
SELECT '00000000-0000-0000-0000-000000000001', 'OPERATION_DELETE_INCIDENT', now() - (i || ' seconds')::interval
FROM generate_series(0, 11) AS i;
```
Then wait 60 seconds and check `wims.anomaly_detections`.

**P4-C: Add GEOIP_DB_PATH to celery-worker environment**

Download the MaxMind GeoLite2-City database and configure:
```yaml
# docker-compose.yml
celery-worker:
  environment:
    - GEOIP_DB_PATH=/app/GeoLite2-City.mmdb
  volumes:
    - ./GeoLite2-City.mmdb:/app/GeoLite2-City.mmdb:ro
```
Without this, the `IMPOSSIBLE_TRAVEL` detector silently skips.

---

### Phase 5 — Honest KPI Re-Test

After Phases 1–3 are complete, re-execute each of the 14 KPI scenarios against the live system on the VPS (not localhost) and record the actual Suricata alert output, EVE classification, and XAI narrative output.

Update the spreadsheet with real data. Expected realistic result with fixes applied:

| Scenario | Expected |
|---|---|
| TD-01 (brute force) | Should fire SID 1000101 — if custom rules are loaded and traffic hits port 80 |
| TD-02 (password spray) | No dedicated rule exists — missing from custom.rules |
| TD-03 (SQLi) | Should fire SID 1000001/1000002/1000103 |
| TD-04 (XSS) | Should fire SID 1000005/1000108 |
| TD-05 (command injection) | Should fire SID 1000004 |
| TD-06 (bulk deletion) | Anomaly detector, not Suricata — re-categorize |
| TD-07 (off-hours) | Anomaly detector, not Suricata — re-categorize |
| TD-08 (path traversal) | Should fire SID 1000007 |
| TD-09 (RBAC denial) | Should fire SID 1000116 (flowbit-based) |
| TD-10 (rate limit flood) | Should fire SID 1000024/1000121 |
| TD-11 (sqlmap UA) | Should fire SID 1000010 |
| TD-12 (IDOR) | Should fire SID 1000116 (flowbit) |
| TD-13 (bad upload) | No dedicated rule — custom.rules has no MIME-type detection rule |
| TD-14 (JWT replay) | Correctly excluded from Suricata scope |

Note: TD-02 (password spray) and TD-13 (disallowed MIME upload) have no rule in `custom.rules`. Rules would need to be written for these scenarios.

---

## Missing Rules That Need to Be Written

| Scenario | Required Rule | Notes |
|---|---|---|
| TD-02 Password Spray | `detection_filter:track by_dst, count 5, seconds 30` across `/auth/realms/bfp/token` grouped by destination | Complex: needs per-destination-user correlation; Suricata cannot track usernames across flows |
| TD-13 MIME Upload | Inspect `http.request_body` for `.php` or PHP magic bytes | Can be done with `content:"<?php"` or file extension inspection on multipart POST |

Password spray (TD-02) is genuinely difficult to detect at the network layer because it requires correlating which user account each request targets. A practical alternative is rate-limiting at the Keycloak level (which may already exist) and treating it as an anomaly detector scenario.

---

## Summary Table

| # | Finding | Severity | Blocking KPI? |
|---|---|---|---|
| F1 | Zero alerts ever generated in eve.json | Critical | Yes |
| F2 | Suricata ran 0 rules for ~2 months | Critical | Yes |
| F3 | Custom rules not loaded (unknown rule SID warnings) | Critical | Yes |
| F4 | Traffic visibility gap (localhost / Docker bridge) | High | Yes |
| F5 | TD-06/TD-07 misattributed to Suricata | High | Yes (KPI accuracy) |
| F6 | XAI pipeline never exercised | High | Yes |
| F7 | Anomaly thresholds never breached in dev | Medium | No (design correct) |
