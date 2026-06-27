# Design Spec: Admin Backup Management UI

**Date:** 2026-06-27
**Status:** Draft
**Gap References:** GAP-A01, GAP-A02 (admin-hub-hci-ux-gap-register.md)

---

## Overview

The admin backup management system is completely missing from the frontend despite a fully implemented backend (4 endpoints). This spec covers the full UI: an admin hub summary card, a dedicated backup management page with timeline, trigger, scheduling, download, delete, and restore.

### Scope

| In Scope | Out of Scope |
|----------|-------------|
| Admin hub summary card (`/admin/system`) | Other unwired backend panels (rate limits, worker status, system metrics) |
| Dedicated backup page (`/admin/backups`) | Multi-region backup or cross-region replication |
| Backup trigger + status feedback | Differential or incremental backup |
| Backup scheduling (custom cron) | Backup encryption key rotation UI |
| Backup timeline listing grouped by date | Backup comparison/diff between snapshots |
| Backup download per row | Bulk backup export/import |
| Backup delete per row | Cloud storage offload (S3, etc.) |
| Restore with danger-zone UX | Restore preview/dry-run |
| Backup manifest (data snapshot at backup time) | Real-time data currency monitoring |
| Backup scheduling (Celery beat task) | |
| Recommended-cadence nudge (7-day threshold) | |

### Design Principles

- **Danger-zone clarity**: Restore actions must be visually distinct with multi-step confirmation (type filename to enable).
- **Progressive disclosure**: Summary card shows essentials; dedicated page shows the full tool.
- **Timeline metaphor**: Backups grouped by date — admins think in terms of "what did I have yesterday" not flat file lists.
- **Manifest at a glance**: Each backup row shows what data it contains without requiring decryption.
- **Retention transparency**: Always show slot usage (14/100) so admins know when old backups get auto-deleted.
- **No emoji**: All icons are inline SVGs consistent with the existing admin hub design system.

---

## Architecture

### Routes

| Route | Purpose | Type |
|-------|---------|------|
| `/admin/system` | Admin hub page — add backup summary card | Existing page, new section |
| `/admin/backups` | Dedicated backup management page | New page |

### Frontend Components

```
src/frontend/src/app/admin/
├── system/page.tsx                  # + BackupManagerCard section (last section)
└── backups/
    └── page.tsx                     # Full backup management page (new)

src/frontend/src/lib/api/
├── admin.ts                         # + backup API functions
├── index.ts                         # + barrel export
└── offlineAdmin.ts                  # + offline-aware backup functions (optional)

src/frontend/src/components/admin/   # (optional: extract shared components)
```

### Backend Additions Needed

| Change | Purpose | Notes |
|--------|---------|-------|
| `DELETE /api/admin/backup/{filename}` | Delete a backup file | Not yet implemented |
| `GET /api/admin/backup/{filename}/manifest` | Serve backup manifest metadata | Uses manifest file stored next to .sql.enc |
| `DELETE /api/admin/backup/{filename}` | Delete a backup file + its manifest | Not yet implemented |
| `GET /api/admin/backup/{filename}/manifest` | Serve backup manifest metadata | Uses manifest file stored next to .sql.enc |
| `POST /api/admin/backup-schedule` | Save backup schedule config | Stored in `wims.backup_schedule` table |
| `GET /api/admin/backup-schedule` | Read current backup schedule + next_run | Computed server-side |
| New Celery beat task | Execute scheduled backup per cron | Registered in `celery_config.py` |
| Modify `trigger_backup` | Write manifest alongside encrypted backup | Snapshot queries before encryption (runs on admin-context db session) |
| Modify `_apply_backup_retention` | Also delete `.manifest.json` siblings | Prevent orphaned manifest files |
| Modify `list_backups` | Fold manifest data into response | Read sibling `.manifest.json` server-side to avoid N+1 |
| Modify `restore_backup` | Stream to disk instead of in-memory cap | Remove the 50 MB in-memory cap; enforce a configurable filesystem-level cap |

### Data Flow — Backup Trigger

