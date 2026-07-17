---
title: Backend API Route Map
created: 2026-05-14
updated: 2026-07-17
type: backend
tags: [wims-bfp, backend, api, implementation-map]
sources: [raw/codebase/codebase-snapshot-2026-05-14.md, src/backend/api/routes]
status: draft
---

# Backend API Route Map

FastAPI route ownership snapshot from `src/backend/api/routes`.

| File | Method | Path | Function |
|---|---:|---|---|
| `civilian.py` | `POST` | `/reports` | `submit_civilian_report` | Atomic report creation; accepts optional `photo_ids` (UUID list, max 20) for anonymous pending-photo attach (Slice B) and, for an authenticated `CIVILIAN_REPORTER`, their own pending photos (Slice D). `contributor_user_id` is server-derived from the session (never request body). Report + attach + audit stay in one transaction; neutral 422 (rollback, no orphan) on invalid/missing credential or rejected batches; deliberate 422/404 are preserved by the route's `except HTTPException` handler.
| `civilian.py` | `POST` | `/reports/duplicate-suggestions` | `suggest_duplicate_reports` |
| `civilian.py` | `GET` | `/reports` | `get_my_reports` | Legacy device-ID list endpoint retained only as a `410 Gone` deprecation stub; public tracking now requires the per-report capability link. |
| `civilian.py` | `GET` | `/contributor/me` | `get_contributor_profile_route` | Authenticated `CIVILIAN_REPORTER` only; 401 without a user and 403 for other roles. Uses an RLS-scoped session and returns the caller's private contributor profile. |
| `civilian.py` | `GET` | `/contributor/reports` | `get_contributor_reports_route` | Authenticated `CIVILIAN_REPORTER` only; 401 without a user and 403 for other roles. Uses an RLS-scoped session and returns the caller's paginated reports. |
| `civilian.py` | `GET` | `/contributor/stats` | `get_contributor_stats_route` | Authenticated `CIVILIAN_REPORTER` only; 401 without a user and 403 for other roles. Uses an RLS-scoped session and returns the caller's private statistics. |
| `civilian.py` | `PATCH` | `/reports/{report_id}/append` | `append_civilian_report` |
| `civilian.py` | `GET` | `/reports/{report_id}/track/{tracking_token}` | `get_civilian_report_by_tracking_token` | Capability-token public tracking route. Returns the safe projection (status, guidance, station/routing summary, photo count) plus an ordered status timeline whose metadata is allowlisted by stage; it excludes civilian coordinates, PII, internal metadata, and status-update actor identities. Missing, mismatched, expired, or revoked capabilities receive a neutral `404`. |
| `civilian.py` | `GET` | `/reports/{report_id}` | `get_civilian_report` |
| `civilian.py` | `GET` | `/reports/{report_id}/timeline` | `get_civilian_report_timeline` |
| `civilian.py` | `POST` | `/reports/{report_id}/notify` | `register_notification` |
| `civilian.py` | `GET` | `/report-clusters` | `get_report_clusters` | Public-safe root-map areas from durable civilian report clusters; no raw cluster/report IDs. |
| `civilian.py` | `POST` | `/reports/{report_id}/followup` | `submit_civilian_followup` | Public text follow-up linked to existing report (Issue #62). Terminal reports blocked. |
| `civilian.py` | `POST` | `/reports/{report_id}/photos` | `upload_report_photo` | Post-submit multipart photo attachment; delegates validation, EXIF sanitization, encryption, ownership, RLS, and audit to `services.report_photos`. |
| `civilian.py` | `POST` | `/photos/upload` | `upload_pending_civilian_photo` | Encrypted pending upload for a registered CIVILIAN_REPORTER or a bearer-capability owner; report/device IDs are not accepted. Anonymous ownership is derived by the fixed-search-path helper, with neutral 404 for missing/invalid capabilities. |
| `sessions.py` | `GET` | `/sessions/{user_id}` | `list_user_sessions` |
| `community_content.py` | `GET` | `/community/hub` | `get_community_hub` | Public published/non-expired Community Safety Hub listing with language fallback and urgent-banner projection. |
| `community_content.py` | `GET` | `/community/{slug}` | `get_community_content_by_slug` | Public published/non-expired content detail; returns 404 when unavailable. |
| `community_content.py` | `GET` | `/admin/community` | `list_community_admin_content` | SYSTEM_ADMIN-only all-state CMS listing with latest-version editor fields under RLS. |
| `community_content.py` | `POST` | `/admin/community` | `create_community_draft` | SYSTEM_ADMIN-only draft creation; emits `CMS_EDIT` in the mutation transaction. |
| `community_content.py` | `PATCH` | `/admin/community/{content_id}` | `update_community_draft` | SYSTEM_ADMIN-only draft edit with immutable version insertion for content changes. |
| `community_content.py` | `POST` | `/admin/community/{content_id}/publish` | `publish_community_content` | SYSTEM_ADMIN-only optimistic publish; emits sensitive `CONTENT_PUBLISH`. |
| `community_content.py` | `POST` | `/admin/community/{content_id}/archive` | `archive_community_content` | SYSTEM_ADMIN-only soft archive; emits sensitive `CONTENT_ARCHIVE`. |
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
| `regional/validator.py` | `GET` | `/validator/audit-logs/export/secure` | `export_secure_validator_audit_logs` | Signed CSV/PDF/manifest ZIP; NATIONAL_VALIDATOR scope is forced server-side |
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
| `admin/security.py` | `GET` | `/security-logs/rollups` | `get_security_log_rollups` | Hourly/daily SIEM rollups for weekly/time-range telemetry without scanning raw logs |
| `admin/security.py` | `POST` | `/security-logs/{log_id}/analyze` | `analyze_security_log` | Stage-1 XAI anomaly/evidence/risk analysis via Ollama (#161) |
| `admin/security.py` | `GET` | `/security-logs/{log_id}/recommended-action-status` | `get_recommended_action_generation_status` | Stage-2 recommended-action status (`running`, `completed`, `idle`, `needs_analysis`) |
| `admin/security.py` | `POST` | `/security-logs/{log_id}/recommended-action` | `generate_security_log_recommended_action` | Stage-2 focused recommended-action generation; merges `recommended_action` into `xai_narrative` |
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
| `admin/audit.py` | `GET` | `/audit-logs/export/secure` | `export_secure_audit_logs` | Signed tamper-evident CSV/PDF/manifest ZIP; SYSTEM_ADMIN only |
| `admin/audit.py` | `POST` | `/audit-logs/export/verify` | `verify_secure_audit_export` | Multipart ZIP verification with signature, hash-chain, PDF, and freshness checks |
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
- The civilian photo route deliberately uses `get_photo_db()` from `src/backend/auth.py`, not the admin `get_db()` dependency: anonymous requests leave the RLS user GUC unset, while registered requests set it from the authenticated user. `wims.report_photos` remains the final authorization boundary under `FORCE ROW LEVEL SECURITY`; ownership failures are normalized to a neutral 404. `get_anonymous_session_capability()` reads only an Authorization bearer and retains it transiently for the fixed-search-path insert helper; the stored owner is derived in PostgreSQL and absent/invalid capability behavior remains neutral.

## Civilian Photo Upload (v7 — 2026-07-12)
- `POST /api/civilian/photos/upload` creates an encrypted pending row for a registered `CIVILIAN_REPORTER` or an existing anonymous bearer capability. Registered rows set `uploader_user_id`; anonymous rows set only the bearer-derived `anonymous_session_id`. Pending rows retain NULL `report_id`, `attached_at`, and legacy owner fields, and the route accepts no report or device ID.
- Both paths reuse magic-byte/size validation, EXIF-before-strip processing, encrypted AES-GCM/OpenBao artifacts, hashes, safe paths, idempotency, caps, audit, and fail-closed artifact cleanup. Anonymous ownership, one-outstanding-pending-row enforcement, and foreign client-ID neutrality are enforced by the `0010`/`89` fixed-search-path helper. Missing or invalid capabilities receive neutral 404.

## Civilian Report + Anonymous Pending-Photo Attach (Slice B — 2026-07-12)
- `POST /api/civilian/reports` now accepts an optional `photo_ids` list (max 20 UUIDs, defined on `CivilianReportCreate`). When `photo_ids` is present, the request must carry a valid `Authorization: Bearer <token>` anonymous capability; otherwise the route raises a neutral `422`.
- The route sets `citizen_reports.anonymous_session_id` from the validated capability (never caller-supplied) and, within the same `try:`/`commit()` block as the `CIVILIAN_REPORT_SUBMIT` audit, calls `wims.attach_anonymous_photos(:raw_token, :report_id, :photo_ids::uuid[])`. The raw token is passed only to the SQL helper and is never logged, returned, or audited beyond the `photo_ids` list.
- On success a `PHOTO_UPLOAD_ATTACH` audit row (`wims.report_photos`, `record_id=report_id`, `new_values={"photo_ids": [...]}`, `sensitive=True`) is written in the same transaction, then `CIVILIAN_REPORT_SUBMIT` and `db.commit()`. Any failure (including the 422 raises) hits the `except HTTPException` handler, which rolls back the report INSERT and propagates the neutral status — no orphan report, no audit row.
- Atomicity and cross-owner/null/dup/partial/batch rejection live in the `0009`/`88` `SECURITY DEFINER` helper; the route only raises neutral `422` when the helper returns FALSE. No new RLS policy or `BYPASSRLS` was introduced.

## Community Safety Hub content (Slice F — 2026-07-12)
- Public routes `GET /api/community/hub` and `GET /api/community/{slug}` read only published, non-expired content; the SQL expiry predicate remains mandatory even if the periodic Celery sweep is delayed. The service resolves the requested language with English fallback and surfaces urgent banners first.
- Admin routes under `/api/admin/community` require the existing `SYSTEM_ADMIN` dependency and RLS-scoped database session. `GET /api/admin/community` lists every lifecycle state with the latest immutable version fields for the CMS editor; draft creation/editing, immutable version insertion, pointer publication, and soft archive emit `CMS_EDIT`, `CONTENT_PUBLISH`, and `CONTENT_ARCHIVE` audits in the route-owned transaction. PATCH explicit nulls clear `expires_at`/`last_reviewed_at`, while omitted fields remain unchanged. UUID content IDs are stored in audit `new_values`; the established integer `record_id` is not overloaded.
- `tasks.expire_content.expire_published_content` periodically archives expired published rows and emits a best-effort `CMS_EXPIRY_SYSTEM` summary audit **only when at least one row is archived** — no-op beat runs write no audit row, so the audit trail is not flooded by idle sweeps. The sweep also publishes cumulative Prometheus counters at `/metrics` (`community_content_expiry_archived_total`, `community_content_expiry_skipped_total`, `community_content_expiry_last_success_timestamp_seconds`); because the celery worker and the API process are separate registries with no pushgateway, the worker writes them to Redis and the `/metrics` endpoint mirrors them at scrape time (fail-open).

## Civilian Report + Registered Pending-Photo Attach (Slice D — 2026-07-12)
- `POST /api/civilian/reports` now also wires an authenticated `CIVILIAN_REPORTER`'s own pending photos into the same transaction. An `optional_auth` dependency supplies the server-derived `contributor_user_id` (never request-body); the route triages registered → anonymous-capability → neutral 422 when `photo_ids` is present.
- The registered branch calls `wims.attach_registered_photos(:p_user_id, :report_id, :photo_ids::uuid[])` (Slice C helper) and, on success, emits a `PHOTO_UPLOAD_ATTACH` audit (`record_id=report_id`, `new_values={"photo_ids": [...]}`, `sensitive=True`) before `CIVILIAN_REPORT_SUBMIT` and `db.commit()`.
- A `FALSE` helper result (cross-owner/partial/duplicate/already-attached/terminal/wrong-owner) raises neutral `422` and rolls back the report INSERT — no orphan report, no audit row. The new `except HTTPException: db.rollback(); raise` preserves deliberate 422/404 while unexpected errors remain 500; the anonymous branch behaves identically.
- Atomicity and all rejection semantics live in the `0011`/`90` `SECURITY DEFINER` helper (granted to `wims_app` only); the route only raises neutral `422` when the helper returns FALSE. No new RLS policy or `BYPASSRLS` was introduced.

## Civilian Photo Upload (v5 — 2026-07-10)
- `POST /api/civilian/reports` now accepts `client_report_id` (UUID string) in the JSON body for idempotent report submission. Parsed before rate-limit check: if `client_report_id` matches an existing row, returns 200 with the existing report without consuming per-IP quota.
- `POST /api/civilian/reports/{report_id}/photos` accepts optional `client_photo_id` (UUID), EXIF GPS fields (`exif_gps_lat`, `exif_gps_lon`, `exif_gps_altitude`, `exif_datetime_original`), and browser GPS fields. Uses atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING` for idempotent retry. Photo cap check occurs after the INSERT for idempotent requests. Returns `duplicate: true` with `photo_id: null` on duplicate.
- New schema columns: `exif_gps_lat`, `exif_gps_lon`, `exif_gps_altitude`, `exif_datetime_original`, `exif_data_source` (EXIF provenance), `client_photo_id` (photo idempotency), `client_report_id` (report idempotency).
- Migrations: 83 (EXIF), 84 (photo idempotency), 85 (report idempotency). Alembic revision 0003.

## Operations (Linked Reports)
- `GET /api/operations` returns active operation rows by default with `linked_report_ids` and PII-free `linked_reports` detail objects derived from `wims.citizen_reports.location` via PostGIS; `?archived=true` switches to the read-only archive board.
- `GET /api/operations/linkable-reports` is `NATIONAL_VALIDATOR`-only and returns eligible non-rejected civilian reports for operation linking, including disabled already-linked cards.
- `GET /api/operations/reset-preview` and `POST /api/operations/reset-day` are `NATIONAL_VALIDATOR`-only. Reset archives non-kept active operations, carries over `keep_overnight` rows once, and records `wims.operation_reset_batches`.
- `POST /api/operations/{operation_id}/restore` is `NATIONAL_VALIDATOR`-only and restores an archived operation with an explicit chosen fire status.
- `POST /api/operations/{operation_id}/link` and `DELETE /api/operations/{operation_id}/link/{report_id}` enforce one-operation-per-report and transactional status transitions.

## Related
- [[concepts/frs-module-map]]
- [[operations/agent-routing-guide]]
