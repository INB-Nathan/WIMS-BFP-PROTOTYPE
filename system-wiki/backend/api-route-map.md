---
title: Backend API Route Map
created: 2026-05-14
updated: 2026-05-14
type: backend
tags: [wims-bfp, backend, api, implementation-map]
sources: [raw/codebase/codebase-snapshot-2026-05-14.md, src/backend/api/routes]
status: draft
---

# Backend API Route Map

FastAPI route ownership snapshot from `src/backend/api/routes`.

| File | Method | Path | Function |
|---|---:|---|---|
| `civilian.py` | `POST` | `/reports` | `submit_civilian_report` |
| `civilian.py` | `GET` | `/reports/{report_id}` | `get_civilian_report` |
| `sessions.py` | `GET` | `/sessions/{user_id}` | `list_user_sessions` |
| `sessions.py` | `DELETE` | `/sessions/{user_id}/{session_id}` | `terminate_user_session` |
| `user.py` | `GET` | `/me/profile` | `get_my_profile` |
| `user.py` | `PATCH` | `/me` | `update_my_profile` |
| `user.py` | `PATCH` | `/me/password` | `change_my_password` |
| `ref.py` | `GET` | `/regions` | `get_regions` |
| `ref.py` | `GET` | `/provinces` | `get_provinces` |
| `ref.py` | `GET` | `/cities` | `get_cities` |
| `incidents.py` | `POST` | `/incidents/upload-bundle` | `upload_incident_bundle` |
| `incidents.py` | `POST` | `/incidents/{incident_id}/attachments` | `upload_attachment` |
| `incidents.py` | `POST` | `/incidents` | `create_incident` |
| `incidents.py` | `GET` | `/incidents` | `get_incidents` |
| `incidents.py` | `GET` | `/incidents/analyst-list` | `get_analyst_incident_list` |
| `incidents.py` | `GET` | `/incidents/analyst/{incident_id}` | `get_analyst_incident_detail` |
| `incidents.py` | `GET` | `/incidents/analyst/{incident_id}/sensitive` | `get_analyst_incident_sensitive_detail` |
| `incidents.py` | `GET` | `/incidents/analyst/{incident_id}/wildland` | `get_analyst_incident_wildland_detail` |
| `regional.py` | `POST` | `/afor/import` | `import_afor_file` |
| `regional.py` | `POST` | `/afor/commit` | `commit_afor_import` |
| `regional.py` | `GET` | `/incidents` | `get_regional_incidents` |
| `regional.py` | `GET` | `/incidents/drafts` | `list_encoder_drafts` |
| `regional.py` | `GET` | `/incidents/check-duplicate` | `check_incident_duplicate` |
| `regional.py` | `GET` | `/incidents/{incident_id}` | `get_regional_incident_detail` |
| `regional.py` | `GET` | `/validator/stats` | `get_validator_stats` |
| `regional.py` | `GET` | `/stats` | `get_regional_stats` |
| `regional.py` | `POST` | `/incidents` | `create_incident` |
| `regional.py` | `PUT` | `/incidents/{incident_id}` | `update_incident` |
| `regional.py` | `POST` | `/incidents/{incident_id}/force-replace` | `force_replace_incident` |
| `regional.py` | `PATCH` | `/incidents/draft/{incident_id}` | `update_draft` |
| `regional.py` | `DELETE` | `/incidents/draft/{incident_id}` | `delete_draft` |
| `regional.py` | `PATCH` | `/incidents/{incident_id}/unpend` | `unpend_incident` |
| `regional.py` | `DELETE` | `/incidents/{incident_id}` | `delete_incident` |
| `regional.py` | `PATCH` | `/incidents/{incident_id}/submit` | `submit_incident_for_review` |
| `regional.py` | `GET` | `/validator/incidents` | `get_validator_incident_queue` |
| `regional.py` | `PATCH` | `/incidents/{incident_id}/verification` | `verify_incident` |
| `regional.py` | `POST` | `/validator/incidents/bulk-approve` | `bulk_approve_incidents` |
| `regional.py` | `PATCH` | `/validator/incidents/{incident_id}/archive` | `archive_incident` |
| `regional.py` | `GET` | `/validator/incidents/{incident_id}/diff` | `get_incident_diff` |
| `regional.py` | `GET` | `/audit-log` | `get_encoder_audit_log` |
| `regional.py` | `GET` | `/validator/audit-logs` | `get_validator_audit_logs` |
| `regional.py` | `GET` | `/validator/audit-logs/export` | `export_validator_audit_logs` |
| `triage.py` | `GET` | `/pending` | `get_pending_reports` |
| `triage.py` | `POST` | `/{report_id}/promote` | `promote_report` |
| `triage.py` | `POST` | `/bulk-promote` | `bulk_promote_reports` |
| `admin.py` | `POST` | `/users` | `create_user` |
| `admin.py` | `GET` | `/users` | `get_users` |
| `admin.py` | `PATCH` | `/users/{user_id}` | `update_user` |
| `admin.py` | `GET` | `/active-sessions` | `get_active_sessions` |
| `admin.py` | `POST` | `/users/{user_id}/logout` | `force_logout_user` |
| `admin.py` | `GET` | `/health` | `get_system_health` |
| `admin.py` | `GET` | `/security-logs` | `get_security_logs` |
| `admin.py` | `POST` | `/security-logs/{log_id}/analyze` | `analyze_security_log` |
| `admin.py` | `PATCH` | `/security-logs/{log_id}` | `update_security_log` |
| `admin.py` | `POST` | `/analytics/backfill` | `backfill_analytics` |
| `admin.py` | `GET` | `/audit-logs` | `get_audit_logs` |
| `admin.py` | `POST` | `/scheduled-reports` | `create_scheduled_report` |
| `admin.py` | `GET` | `/scheduled-reports` | `list_scheduled_reports` |
| `admin.py` | `POST` | `/backup` | `trigger_backup` |
| `admin.py` | `GET` | `/backups` | `list_backups` |
| `admin.py` | `GET` | `/backup/{filename}` | `download_backup` |
| `analytics.py` | `POST` | `/refresh-views` | `trigger_materialized_view_refresh` |
| `analytics.py` | `GET` | `/heatmap` | `get_heatmap` |
| `analytics.py` | `GET` | `/trends` | `get_trends_route` |
| `analytics.py` | `GET` | `/comparative` | `get_comparative` |
| `analytics.py` | `GET` | `/execution-plans` | `get_execution_plans` |
| `analytics.py` | `POST` | `/export/csv` | `export_csv` |
| `analytics.py` | `POST` | `/export/pdf` | `export_pdf` |
| `analytics.py` | `POST` | `/export/excel` | `export_excel` |
| `analytics.py` | `GET` | `/export/{task_id}` | `download_export` |
| `analytics.py` | `GET` | `/filter-options` | `filter_options_route` |
| `analytics.py` | `GET` | `/type-distribution` | `get_type_distribution_route` |
| `analytics.py` | `GET` | `/top-barangays` | `get_top_barangays_route` |
| `analytics.py` | `GET` | `/response-time-by-region` | `get_response_time_by_region_route` |
| `analytics.py` | `GET` | `/compare-regions` | `compare_regions_route` |
| `analytics.py` | `GET` | `/top-n` | `top_n_route` |
| `public_dmz.py` | `POST` | `/` | `submit_public_incident` |

