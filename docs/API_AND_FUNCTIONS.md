# WIMS-BFP API and Function Reference

## Backend API Routes (FastAPI)

Source of truth: `src/backend/main.py` and `src/backend/api/routes/*.py`

### App-Level Auth Routes (`main.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | Public | Stub login endpoint; guarded by Redis sliding-window middleware. |
| POST | `/api/auth/callback` | Public | Exchanges PKCE code with Keycloak and upserts user in `wims.users`. |
| GET | `/api/user/me` | JWT (`get_current_user`) | Returns merged token + user profile payload; provisions user on first access if needed. |

### Incident Routes (`api/routes/incidents.py`, prefix `/api`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/incidents` | `get_current_wims_user` | Creates incident with geospatial point and returns incident response payload. |
| POST | `/api/incidents/{incident_id}/attachments` | `get_current_wims_user` | Uploads incident attachment to storage and records metadata/hash in DB. |

### Civilian Reporting (`api/routes/civilian.py`, prefix `/api/civilian`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/civilian/reports` | Public | Submits citizen report with `PENDING` status and zero trust score. |

### Triage (`api/routes/triage.py`, prefix `/api/triage`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/triage/pending` | ENCODER or VALIDATOR | Lists pending citizen reports. |
| POST | `/api/triage/{report_id}/promote` | ENCODER or VALIDATOR | Promotes a pending citizen report into official incident records. |

### Admin (`api/routes/admin.py`, mounted with `/api/admin` in `main.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/admin/users` | SYSTEM_ADMIN | Lists users with masked Keycloak IDs. |
| PATCH | `/api/admin/users/{user_id}` | SYSTEM_ADMIN | Updates user role/assignment/active state. |
| GET | `/api/admin/security-logs` | SYSTEM_ADMIN | Lists security telemetry entries. |
| POST | `/api/admin/security-logs/{log_id}/analyze` | SYSTEM_ADMIN | Runs AI narrative analysis for a threat log. |
| PATCH | `/api/admin/security-logs/{log_id}` | SYSTEM_ADMIN | Updates admin action/resolution fields. |
| GET | `/api/admin/audit-logs` | SYSTEM_ADMIN | Returns paginated audit trail entries. |

### Analytics (`api/routes/analytics.py`, prefix `/api/analytics`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/analytics/heatmap` | Analyst/Admin guard | Returns GeoJSON-style incident points with filter support. |
| GET | `/api/analytics/trends` | Analyst/Admin guard | Returns bucketed count series (`daily`, `weekly`, `monthly`). |
| GET | `/api/analytics/comparative` | Analyst/Admin guard | Returns two-range counts and variance percentage. |
| POST | `/api/analytics/export/csv` | Analyst/Admin guard | Dispatches CSV export task and returns task id. |

### Regional (`api/routes/regional.py`, prefix `/api/regional`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/regional/afor/import` | `get_regional_encoder` | Parses uploaded AFOR `.xlsx/.xls/.csv` into validated preview rows. |
| POST | `/api/regional/afor/commit` | `get_regional_encoder` | Commits validated AFOR rows as batch + incident detail records. |
| GET | `/api/regional/incidents` | `get_regional_encoder` | Lists incidents scoped to assigned region with filters/pagination. |
| GET | `/api/regional/incidents/{incident_id}` | `get_regional_encoder` | Fetches single incident detail scoped to assigned region. |
| GET | `/api/regional/stats` | `get_regional_encoder` | Returns regional summary metrics. |

### Reference Data (`api/routes/ref.py`, prefix `/api/ref`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/ref/regions` | `get_current_wims_user` | Returns region reference records (optional `region_id` filter). |

## Frontend → backend “edge” naming (`src/frontend/src/lib/edgeFunctions.ts`)

The module name is historical. Calls use `apiFetch` against the **FastAPI** app (`NEXT_PUBLIC_API_URL`, typically `/api`). Equivalent behavior previously lived in hosted Supabase Edge Functions; those have been removed from the repo. Implement or extend behavior in `src/backend/api/routes/` and `main.py`.

## Frontend Routes (Next.js App Router)

Source: `src/frontend/src/app/`

### Public/Entry Routes

| Path | Purpose |
|---|---|
| `/` | Landing route that renders login page component. |
| `/login` | Login screen; redirects by role once authenticated. |
| `/callback` | OIDC callback finalization and token sync to server route. |
| `/report` | Public emergency report submission page. |

### Authenticated App Routes

| Path | Purpose |
|---|---|
| `/dashboard` | Main dashboard with role-based redirects and analytics widgets. |
| `/dashboard/regional` | Regional encoder dashboard and quick regional summaries. |
| `/dashboard/analyst` | Analyst heatmap/trend/comparative dashboard. |
| `/home` | Operations center view splitting ongoing vs fire-out incidents. |
| `/incidents` | Incident list/table with filter + role action cards. |
| `/incidents/create` | Manual incident entry form (encoder-guarded in page logic). |
| `/incidents/import` | Bulk incident import workflow (encoder/regional-encoder guarded). |
| `/incidents/triage` | Triage queue and promote action flow (encoder/validator access). |
| `/incidents/new` | Map-assisted new incident submission route for authenticated users. |
| `/incidents/[id]` | Incident detail page. |
| `/afor/import` | AFOR import page entry for regional workflows. |
| `/afor/create` | AFOR create flow page. |
| `/admin` | Redirect route to system admin page. |
| `/admin/system` | SYSTEM_ADMIN operations hub (users, security logs, audit logs, AI analyze action). |

## Next Route Handlers (`src/frontend/src/app/api/auth/`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/session` | Resolves current user session by forwarding cookie to backend `/api/user/me`. |
| POST | `/api/auth/sync` | Sets HttpOnly `access_token` cookie; also supports code exchange forwarding to backend callback. |
| POST | `/api/auth/logout` | Clears auth cookies (`access_token`, `refresh_token`). |
