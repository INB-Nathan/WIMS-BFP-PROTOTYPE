---
title: Backend API Route Map
created: 2026-05-14
updated: 2026-06-16
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
| `civilian.py` | `POST` | `/reports/duplicate-suggestions` | `suggest_duplicate_reports` |
| `civilian.py` | `GET` | `/reports` | `get_my_reports` | Returns device's full report history for ownership-checked update flow |
| `civilian.py` | `PATCH` | `/reports/{report_id}/append` | `append_civilian_report` |
| `civilian.py` | `GET` | `/reports/{report_id}` | `get_civilian_report` |
| `civilian.py` | `GET` | `/reports/{report_id}/timeline` | `get_civilian_report_timeline` |
| `civilian.py` | `POST` | `/reports/{report_id}/notify` | `register_notification` |
| `civilian.py` | `GET` | `/report-clusters` | `get_report_clusters` | Public-safe root-map areas from durable civilian report clusters; no raw cluster/report IDs. |
| `civilian.py` | `POST` | `/reports/{report_id}/followup` | `submit_civilian_followup` | Public text follow-up linked to existing report (Issue #62). Terminal reports blocked. |
| `sessions.py` | `GET` | `/sessions/{user_id}` | `list_user_sessions` |
| `sessions.py` | `DELETE` | `/sessions/{user_id}/{session_id}` | `terminate_user_session` |
| `user.py` | `GET` | `/me/profile` | `get_my_profile` |
| `user.py` | `PATCH` | `/me` | `update_my_profile` |
| `user.py` | `PATCH` | `/me/password` | `change_my_password` |
| `ref.py` | `GET` | `/regions` | `get_regions` |
| `ref.py` | `GET` | `/provinces` | `get_provinces` |
| `ref.py` | `GET` | `/cities` | `get_cities` |
| `ref.py` | `GET` | `/fire-stations` | `get_fire_stations` |
| `ref.py` | `GET` | `/emergency-services` | `get_emergency_services` | Public 911 + all BFP station names/locations, nearest-five metadata when location is known. |
| `incidents.py` | `POST` | `/incidents/upload-bundle` | `upload_incident_bundle` |
| `incidents.py` | `POST` | `/incidents/{incident_id}/attachments` | `upload_attachment` |
| `incidents.py` | `POST` | `/incidents` | `create_incident` |
| `incidents.py` | `GET` | `/incidents` | `get_incidents` |
| `incidents.py` | `GET` | `/incidents/analyst-list` | `get_analyst_incident_list` |
| `incidents.py` | `GET` | `/incidents/analyst/{incident_id}` | `get_analyst_incident_detail` |
| `incidents.py` | `GET` | `/incidents/analyst/{incident_id}/sensitive` | `get_analyst_incident_sensitive_detail` |
| `incidents.py` | `GET` | `/incidents/analyst/{incident_id}/wildland` | `get_analyst_incident_wildland_detail` |
| `regional/afor.py` | `POST` | `/afor/import` | `import_afor_file` |
| `regional/afor.py` | `POST` | `/afor/commit` | `commit_afor_import` |
| `regional/duplicates.py` | `GET` | `/incidents/check-duplicate` | `check_incident_duplicate` |
| `regional/stats.py` | `GET` | `/validator/stats` | `get_validator_stats` |
| `regional/stats.py` | `GET` | `/stats` | `get_regional_stats` |
| `regional/encoder.py` | `GET` | `/incidents` | `get_regional_incidents` |
| `regional/encoder.py` | `GET` | `/incidents/drafts` | `list_encoder_drafts` |
| `regional/encoder.py` | `GET` | `/incidents/{incident_id}` | `get_regional_incident_detail` |
| `regional/encoder.py` | `GET` | `/audit-log` | `get_encoder_audit_log` |
| `regional/encoder_crud.py` | `POST` | `/incidents` | `create_incident` |
| `regional/encoder_crud.py` | `PUT` | `/incidents/{incident_id}` | `update_incident` |
| `regional/encoder_crud.py` | `POST` | `/incidents/{incident_id}/force-replace` | `force_replace_incident` |
| `regional/encoder_crud.py` | `PATCH` | `/incidents/draft/{incident_id}` | `update_draft` |
| `regional/encoder_crud.py` | `DELETE` | `/incidents/draft/{incident_id}` | `delete_draft` |
| `regional/encoder_crud.py` | `PATCH` | `/incidents/{incident_id}/unpend` | `unpend_incident` |
| `regional/encoder_crud.py` | `DELETE` | `/incidents/{incident_id}` | `delete_incident` |
| `regional/encoder_crud.py` | `PATCH` | `/incidents/{incident_id}/archive` | `encoder_archive_incident` |
| `regional/encoder_crud.py` | `PATCH` | `/incidents/{incident_id}/unarchive` | `encoder_unarchive_incident` |
| `regional/encoder_crud.py` | `PATCH` | `/incidents/{incident_id}/submit` | `submit_incident_for_review` |
| `regional/validator.py` | `GET` | `/validator/incidents` | `get_validator_incident_queue` |
| `regional/validator.py` | `PATCH` | `/incidents/{incident_id}/verification` | `verify_incident` | Accepts optional `client_id` in body for idempotency (#267) |
| `regional/validator.py` | `PATCH` | `/incidents/{incident_id}/correct` | `correct_verified_incident` |
| `regional/validator.py` | `POST` | `/validator/incidents/bulk-approve` | `bulk_approve_incidents` |
| `regional/validator.py` | `PATCH` | `/validator/incidents/{incident_id}/archive` | `archive_incident` | Accepts optional `client_id` in body for idempotency (#267); query param retained for compatibility. |
| `regional/validator.py` | `PATCH` | `/validator/incidents/{incident_id}/unarchive` | `unarchive_incident` | Accepts optional `client_id` in body for idempotency (#267); query param retained for compatibility. |
| `regional/validator.py` | `DELETE` | `/validator/incidents/{incident_id}` | `delete_archived_incident` |
| `regional/validator.py` | `GET` | `/validator/incidents/{incident_id}/diff` | `get_incident_diff` |
| `regional/validator.py` | `GET` | `/validator/incidents/{incident_id}/history` | `get_incident_revision_history` |
| `regional/validator.py` | `GET` | `/validator/audit-logs` | `get_validator_audit_logs` |
| `regional/validator.py` | `GET` | `/validator/audit-logs/export` | `export_validator_audit_logs` |
| `regional.py` | `GET` | `/validator/incidents` | `get_validator_incident_queue` |
| `regional.py` | `PATCH` | `/incidents/{incident_id}/verification` | `verify_incident` |
| `regional.py` | `POST` | `/validator/incidents/bulk-approve` | `bulk_approve_incidents` |
| `regional.py` | `PATCH` | `/validator/incidents/{incident_id}/archive` | `archive_incident` |
| `regional.py` | `PATCH` | `/validator/incidents/{incident_id}/unarchive` | `unarchive_incident` |
| `regional.py` | `DELETE` | `/validator/incidents/{incident_id}` | `delete_archived_incident` |
| `regional.py` | `GET` | `/validator/incidents/{incident_id}/diff` | `get_incident_diff` |
| `regional.py` | `GET` | `/audit-log` | `get_encoder_audit_log` |
| `regional.py` | `GET` | `/validator/audit-logs` | `get_validator_audit_logs` |
| `regional.py` | `GET` | `/validator/audit-logs/export` | `export_validator_audit_logs` |
| `triage.py` | `GET` | `/pending` | `get_pending_reports` |
| `triage.py` | `GET` | `/queue` | `get_triage_queue` |
| `triage.py` | `POST` | `/clusters/{cluster_id}/claim` | `claim_cluster` |
| `triage.py` | `POST` | `/clusters/{cluster_id}/activity` | `refresh_cluster_activity` |
| `triage.py` | `GET` | `/clusters/{cluster_id}/activity` | `get_cluster_activity` |
| `triage.py` | `POST` | `/clusters/{cluster_id}/terminal-action` | `apply_cluster_terminal_action` |
| `triage.py` | `POST` | `/reports/{report_id}/correct` | `correct_terminal_report` |
| `triage.py` | `POST` | `/clusters/{cluster_id}/split` | `split_cluster` |
| `triage.py` | `POST` | `/clusters/{target_cluster_id}/merge` | `merge_clusters` |
| `triage.py` | `GET` | `/clusters/{cluster_id}/merge-candidates` | `get_merge_candidates` | Phase 2 merge-candidate discovery (250m/1hr) |
| `triage.py` | `POST` | `/{report_id}/promote` | `promote_report` (disabled, 410) |
| `triage.py` | `POST` | `/bulk-promote` | `bulk_promote_reports` (disabled, 410) |
| `admin/users.py` | `POST` | `/users` | `create_user` |
| `admin/users.py` | `GET` | `/users` | `get_users` |
| `admin/users.py` | `PATCH` | `/users/{user_id}` | `update_user` |
| `admin/users.py` | `GET` | `/active-sessions` | `get_active_sessions` |
| `admin/users.py` | `POST` | `/users/{user_id}/logout` | `force_logout_user` |
| `admin/monitoring.py` | `GET` | `/health` | `get_system_health` |
| `admin/monitoring.py` | `GET` | `/monitoring/workers` | `get_worker_status` | Paginated (limit/offset, default 20/page, max 200) |
| `admin/monitoring.py` | `POST` | `/monitoring/workers/prune` | `prune_offline_workers` | Prunes OFFLINE workers older than retention threshold (#345) |
| `admin/monitoring.py` | `GET` | `/monitoring/system` | `get_system_metrics` |
| `admin/security.py` | `GET` | `/security-logs` | `get_security_logs` | Supports `source_ip`, `severity`, `date_from`, `date_to` filter params |
| `admin/security.py` | `POST` | `/security-logs/{log_id}/analyze` | `analyze_security_log` | XAI analysis via Ollama (#161) |
| `admin/security.py` | `PATCH` | `/security-logs/{log_id}` | `update_security_log` | HITL decision (CONFIRM_THREAT, FALSE_POSITIVE, REQUEST_MORE_INFO); writes audit trail with endpoint metadata (#162, #357). HIGH/CRITICAL CONFIRM_THREAT creates breach notification and nulls `reported_by` when the Keycloak admin lacks a matching local `wims.users` row, avoiding FK-triggered 500s. |
| `admin/security.py` | `POST` | `/security-logs/{log_id}/create-incident` | `create_incident_from_alert` | Manual DRAFT incident from reviewed alert; writes audit trail with endpoint metadata (#165, #357) |
| `admin/security.py` | `GET` | `/security-logs/{log_id}/related-audit` | `get_related_audit` | Related audit trail rows (±1h window) for a security log (#357) |
| `admin/security.py` | `POST` | `/security-logs/{log_id}/block-source-ip` | `block_source_ip` | Block the row's `source_ip` via `ip_blocklist` service. Body `{ttl_hours?: int \| "permanent"}` (default 24h). Allowlist + self-IP guard + already-active no-op + repeat-offender escalation (3rd block → permanent). Marks `admin_action_taken="Blocked IP"` on the threat row. (2026-06-22) |
| `admin/security.py` | `POST` | `/security-logs/block-by-filter` | `block_by_filter` | Filter-scoped bulk block. Body `{severity?, source_ip?, date_from?, date_to?, q?}` + `?preview=true` for dry-run. Hard-capped at first 500 distinct IPs (504 fix at 25k scale). Returns `{total_distinct_ips, blocked_count, permanent_count, skipped_self, skipped_allowlist, already_blocked, capped}`. `classification` column dropped (migration 62 never applied; deferred). (2026-06-22) |
| `admin/security.py` | `POST` | `/security-logs/bulk-action` | `bulk_action` | Bulk action on `{log_ids: int[], action: "block_ip" \| "dismiss" \| "false_positive", ttl_hours?: int \| "permanent"}`. One transaction, one audit row. `dismiss` + DELETE share `dismiss_security_log` helper. (2026-06-22) |
| `admin/security.py` | `DELETE` | `/security-logs/{log_id}` | `delete_security_log` | Soft-delete: `resolved_at=now(), admin_action_taken='Dismissed'`. Delegates to `dismiss_security_log` (same logic as bulk-dismiss). (2026-06-22) |
| `admin/ip_blocklist.py` | `DELETE` | `/ip-blocklist/{ip}` | `unblock_ip` | Unblock an IP: `is_active=false` on Postgres + `DEL ip:block:{ip}` from Redis. 404 if IP not actively blocked. (2026-06-22) |
| `admin/ip_blocklist.py` | `GET` | `/ip-blocklist` | `list_blocked_ips` | List active blocks with derived `block_count` (COUNT per source_ip), `expires_at`, `is_permanent`, `blocked_by`, `block_reason`. (2026-06-22) |
| `admin/audit.py` | `GET` | `/audit-logs` | `get_audit_logs` | Supports `user_id`, `action_type`, `table_affected`, `ip_address`, `date_from`, `date_to` filter params |
| `admin/audit.py` | `POST` | `/audit-logs/analyze` | `analyze_audit_logs` | Batch SLM behavioral pattern analysis via Ollama (#163) |
| `admin/anomalies.py` | `GET` | `/anomalies` | `list_anomalies` | Paginated items + aggregate `counts` (per-status) and `type_facets` (#356, #362); supports `status`, `severity`, `anomaly_type` filter params |
| `admin/anomalies.py` | `PATCH` | `/anomalies/{anomaly_id}` | `update_anomaly_status` | Transition anomaly status (NEW → ACKNOWLEDGED → RESOLVED); writes audit trail |
| `admin/breach.py` | `GET` | `/admin/breach` | `list_breaches` | List all breach records, RA 10173 NPC 72h tracking (M10d) |
| `admin/breach.py` | `GET` | `/admin/breach/{breach_id}` | `get_breach` | Fetch single breach by ID (M10d) |
| `admin/breach.py` | `PATCH` | `/admin/breach/{breach_id}` | `update_breach` | Update breach status/notes; captures old_values/new_values in forensic audit with request metadata (#360, #361) |
| `admin/config.py` | `GET` | `/admin/config` | `get_config` | M9c configuration management — reads `wims.system_config` including NPC contact keys `npc_contact_name`, `npc_contact_phone`, `npc_office_phone` and worker timeout keys `worker_stale_timeout_seconds`, `worker_offline_timeout_seconds` (#170, #247, #354, #355) |
| `admin/config.py` | `PATCH` | `/admin/config/{key}` | `update_config` | M9c configuration management — audit-logged config write with per-key validation (min ranges, cross-key constraints for worker timeouts) and forensic old/new values (#170, #247, #354, #355) |
| `admin/analytics.py` | `POST` | `/analytics/backfill` | `backfill_analytics` |
| `admin/scheduled_reports.py` | `POST` | `/scheduled-reports` | `create_scheduled_report` |
| `admin/scheduled_reports.py` | `GET` | `/scheduled-reports` | `list_scheduled_reports` |
| `admin/scheduled_reports.py` | `PATCH` | `/scheduled-reports/{report_id}` | `update_scheduled_report` |
| `admin/rate_limits.py` | `GET` | `/rate-limits` | `get_rate_limits` | Return auth-flow rate-limit config from Redis (legacy `login` tier label protects OIDC callback endpoint) (#47, #363) |
| `admin/rate_limits.py` | `PATCH` | `/rate-limits` | `update_rate_limits` | Update rate-limit threshold/window with Pydantic validation (≥1), audit-logged with `RATE_LIMIT_UPDATED` action (#47, #363) |
| `admin/backups.py` | `POST` | `/backup` | `trigger_backup` |
| `admin/backups.py` | `GET` | `/backups` | `list_backups` |
| `admin/backups.py` | `GET` | `/backup/{filename}` | `download_backup` |
| `admin/backups.py` | `POST` | `/restore` | `restore_backup` |
| `sessions.py` | `DELETE` | `/sessions/{user_id}/{session_id}` | `revoke_user_session` |
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
| `map.py` | `GET` | `/api/public/clusters` | `get_incident_clusters` | Public clustered incident markers, Redis-cached |
| `map.py` | `GET` | `/api/public/emergency-services` | `get_emergency_services` | Public emergency contacts + nearby stations |
| `map.py` | `GET` | `/api/validator/operational-map` | `get_operational_map` | Auth-protected operational map for validators; reads `fire_incidents.location`, so AFOR commit/import must persist accurate row-level WGS84 geometry |
| `events.py` | `GET` | `/events/stream` | `event_stream` | SSE real-time notification stream (Redis pub/sub) |

## Routing Notes
- `regional/` package owns encoder/validator incident workflow across `afor.py`, `duplicates.py`, `stats.py`, `encoder.py`, `encoder_crud.py`, `validator.py`, with shared helpers in `field_updates.py` and `__init__.py`.
- Regional encoder and national validator archive views can open archived incident details through `GET /regional/incidents/{incident_id}`; that detail endpoint no longer excludes archived rows, but still scopes encoders to their own records and keeps analyst-specific read surfaces non-archived.
- `analytics.py` maps to M5 analytics and exports. It includes export dispatch/download, geography filter-options, Recharts-backed chart endpoints, top-N municipality support, and global filter support for comparative/cross-region analytics.
- `incidents.py` now includes National Analyst read-only incident list/detail/wildland endpoints. These require `NATIONAL_ANALYST` or `SYSTEM_ADMIN`, use `get_db_with_rls`, and expose only verified, non-archived incidents. The analyst list endpoint accepts an optional comma-separated `incident_ids` query for selected-set evidence tables.
- `analytics.py` trends now accepts `daily`, `weekly`, `monthly`, `quarterly`, and `yearly` intervals.
- Planned post-grill analyst export module: selected-record/full-AFOR exports should be implemented as separate `incidents.py` analyst export endpoints (`POST /api/incidents/analyst/export`, `GET /api/incidents/analyst/export/{task_id}`), not as extensions of the aggregate analytics export endpoint. A status endpoint is deferred until after the MVP dashboard.
- `public_dmz.py` is the unauthenticated public submission surface; fail closed on all adjacent changes and read [[security/security-baseline]].
- `ref.py` is the reference data read API tied to `wims.ref_*` tables in [[database/schema-overview]].

## Related
- [[concepts/frs-module-map]]
- [[operations/agent-routing-guide]]