## Routing Notes
- `regional.py` owns a large share of encoder/validator incident workflow. Avoid opportunistic refactors; see [[architecture/system-overview]].
- `analytics.py` maps to M5 analytics and exports. It includes export dispatch/download, geography filter-options, Recharts-backed chart endpoints, top-N municipality support, and global filter support for comparative/cross-region analytics.
- `incidents.py` now includes National Analyst read-only incident list/detail/wildland endpoints. These require `NATIONAL_ANALYST` or `SYSTEM_ADMIN`, use `get_db_with_rls`, and expose only verified, non-archived incidents. The analyst list endpoint accepts an optional comma-separated `incident_ids` query for selected-set evidence tables.
- `analytics.py` trends now accepts `daily`, `weekly`, `monthly`, `quarterly`, and `yearly` intervals.
- Planned post-grill analyst export module: selected-record/full-AFOR exports should be implemented as separate `incidents.py` analyst export endpoints (`POST /api/incidents/analyst/export`, `GET /api/incidents/analyst/export/{task_id}`), not as extensions of the aggregate analytics export endpoint. A status endpoint is deferred until after the MVP dashboard.
- `public_dmz.py` is the unauthenticated public submission surface; fail closed on all adjacent changes and read [[security/security-baseline]].
- `ref.py` is the reference data read API tied to `wims.ref_*` tables in [[database/schema-overview]].

## Related
- [[concepts/frs-module-map]]
- [[operations/agent-routing-guide]]