```
Admin clicks "Trigger Backup Now"
  → POST /api/admin/backup
  → Backend runs pg_dump → .sql file
  → Backend runs snapshot queries → manifest.json
  → Backend encrypts .sql → .sql.enc
  → Backend writes manifest.json next to .sql.enc
  → Backend applies retention (delete oldest if > 100)
  → Backend logs BACKUP_TRIGGERED audit
  → Returns {filename, size_bytes, created_at}
  → Frontend refreshes timeline
```

### Data Flow — Restore

```
Admin drags .sql.enc file to danger zone
  → Frontend validates filename format (client-side)
  → Admin types filename to confirm
  → Admin clicks "Restore Database"
  → POST /api/admin/restore (multipart upload)
  → Backend validates WIMSBAO1 header
  → Backend decrypts → psql restore
  → Backend logs BACKUP_RESTORED audit
  → Frontend shows success with re-login instruction
```

---

## Design Section 1: Admin Hub Summary Card

### Location

Last section on `/admin/system`, after "Scheduled Reports".

### Layout

```
┌──────────────────────────────────────────────────────────┐
│ [bookmark icon] Backup Manager           [→ Open Backup] │
├──────────────────────────────────────────────────────────┤
│  Last Backup        Total Backups       Storage Used      │
│  14 minutes ago     14 / 100            672 MB            │
│  2026-06-27 14:30   Slots used          ~48 MB avg       │
├──────────────────────────────────────────────────────────┤
│  Latest Backup                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ wims_20260627_143000.sql.enc  [WIMSBAO1]    45.2 MB │ │
│  │ [file icon] Last incident: 2026-06-27 14:28          │ │
│  │ [people icon] Last civilian: 2026-06-27 12:15        │ │
│  │ [doc icon] Records: 847 incidents · 2,103 civilians  │ │
│  │ [users icon] Users: 24 · Reports: 312                │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Cadence Nudge

If no backup has been taken in **7+ days**, show an amber warning above the stats row:

```
┌──────────────────────────────────────────────────────────┐
│ [warning icon] No backup taken in 3 days — consider      │
│ triggering one.                                          │
└──────────────────────────────────────────────────────────┘
```

- **Threshold**: 7 days without a backup
- **Color**: Amber/yellow background (`bg-amber-50`, `border-amber-200`)
- **Text**: "No backup taken in {X} days — consider triggering one."
- **Link**: "Trigger" links to `/admin/backups`

### Empty State

If no backups exist at all, show:

```
┌──────────────────────────────────────────────────────────┐
│ [bookmark icon] Backup Manager           [→ Open Backup] │
├──────────────────────────────────────────────────────────┤
│  No backups created yet.                                  │
│  [→ Trigger your first backup in the Backup Manager]      │
└──────────────────────────────────────────────────────────┘
```

---

## Design Section 2: Dedicated Backup Page

### Route: `/admin/backups`

### Layout

```
┌───────────────────────────────────────────────────────────────┐
│ [bookmark] Backup Manager                   [🔄 Refresh]     │
├───────────────────────────────────────────────────────────────┤
│ ┌──────────┬──────────┬──────────┬──────────┐                 │
│ │Last Bkup │Total     │Storage   │Oldest    │                 │
│ │14m ago   │14 / 100  │672 MB    │14d ago   │                 │
│ └──────────┴──────────┴──────────┴──────────┘                 │
│                                                               │
│ ┌─ Trigger ───────────────────────────────────────────────┐   │
│ │ [🔄 Trigger Backup Now]  Status: Idle    [●] Healthy   │   │
│ │ Last backup: 14 min ago · Auto-retention: 100 max      │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Schedule ──────────────────────────────────────────────┐   │
│ │ ☐ Enable automatic backups                              │   │
│ │ Cron expression: [0 2 * * *  ▼] [Validate]              │   │
│ │ ┌─────────────────────────────────────────────────────┐ │   │
│ │ │ Presets: Every 6h │ Every 12h │ Daily at 02:00 UTC  │ │   │
│ │ │          Weekly Sun 03:00 │ Custom                   │ │   │
│ │ └─────────────────────────────────────────────────────┘ │   │
│ │ Next run: Today 02:00 UTC  [Save Schedule]              │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Backup Timeline ───────────────────────────────────────┐   │
│ │ [calendar] Backup Timeline              [14] [Sort ▼]   │   │
│ │                                                         │   │
│ │ ■ Today                                                 │   │
│ │ ● wims_20260627_143000  [WIMSBAO1]     45 MB  14m [⬇][🗑]│   │
│ │   847 inc · 2,103 civ · 24 users                        │   │
│ │ ● wims_20260627_120000  [WIMSBAO1]     42 MB   2h [⬇][🗑]│   │
│ │ ● wims_20260627_090000  [Legacy AES]   44 MB   5h [⬇][🗑]│   │
│ │                                                         │   │
│ │ ■ Yesterday                                             │   │
│ │ ● wims_20260626_180000  [WIMSBAO1]     46 MB  20h [⬇][🗑]│   │
│ └────────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Danger Zone: Restore ──────────────────────────────────┐   │
│ │ [warning icon] Restore REPLACES the live database       │   │
│ │ ┌──────────────────────────────────────────────┐        │   │
│ │ │ [upload icon] Drop .sql.enc here or browse   │        │   │
│ │ │              Max 50 MB                       │        │   │
│ │ └──────────────────────────────────────────────┘        │   │
│ │ [✓] wims_20260627_143000.sql.enc  45 MB · WIMSBAO1     │   │
│ │                                  Header valid ✓        │   │
│ │ Type filename to confirm: [________________________]   │   │
│ │ [🔄 Restore Database] (disabled until confirmed)       │   │
│ └────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

