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
| `POST /api/admin/backup-schedule` | Save backup schedule config | Stores cron + enabled in DB |
| `GET /api/admin/backup-schedule` | Read current backup schedule | |
| New Celery beat task | Execute scheduled backup per cron | Registered in `celery_config.py` |
| Modify `trigger_backup` | Write manifest alongside encrypted backup | Snapshot queries before encryption |

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

```sql
-- Examples of what the manifest captures
SELECT COUNT(*) AS incident_count FROM fire_incidents;
SELECT COUNT(*) AS civilian_count FROM civilian_reports;
SELECT COUNT(*) AS user_count FROM wims.users;
SELECT MAX(updated_at) AS last_incident_update FROM fire_incidents;
SELECT MAX(created_at) AS last_civilian_report FROM civilian_reports;
SELECT MAX(created_at) AS last_user_change FROM wims.users;
SELECT COUNT(*) AS report_count FROM incident_reports;
```

Manifest JSON file (`wims_20260627_143000.manifest.json`) stored next to encrypted backup:

```json
{
  "backup_filename": "wims_20260627_143000.sql.enc",
  "triggered_at": "2026-06-27T14:30:00Z",
  "provider": "openbao_transit",
  "record_counts": {
    "incidents": 847,
    "civilians": 2103,
    "users": 24,
    "reports": 312
  },
  "last_updates": {
    "incident": "2026-06-27T14:28:00Z",
    "civilian_report": "2026-06-27T12:15:00Z",
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

Stored in a new `wims.backup_schedule` table or as a single-row config.

#### `GET /api/admin/backup-schedule`

Returns the current schedule config (or null if never set):

```json
{
  "enabled": true,
  "cron_expr": "0 2 * * *",
  "next_run": "2026-06-28T02:00:00Z",
  "last_backup_at": "2026-06-27T14:30:00Z"
}
```

### 3.3 Celery Beat Task: `execute_scheduled_backup`

- Check `wims.backup_schedule` for enabled + due cron
- If due, call the same logic as `trigger_backup`
- Registered in `celery_config.py` with a frequent check interval (e.g., every 5 minutes)

### 3.4 Modify `trigger_backup`

After `pg_dump` succeeds and before encryption:
1. Run snapshot queries against the live DB
2. Write manifest JSON to `BACKUP_DIR / {filename}.manifest.json`

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
| Restore: file too large | Inline error: "File exceeds the 50 MB limit." |
| Schedule: invalid cron | Inline error: "Invalid cron expression. Use standard 5-field format." |
| Network failure | Use existing offline-aware patterns (`offlineAdmin.ts`) |

---

## Spec Self-Review

- **Placeholders**: None. All sections are filled.
- **Internal consistency**: The manifest is produced during trigger and consumed in timeline rows. The schedule section references a Celery beat task that would be added. The nudge threshold is explicitly 7 days.
- **Scope**: Focused on backup management. Unrelated admin hub gaps (rate limits, worker status, etc.) are explicitly out of scope.
- **Ambiguity**: Schedule persistence medium left open (new DB table vs single-row config) — both work, defer to implementation.
- **Backend changes are required**: DELETE endpoint, manifest endpoint, schedule endpoints, Celery task, trigger modification. These are documented in Design Section 3.

---

## Future Considerations (Not In Scope)

- Backup comparison/diff between two timeline points
- Cloud storage offload to S3-compatible object storage
- Backup encryption key rotation tracking per file
- Restore dry-run / preview mode
- Multi-region backup coordination
