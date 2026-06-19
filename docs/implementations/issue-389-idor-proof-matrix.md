# Issue #389 IDOR Proof Matrix

Scope: every backend API route containing a path parameter (`/{...}`) found in `src/backend/api/routes`.

Primary fix: public civilian report object routes are no-auth by design, so `device_id` is now the object-authorization token. Wrong, missing, or unknown `device_id` returns neutral `404 {"detail":"Report not found"}` before mutating or disclosing report data.

| Location | Method | Route | Ownership/scope mechanism | Finding / action |
|---|---:|---|---|---|
| `admin/anomalies.py:166` | PATCH | `/anomalies/{anomaly_id}` | System admin route; protected by admin router dependencies/RLS on admin surface. | Verified; no code change. |
| `admin/backups.py:192` | GET | `/backup/{filename}` | System admin backup restore/download surface; admin-only route. | Verified; no code change. |
| `admin/breach.py:52` | GET | `/breach/{breach_id}` | Admin breach/audit surface; admin-only dependency. | Verified; no code change. |
| `admin/breach.py:68` | PATCH | `/breach/{breach_id}` | Admin breach/audit surface; admin-only dependency. | Verified; no code change. |
| `admin/config.py:78` | PATCH | `/config/{key}` | Admin config surface; system admin dependency. | Verified; no code change. |
| `admin/scheduled_reports.py:119` | PATCH | `/scheduled-reports/{report_id}` | Admin scheduled-report surface; admin role boundary. | Verified; no code change. |
| `admin/scheduled_reports.py:162` | DELETE | `/scheduled-reports/{report_id}` | Admin scheduled-report surface; admin role boundary. | Verified; no code change. |
| `admin/security.py:199` | POST | `/security-logs/{log_id}/analyze` | Admin security telemetry surface; admin role boundary. | Verified; no code change. |
| `admin/security.py:209` | PATCH | `/security-logs/{log_id}` | Admin security telemetry surface; admin role boundary. | Verified; no code change. |
| `admin/security.py:391` | POST | `/security-logs/{log_id}/create-incident` | Admin security telemetry surface; admin role boundary. | Verified; no code change. |
| `admin/security.py:466` | GET | `/security-logs/{log_id}/related-audit` | Admin security/audit correlation; admin role boundary. | Verified; no code change. |
| `admin/sync.py:60` | POST | `/sync/{op_id}/retry` | Admin sync operation; admin role boundary. | Verified; no code change. |
| `admin/sync.py:76` | DELETE | `/sync/{op_id}` | Admin sync operation; admin role boundary. | Verified; no code change. |
| `admin/users.py:248` | PATCH | `/users/{user_id}` | Admin user-management route; system admin boundary. | Verified; no code change. |
| `admin/users.py:396` | POST | `/users/{user_id}/logout` | Admin user-management route; system admin boundary. | Verified; no code change. |
| `analytics.py:284` | GET | `/api/analytics/export/{task_id}` | Authenticated analytics export route; task lookup remains behind analytics/admin role boundary. | Verified; no code change. |
| `analytics.py:477` | POST | `/api/analytics/incidents/{incident_id}/narrative` | Authenticated analytics AI route; incident access constrained by role/RLS. | Verified; no code change. |
| `civilian.py:403` | PATCH | `/api/civilian/reports/{report_id}/append` | Public/no-auth route; now requires matching device_id via _require_device_ownership before append/rate-limit/insert. | Fixed + regression test. |
| `civilian.py:470` | POST | `/api/civilian/reports/{report_id}/followup` | Public/no-auth route; request body now requires device_id and verifies matching report ownership before follow-up insert. | Fixed + regression test. |
| `civilian.py:633` | GET | `/api/civilian/reports/{report_id}` | Public/no-auth route; query now requires matching device_id before returning status. | Fixed + regression test. |
| `civilian.py:643` | GET | `/api/civilian/reports/{report_id}/timeline` | Public/no-auth route; query now requires matching device_id before returning timeline/followups. | Fixed. |
| `civilian.py:679` | POST | `/api/civilian/reports/{report_id}/notify` | Public/no-auth route; request body now requires device_id and verifies matching report before registering FCM token. | Fixed + regression test. |
| `incidents.py:576` | POST | `/api/incidents/{incident_id}/attachments` | Authenticated incident route; incident access constrained by RLS/role and attachment tests cover non-civilian access. | Verified; no code change. |
| `incidents.py:691` | GET | `/api/incidents/{incident_id}/attachments/{attachment_id}` | Authenticated incident attachment route; constrained by incident/attachment IDs and role/RLS. | Verified; no code change. |
| `incidents.py:1014` | POST | `/api/incidents/analyst/export/{export_format}` | Format token, not object ID; allowlisted by export format handling. | Waiver: not IDOR object. |
| `incidents.py:1192` | GET | `/api/incidents/analyst/{incident_id}` | Authenticated analyst incident detail; role/RLS guarded. | Verified; no code change. |
| `incidents.py:1367` | GET | `/api/incidents/analyst/{incident_id}/sensitive` | Authenticated sensitive incident detail; role/RLS guarded. | Verified; no code change. |
| `incidents.py:1497` | GET | `/api/incidents/analyst/{incident_id}/wildland` | Authenticated analyst incident detail; role/RLS guarded. | Verified; no code change. |
| `operations.py:152` | PATCH | `/api/operations/{operation_id}` | Authenticated operations route; role boundary and operation membership checks. | Verified; no code change. |
| `operations.py:203` | DELETE | `/api/operations/{operation_id}` | Authenticated operations route; role boundary and operation membership checks. | Verified; no code change. |
| `operations.py:234` | POST | `/api/operations/{operation_id}/link` | Authenticated operations route; role boundary and linked report checks. | Verified; no code change. |
| `operations.py:275` | DELETE | `/api/operations/{operation_id}/link/{report_id}` | Authenticated operations route; role boundary and linked report checks. | Verified; no code change. |
| `regional/encoder.py:274` | GET | `/incidents/{incident_id}` | Regional encoder route; regional role/RLS boundary. | Verified; no code change. |
| `regional/encoder_crud.py:319` | PUT | `/incidents/{incident_id}` | Regional encoder route; regional role/RLS boundary. | Verified; no code change. |
| `regional/encoder_crud.py:414` | POST | `/incidents/{incident_id}/force-replace` | Regional encoder route; regional role/RLS boundary. | Verified; no code change. |
| `regional/encoder_crud.py:440` | PATCH | `/incidents/draft/{incident_id}` | Regional draft route; regional role/RLS boundary. | Verified; no code change. |
| `regional/encoder_crud.py:512` | DELETE | `/incidents/draft/{incident_id}` | Regional draft route; regional role/RLS boundary. | Verified; no code change. |
| `regional/encoder_crud.py:531` | PATCH | `/incidents/{incident_id}/unpend` | Regional encoder route; regional role/RLS boundary. | Verified; no code change. |
| `regional/encoder_crud.py:549` | DELETE | `/incidents/{incident_id}` | Regional encoder route; regional role/RLS boundary. | Verified; no code change. |
| `regional/encoder_crud.py:567` | PATCH | `/incidents/{incident_id}/archive` | Regional encoder route; regional role/RLS boundary. | Verified; no code change. |
| `regional/encoder_crud.py:625` | PATCH | `/incidents/{incident_id}/unarchive` | Regional encoder route; regional role/RLS boundary. | Verified; no code change. |
| `regional/encoder_crud.py:660` | PATCH | `/incidents/{incident_id}/submit` | Regional encoder route; regional role/RLS boundary. | Verified; no code change. |
| `regional/validator.py:260` | PATCH | `/incidents/{incident_id}/verification` | Regional validator route; validator role/RLS boundary. | Verified; no code change. |
| `regional/validator.py:344` | PATCH | `/incidents/{incident_id}/correct` | Regional validator route; validator role/RLS boundary. | Verified; no code change. |
| `regional/validator.py:600` | PATCH | `/validator/incidents/{incident_id}/archive` | Regional validator route; validator role/RLS boundary. | Verified; no code change. |
| `regional/validator.py:650` | PATCH | `/validator/incidents/{incident_id}/unarchive` | Regional validator route; validator role/RLS boundary. | Verified; no code change. |
| `regional/validator.py:698` | DELETE | `/validator/incidents/{incident_id}` | Regional validator route; validator role/RLS boundary. | Verified; no code change. |
| `regional/validator.py:769` | GET | `/validator/incidents/{incident_id}/diff` | Regional validator route; validator role/RLS boundary. | Verified; no code change. |
| `regional/validator.py:860` | GET | `/validator/incidents/{incident_id}/history` | Regional validator route; validator role/RLS boundary. | Verified; no code change. |
| `sessions.py:34` | GET | `/sessions/{user_id}` | Session route resolves Keycloak/user context before returning sessions. | Verified; no code change. |
| `sessions.py:46` | DELETE | `/sessions/{user_id}` | Session route resolves Keycloak/user context before deletion. | Verified; no code change. |
| `sessions.py:64` | DELETE | `/sessions/{user_id}/{session_id}` | Session route resolves Keycloak/user context before deletion. | Verified; no code change. |
| `triage.py:93` | POST | `/api/triage/clusters/{cluster_id}/claim` | Authenticated triage workflow route; role/queue policy boundary. | Verified; no code change. |
| `triage.py:104` | POST | `/api/triage/clusters/{cluster_id}/activity` | Authenticated triage workflow route; role/queue policy boundary. | Verified; no code change. |
| `triage.py:115` | GET | `/api/triage/clusters/{cluster_id}/activity` | Authenticated triage workflow route; role/queue policy boundary. | Verified; no code change. |
| `triage.py:124` | GET | `/api/triage/clusters/{cluster_id}/merge-candidates` | Authenticated triage workflow route; role/queue policy boundary. | Verified; no code change. |
| `triage.py:133` | POST | `/api/triage/clusters/{cluster_id}/terminal-action` | Authenticated triage workflow route; role/queue policy boundary. | Verified; no code change. |
| `triage.py:144` | POST | `/api/triage/reports/{report_id}/correct` | Authenticated triage workflow route; role/queue policy boundary. | Verified; no code change. |
| `triage.py:155` | POST | `/api/triage/clusters/{cluster_id}/split` | Authenticated triage workflow route; role/queue policy boundary. | Verified; no code change. |
| `triage.py:166` | POST | `/api/triage/clusters/{target_cluster_id}/merge` | Authenticated triage workflow route; role/queue policy boundary. | Verified; no code change. |
| `triage.py:210` | POST | `/api/triage/{report_id}/promote` | Authenticated triage promotion route; role/queue policy boundary. | Verified; no code change. |

## Waivers / notes

- `POST /api/incidents/analyst/export/{export_format}` is a path-token allowlist, not an object lookup; it is documented as a non-IDOR waiver.
- Authenticated admin/regional/triage/analytics routes remain behind existing role dependencies and database RLS/scope rules. This slice did not broaden auth models outside the required civilian no-auth gap.
- Public cluster/duplicate-suggestion routes intentionally expose aggregate/public-safe data and do not return per-report object details by arbitrary ID.

## Regression tests added

- Wrong-device `GET /api/civilian/reports/{report_id}` returns neutral 404.
- Wrong-device `POST /api/civilian/reports/{report_id}/followup` returns neutral 404 and does not commit.
- Wrong-device `POST /api/civilian/reports/{report_id}/notify` returns neutral 404 and does not commit.
- Wrong-device `PATCH /api/civilian/reports/{report_id}/append` returns neutral 404 and does not commit.