### Section Details

#### Summary Bar (4 stat cards)
- **Last Backup**: Relative + absolute timestamp
- **Total Backups**: Count / max (retention cap)
- **Storage Used**: Total bytes + avg per backup
- **Oldest Backup**: Age of oldest backup file

#### Trigger Section
- Green "Trigger Backup Now" button with refresh icon
- During backup (120s timeout): button shows spinner + "Backing up..."
- Status text: Idle / Backing up... / Last backup at {time}
- Retention indicator: current count / max

#### Schedule Section
- Toggle: Enable/disable automatic backups
- Custom cron input with inline validation (cron syntax helper)
- Preset buttons for quick selection: Every 6h, Every 12h, Daily 02:00, Weekly Sun 03:00, Custom
- "Validate" button: tests cron expression against server-side validator
- "Save Schedule" button: POST to `/api/admin/backup-schedule`
- "Next run" display: computed from cron + current time
- When disabled: schedule is persisted but cron task skips execution

#### Backup Timeline
- Grouped by date header (Today, Yesterday, then date headings)
- Each row:
  - Green dot indicator
  - Filename (monospace) + encryption format badge (WIMSBAO1=blue, Legacy AES=amber)
  - Manifest summary line: incident count, civilian count, user count
  - File size (right-aligned)
  - Relative time (right-aligned)
  - Download icon button
  - Delete icon button (with confirmation)
- Sort dropdown: Newest first (default), Oldest first, By size
- Pagination if > 50 backups

#### Danger Zone: Restore
- Red border, red header with warning icon
- Warning text: "Restoring will REPLACE the live database..."
- Drag-and-drop file upload zone (or click to browse)
- Client-side validation: filename must match `^wims_\d{8}_\d{6}\.sql\.enc$`
- File preview after selection: filename, size, format badge, header validation status
- Confirmation: type the exact filename to enable the restore button
- Restore button: disabled until filename matches, then red with refresh icon
- During restore (180s timeout): progress states — "Uploading...", "Decrypting...", "Restoring database..."
- Post-restore: success message with "Please re-login" instruction

### States

| State | Trigger Section | Timeline | Restore |
|-------|----------------|----------|---------|
| **Loading** | Button disabled, skeleton | Skeleton rows | Upload disabled |
| **Empty** | — | "No backups yet. Trigger your first backup." | — |
| **Normal** | Green button, Idle | Full timeline | Drop zone active |
| **Triggering** | Spinner, "Backing up...", button disabled | Greyed out | Upload disabled |
| **Trigger success** | Toast: "Backup created", auto-refresh timeline | New row appears | — |
| **Trigger error** | Toast: "Backup failed: {reason}", button re-enabled | Unchanged | — |
| **Delete** | — | Row removed with animation | — |
| **Deleting** | — | Row dimmed, spinner | — |
| **Restore idle** | — | — | Drop zone active, no file |
| **Restore file selected** | — | — | File preview shown, confirm field empty |
| **Restore confirmed** | — | — | Button enabled |
| **Restoring** | — | — | Progress states, all controls disabled |
| **Restore success** | — | — | Green success + re-login instruction |
| **Restore error** | — | — | Red error + retry option |

---

## Design Section 3: Backend Additions

### 3.1 Backup Manifest

On each backup trigger, before encryption, run snapshot queries:

Since the backup is encrypted (AES-256-GCM or OpenBao Transit), we cannot read its contents without the decryption key. The manifest captures a lightweight data snapshot **before** encryption, stored as a plain JSON file alongside the `.sql.enc` file, so the admin can see what's inside each backup without decrypting it.

On each backup trigger, before encryption, run snapshot queries against the admin-context DB session:

```sql
SELECT COUNT(*) AS incident_count FROM wims.fire_incidents;
SELECT COUNT(*) AS citizen_count FROM wims.citizen_reports;
SELECT COUNT(*) AS user_count FROM wims.users;
SELECT MAX(updated_at) AS last_incident_update FROM wims.fire_incidents;
SELECT MAX(created_at) AS last_citizen_report FROM wims.citizen_reports;
SELECT MAX(created_at) AS last_user_change FROM wims.users;
```

> **Note:** The schema uses `wims.citizen_reports` (not `civilian_reports`). All tables are schema-qualified with `wims.` since the snapshot runs through the SQLAlchemy session. RLS is fine — `SYSTEM_ADMIN` has unrestricted SELECT on all tables (verified in `10_rls_policies.sql:157`).

Manifest JSON file (`wims_20260627_143000.manifest.json`) stored next to encrypted backup:

```json
{
  "backup_filename": "wims_20260627_143000.sql.enc",
  "triggered_at": "2026-06-27T14:30:00Z",
  "provider": "openbao_transit",
  "record_counts": {
    "incidents": 847,
    "citizens": 2103,
    "users": 24
  },
  "last_updates": {
    "incident": "2026-06-27T14:28:00Z",
    "citizen_report": "2026-06-27T12:15:00Z",
    "user_change": "2026-06-27T10:00:00Z"
  }
}
```

### 3.2 New API Endpoints

#### `DELETE /api/admin/backup/{filename}`

Delete a specific backup file + its manifest. Validates filename format and path traversal. Returns 204 No Content on success, 404 if not found.

#### `GET /api/admin/backup/{filename}/manifest`

Serve the manifest JSON file for a backup. Same filename validation as download. Returns the manifest object, or 404 if no manifest exists (legacy backup without manifest).

#### `POST /api/admin/backup-schedule`

Save backup schedule configuration. Body:

```json
{
  "enabled": true,
  "cron_expr": "0 2 * * *"
}
```

Stored in a new `wims.backup_schedule` table (single-row config, upsert pattern).

#### `GET /api/admin/backup-schedule`

Returns the current schedule config (or null if never set). `next_run` is computed server-side using `croniter` against `last_run_at`:

```json
{
  "enabled": true,
  "cron_expr": "0 2 * * *",
  "next_run": "2026-06-28T02:00:00Z",
  "last_run_at": "2026-06-27T14:30:00Z",
  "last_backup_filename": "wims_20260627_143000.sql.enc"
}
```

### 3.3 Celery Beat Task: `execute_scheduled_backup`

- Check `wims.backup_schedule` for `enabled = true`
- Compute if the cron has fired since `last_run_at` using `croniter` (against the current time window)
- Dedup guard: if `last_run_at >= prev_cron_trigger`, skip (prevents double-fire within the 5-min check window)
- If due, set `last_run_at = now()` in the schedule row (before executing, as an optimistic lock)
- Execute the same logic as `trigger_backup`
- Update `last_backup_filename` on success
- Registered in `celery_config.py` with a 5-minute check interval
- Concurrency guard: skip if a backup is already running (in-memory flag or `running` column in schedule table)

### 3.4 Modify `trigger_backup`

After `pg_dump` succeeds and before encryption:
1. Run snapshot queries against the admin-context db session (not a fresh unscoped connection)
2. Write manifest JSON to `BACKUP_DIR / {filename}.manifest.json`
3. The manifest is written BEFORE encryption so it remains readable without the key

**Semantics note:** `trigger_backup` returns HTTP 202 Accepted but currently runs synchronously (subprocess with 120s timeout). The 202 is misleading — no async job is created. The frontend should handle this as a synchronous wait. Future improvement: offload to Celery task for true async.

**Concurrency guard:** Consider adding an in-memory or Redis lock to prevent two concurrent triggers (manual + scheduled overlap, or two admins clicking simultaneously). A simple approach: a `BACKUP_RUNNING` sentinel file or an atomic Redis key with TTL = 180s.

### 3.5 Modify `_apply_backup_retention`

When deleting a stale `.sql.enc` file, also delete its sibling manifest:

```python
# After backup_path.unlink()
manifest_path = backup_path.with_suffix(".sql.enc.manifest.json")
if manifest_path.exists():
    manifest_path.unlink()
```

> The current retention regex (`^wims_\d{8}_\d{6}\.sql\.enc$`) already excludes `.manifest.json` files from the count, preventing them from being counted as backups. But orphaned manifests would accumulate. The fix above ensures they're cleaned up.

### 3.6 Modify `list_backups` to Fold Manifest Data

Current `list_backups` returns `[{filename, size_bytes, created_at}]`. Modify it to read each backup's sibling `.manifest.json` and include manifest fields in the response:

```python
manifest_path = BACKUP_DIR / (f.name + ".manifest.json")
manifest_data = {}
if manifest_path.exists():
    try:
        manifest_data = json.loads(manifest_path.read_text())
    except (json.JSONDecodeError, OSError):
        pass  # treat missing/corrupt manifest gracefully
```

Response becomes:

```json
[
  {
    "filename": "wims_20260627_143000.sql.enc",
    "size_bytes": 47350000,
    "created_at": "2026-06-27T14:30:00Z",
    "provider": "openbao_transit",
    "manifest": {
      "record_counts": {"incidents": 847, "citizens": 2103, "users": 24},
      "last_updates": {
        "incident": "2026-06-27T14:28:00Z",
        "citizen_report": "2026-06-27T12:15:00Z",
        "user_change": "2026-06-27T10:00:00Z"
      }
    }
  }
]
```

**Legacy backups** (pre-manifest) will have `manifest: null` — the frontend renders these as: "No manifest — backup data unavailable" with a dimmed appearance.

### 3.7 Modify `restore_backup`: Stream to Disk, Remove In-Memory Cap

The current `restore_backup` reads the entire upload into memory (`safe_read_upload`) and enforces a 50 MB default cap. This breaks once backups grow beyond 50 MB (the spec's own mockups show 45-46 MB with "~48 MB avg").

Fix: stream the uploaded file directly to a temp file on disk, then check the file size as a configurable cap. Default cap raised to 1 GB:

```python
_max_backup_bytes = int(os.getenv("WIMS_MAX_BACKUP_BYTES", str(1024 * 1024 * 1024)))  # 1 GB default

# Stream to temp file instead of in-memory
with tempfile.TemporaryDirectory() as tmpdir:
    tmp_enc = Path(tmpdir) / filename
    with open(tmp_enc, "wb") as f:
        while chunk := await file.read(64 * 1024):  # 64 KB chunks
            f.write(chunk)
    
    # Check filesystem-level cap
    if tmp_enc.stat().st_size > _max_backup_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds the {_max_backup_bytes // (1024*1024)} MB limit")
    
    # Read first bytes for header validation only
    header = tmp_enc.read_bytes(8)
    if not header.startswith(b"WIMSBAO1"):
        raise HTTPException(...)
```

This removes the in-memory cap that made restore non-functional for realistic backup sizes.

---

## Error Handling

| Scenario | Frontend Behavior |
|----------|-------------------|
| Trigger: pg_dump not found | Toast: "Backup failed: pg_dump is not installed on the server." |
| Trigger: timeout (120s) | Toast: "Backup timed out after 120s. The database may be large — try again when load is lower." |
| Trigger: disk full | Toast: "Backup failed: insufficient disk space." |
| Trigger: encryption failed | Toast: "Backup created but encryption failed. Contact system administrator." |
| Download: file not found | Toast: "Backup file not found. It may have been deleted or expired." |
| Delete: file not found | Toast: "Backup file not found — it may have already been deleted." |
| Restore: invalid file format | Inline error: "Invalid backup file. Must be a .sql.enc file." |
| Restore: header invalid | Inline error: "Backup file header invalid — file may be corrupted." |
| Restore: decryption failed | Inline error: "Decryption failed. The encryption key may have changed since this backup was created." |
| Restore: timeout (180s) | Toast: "Restore timed out. The database may be large — check database state manually." |
| Restore: psql error | Inline error: "Database restore failed: {truncated error message from backend}" |
| Restore: file too large | Inline error: "File exceeds the maximum upload size." |
| Upload: auth required | Use blob fetch with Authorization header. A plain `<a>` anchor won't send auth. |
| Schedule: invalid cron | Inline error: "Invalid cron expression. Use standard 5-field format." |
| Network failure | Use existing offline-aware patterns (`offlineAdmin.ts`) |

---

## Spec Self-Review

- **Placeholders**: None. All sections are filled.
- **Internal consistency**: 
  - Manifest is produced during trigger and consumed in list_backups. ✓
  - Retention cleanup deletes both `.sql.enc` and `.manifest.json`. ✓
  - Schedule dedup uses `last_run_at` + `croniter`. ✓
  - Restore streams to disk (no in-memory size cap). ✓
  - Manifest queries use correct table names (`wims.citizen_reports`, not `civilian_reports`). ✓
  - The 7-day nudge threshold is explicit. ✓
- **Scope**: Focused on backup management. Unrelated admin hub gaps (rate limits, worker status, system metrics) are explicitly out of scope.
- **Ambiguity**: 
  - Restore streaming approach is explicit (64 KB chunks, filesystem cap after write). ✓
  - Schedule dedup is explicit (`last_run_at` + `croniter` + optimistic lock). ✓
  - Manifest loading for legacy backups is explicit (`null` → dimmed display). ✓
- **Backend changes required**: DELETE endpoint, manifest endpoint, schedule endpoints, Celery task, trigger modification, retention fix, list_backups manifest fold, restore streaming fix. All documented in Design Section 3.
- **Known concerns addressed**:
  - Table name correctness verified against actual schema (`wims.citizen_reports`, not `civilian_reports`; no `incident_reports` table — dropped that stat)
  - 50 MB restore cap fixed (stream to disk, 1 GB default)
  - Manifest orphan on retention fixed (delete sibling)
  - N+1 manifest fetch fixed (fold into list_backups)
  - Legacy backup no-manifest state handled (`manifest: null`)
  - Download uses blob fetch (not plain anchor)
  - 202 semantics noted (synchronous despite 202)
  - Concurrency guard noted (lock or sentinel)
  - RLS context noted (admin session is correct)
  - Schedule dedup specified (last_run_at + croniter + optimistic lock)

---

## Future Considerations (Not In Scope)

- Backup comparison/diff between two timeline points
- Cloud storage offload to S3-compatible object storage
- Backup encryption key rotation tracking per file
- Restore dry-run / preview mode
- Multi-region backup coordination
