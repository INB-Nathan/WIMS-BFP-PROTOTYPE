# Implementation Plan: Admin Backup Management UI

**Date:** 2026-06-27
**Spec:** `docs/superpowers/specs/2026-06-27-admin-backup-ui-design.md`
**Branch target:** `master` (PR after `validator-operation-modal-ux` is merged)

---

## Overview

Implement the full admin backup management UI: backend fixes/additions, API layer, admin hub summary card, dedicated backup page with timeline/trigger/schedule/restore.

---

## Phase 1: Backend — Fixes & Additions

### Step 1.1 — SQL Migration: `wims.backup_schedule` table

**File:** `src/postgres-init/74_backup_schedule.sql`

```sql
-- 74_backup_schedule.sql
-- Single-row config table for automated backup scheduling.

CREATE TABLE IF NOT EXISTS wims.backup_schedule (
    id            INTEGER PRIMARY KEY DEFAULT 1,
    enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    cron_expr     TEXT NOT NULL DEFAULT '0 2 * * *',
    last_run_at   TIMESTAMPTZ,
    last_backup_filename TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT single_row CHECK (id = 1)
);

-- SYSTEM_ADMIN has full access; other roles have no access (RLS default-deny).
ALTER TABLE wims.backup_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.backup_schedule FORCE ROW LEVEL SECURITY;

CREATE POLICY backup_schedule_admin_all ON wims.backup_schedule
    FOR ALL
    USING (wims.current_user_role() = 'SYSTEM_ADMIN')
    WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');
```

### Step 1.2 — Modify `_apply_backup_retention` to delete manifest siblings

**File:** `src/backend/api/routes/admin/backups.py`

In `_apply_backup_retention()`, after `backup_path.unlink()`, add:

```python
# Delete sibling manifest to prevent orphaned files
manifest_path = backup_path.with_suffix(".sql.enc.manifest.json")
try:
    manifest_path.unlink()
except FileNotFoundError:
    pass
```

### Step 1.3 — Add manifest writing to `trigger_backup`

**File:** `src/backend/api/routes/admin/backups.py`

In `trigger_backup`, after `encrypted_path = encrypt_backup(output_path)` succeeds and before `_apply_backup_retention()`, run snapshot queries and write manifest:

```python
# ── Backup manifest snapshot ──────────────────────────────
from sqlalchemy import text
try:
    snapshot = db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM wims.fire_incidents) AS incident_count,
            (SELECT COUNT(*) FROM wims.citizen_reports) AS citizen_count,
            (SELECT COUNT(*) FROM wims.users) AS user_count,
            (SELECT MAX(updated_at) FROM wims.fire_incidents) AS last_incident_update,
            (SELECT MAX(created_at) FROM wims.citizen_reports) AS last_citizen_report,
            (SELECT MAX(created_at) FROM wims.users) AS last_user_change
    """)).mappings().one()

    manifest = {
        "backup_filename": filename,
        "triggered_at": created_at,
        "provider": _resolve_backup_provider(),
        "record_counts": {
            "incidents": snapshot["incident_count"],
            "citizens": snapshot["citizen_count"],
            "users": snapshot["user_count"],
        },
        "last_updates": {
            "incident": snapshot["last_incident_update"].isoformat() if snapshot["last_incident_update"] else None,
            "citizen_report": snapshot["last_citizen_report"].isoformat() if snapshot["last_citizen_report"] else None,
            "user_change": snapshot["last_user_change"].isoformat() if snapshot["last_user_change"] else None,
        },
    }

    manifest_path = encrypted_path.with_suffix(".sql.enc.manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2))
except Exception:
    logger.warning("Failed to write backup manifest (non-fatal)", exc_info=True)
```

Add `import json` at the top of the file.

### Step 1.4 — Modify `list_backups` to fold manifest data

**File:** `src/backend/api/routes/admin/backups.py`

In `list_backups`, after constructing each file dict, read sibling manifest:

```python
files = []
for f in BACKUP_DIR.glob("wims_*.sql.enc"):
    stat = f.stat()
    entry = {
        "filename": f.name,
        "size_bytes": stat.st_size,
        "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }

    # Fold manifest data server-side (avoid N+1 client fetch)
    manifest_path = BACKUP_DIR / f"{f.name}.manifest.json"
    if manifest_path.exists():
        try:
            manifest_data = json.loads(manifest_path.read_text())
            entry["provider"] = manifest_data.get("provider")
            entry["manifest"] = {
                "record_counts": manifest_data.get("record_counts"),
                "last_updates": manifest_data.get("last_updates"),
            }
        except (json.JSONDecodeError, OSError):
            entry["manifest"] = None
    else:
        entry["provider"] = None
        entry["manifest"] = None  # legacy backup

    files.append(entry)
```

Also add `import json` if not already added.

### Step 1.5 — Add `DELETE /api/admin/backup/{filename}` endpoint

**File:** `src/backend/api/routes/admin/backups.py`

New route handler:

```python
@router.delete("/backup/{filename}", status_code=204)
async def delete_backup(
    filename: str,
    current_user: dict = Depends(get_system_admin),
):
    """Delete a specific backup file and its manifest."""
    _ensure_backup_dir()

    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not re.match(r"^wims_\d{8}_\d{6}\.sql\.enc$", filename):
        raise HTTPException(status_code=400, detail="Invalid backup filename format")

    file_path = BACKUP_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")

    file_path.unlink()

    # Delete sibling manifest
    manifest_path = file_path.with_suffix(".sql.enc.manifest.json")
    try:
        manifest_path.unlink()
    except FileNotFoundError:
        pass

    return None  # 204
```

### Step 1.6 — Add `GET /api/admin/backup/{filename}/manifest` endpoint

**File:** `src/backend/api/routes/admin/backups.py`

```python
@router.get("/backup/{filename}/manifest")
async def get_backup_manifest(
    filename: str,
    current_user: dict = Depends(get_system_admin),
):
    """Get the manifest for a specific backup file."""
    _ensure_backup_dir()

    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not re.match(r"^wims_\d{8}_\d{6}\.sql\.enc$", filename):
        raise HTTPException(status_code=400, detail="Invalid backup filename format")

    manifest_path = BACKUP_DIR / f"{filename}.manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="Manifest not found for this backup (legacy backup)")

    try:
        return json.loads(manifest_path.read_text())
    except (json.JSONDecodeError, OSError):
        raise HTTPException(status_code=500, detail="Manifest file corrupted")
```

### Step 1.7 — Fix `restore_backup`: stream to disk, remove in-memory cap

**File:** `src/backend/api/routes/admin/backups.py`

Replace the in-memory `safe_read_upload` approach with disk streaming. Replace the upload + header validation block:

```python
_max_backup_bytes = int(os.getenv("WIMS_MAX_BACKUP_BYTES", str(1024 * 1024 * 1024)))  # 1 GB default

with tempfile.TemporaryDirectory() as tmpdir:
    tmp_enc = Path(tmpdir) / filename

    # Stream upload to disk (not in-memory)
    with open(tmp_enc, "wb") as f:
        while chunk := await file.read(64 * 1024):
            f.write(chunk)

    # Filesystem-level size cap (after write, not before)
    if tmp_enc.stat().st_size > _max_backup_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {_max_backup_bytes // (1024 * 1024)} MB limit",
        )

    # Read first 8 bytes for header validation
    header = tmp_enc.read_bytes(8)
    if not header.startswith(b"WIMSBAO1"):
        raise HTTPException(
            status_code=400,
            detail=(
                "Backup file header invalid: missing WIMSBAO1 magic. "
                "File may be corrupted or not a WIMS encrypted backup."
            ),
        )

    # Compute SHA-256 from file content
    sha256_digest = hashlib.sha256(tmp_enc.read_bytes()).hexdigest()

    # Decrypt from disk (not from memory)
    try:
        from utils.backup_crypto import decrypt_backup
        tmp_sql = decrypt_backup(tmp_enc)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Backup decryption failed")
        raise HTTPException(status_code=422, detail="Decryption failed")
```

Remove the `safe_read_upload` import if no longer used elsewhere in the file, or keep it for other endpoints.

### Step 1.8 — Add schedule endpoints

**File:** `src/backend/api/routes/admin/backup_schedule.py` (new file)

```python
"""System Admin API — backup schedule routes."""

import logging
from datetime import datetime, timezone

from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_system_admin, get_db_with_rls

logger = logging.getLogger("wims.admin")
router = APIRouter()

_CRON_RE = re.compile(
    r"^"
    r"((\*|(\d+(-\d+)?)(/\d+)?)(,(\d+(-\d+)?)(/\d+)?)*|\*)"
    r"\s+"
    r"((\*|(\d+(-\d+)?)(/\d+)?)(,(\d+(-\d+)?)(/\d+)?)*|\*)"
    r"\s+"
    r"((\*|(\d+(-\d+)?)(/\d+)?)(,(\d+(-\d+)?)(/\d+)?)*|\*)"
    r"\s+"
    r"((\*|(\d+(-\d+)?)(/\d+)?)(,(\d+(-\d+)?)(/\d+)?)*|\*)"
    r"\s+"
    r"((\*|(\d+(-\d+)?)(/\d+)?)(,(\d+(-\d+)?)(/\d+)?)*|\*)"
    r"$"
)


class BackupScheduleCreate(BaseModel):
    enabled: bool
    cron_expr: str

    @field_validator("cron_expr")
    @classmethod
    def cron_must_be_valid(cls, v: str) -> str:
        if not _CRON_RE.match(v.strip()):
            raise ValueError("Invalid cron expression — use standard 5-field format")
        # Validate with croniter
        try:
            croniter(v.strip(), datetime.now())
        except (ValueError, KeyError):
            raise ValueError(f"Cannot parse cron expression: {v}")
        return v.strip()


@router.get("/backup-schedule")
async def get_backup_schedule(
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db_with_rls),
):
    """Get the current backup schedule configuration."""
    row = db.execute(
        text("SELECT enabled, cron_expr, last_run_at, last_backup_filename FROM wims.backup_schedule WHERE id = 1")
    ).mappings().one_or_none()

    if row is None:
        return None

    result = {
        "enabled": row["enabled"],
        "cron_expr": row["cron_expr"],
        "last_run_at": row["last_run_at"].isoformat() if row["last_run_at"] else None,
        "last_backup_filename": row["last_backup_filename"],
    }

    # Compute next_run server-side
    try:
        cron = croniter(row["cron_expr"], row["last_run_at"] or datetime.now(timezone.utc))
        result["next_run"] = cron.get_next(datetime).isoformat()
    except (ValueError, KeyError):
        result["next_run"] = None

    return result


@router.post("/backup-schedule")
async def save_backup_schedule(
    body: BackupScheduleCreate,
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db_with_rls),
):
    """Save backup schedule configuration."""
    db.execute(
        text("""
            INSERT INTO wims.backup_schedule (id, enabled, cron_expr, updated_at)
            VALUES (1, :enabled, :cron_expr, now())
            ON CONFLICT (id) DO UPDATE
            SET enabled = :enabled, cron_expr = :cron_expr, updated_at = now()
        """),
        {"enabled": body.enabled, "cron_expr": body.cron_expr},
    )
    db.commit()
    return {"status": "ok", "enabled": body.enabled, "cron_expr": body.cron_expr}
```

**Register in admin `__init__.py`:**

Add to `src/backend/api/routes/admin/__init__.py`:
```python
from . import (
    ...
    backup_schedule,
    ...
)
...
router.include_router(backup_schedule.router)
```

### Step 1.9 — Add Celery beat task for scheduled backup

**File:** `src/backend/tasks/scheduled_backup.py` (new file)

```python
"""Celery task — execute scheduled backups per cron expression."""

import logging
from datetime import datetime, timezone

from croniter import croniter
from sqlalchemy import text

from app import celery_app
from db import get_session
from utils.rls import set_rls_context

logger = logging.getLogger("wims.tasks.scheduled_backup")


@celery_app.task(name="tasks.scheduled_backup.execute_due_backup", bind=True, max_retries=0)
def execute_due_backup(self) -> dict:
    """Check if a scheduled backup is due and execute it."""
    session = get_session()
    try:
        set_rls_context(session, system_admin=True)

        row = session.execute(
            text("SELECT enabled, cron_expr, last_run_at FROM wims.backup_schedule WHERE id = 1")
        ).mappings().one_or_none()

        if row is None or not row["enabled"]:
            return {"status": "skipped", "reason": "schedule disabled or not configured"}

        now = datetime.now(timezone.utc)

        # Check if cron has fired since last_run_at
        last_run = row["last_run_at"] or datetime.min.replace(tzinfo=timezone.utc)
        cron = croniter(row["cron_expr"], last_run)
        next_run = cron.get_next(datetime)

        if next_run > now:
            return {"status": "skipped", "reason": f"next run at {next_run.isoformat()}"}

        # Optimistic lock: update last_run_at to prevent double-fire
        result = session.execute(
            text("""
                UPDATE wims.backup_schedule
                SET last_run_at = now(), updated_at = now()
                WHERE id = 1 AND last_run_at = :last_run_at
                RETURNING last_run_at
            """),
            {"last_run_at": row["last_run_at"]},
        )
        session.commit()

        if result.rowcount == 0:
            return {"status": "skipped", "reason": "concurrent trigger won the lock"}

        # Execute backup logic (reuse from backups module)
        # Call the backup trigger logic directly
        from api.routes.admin.backups import _trigger_backup_impl

        backup_result = _trigger_backup_impl()

        # Update filename on success
        session.execute(
            text("UPDATE wims.backup_schedule SET last_backup_filename = :fn WHERE id = 1"),
            {"fn": backup_result["filename"]},
        )
        session.commit()

        return {"status": "ok", "filename": backup_result["filename"]}

    except Exception:
        logger.exception("Scheduled backup failed")
        return {"status": "error"}
    finally:
        session.close()
```

**Refactor:** Extract the core backup logic from `trigger_backup` into a reusable `_trigger_backup_impl()` function (same file, `backups.py`), so it can be called from both the HTTP route and the Celery task.

**Register in `celery_config.py`:**

```python
"execute-scheduled-backup": {
    "task": "tasks.scheduled_backup.execute_due_backup",
    "schedule": 300.0,  # every 5 minutes
},
```

Add `"tasks.scheduled_backup"` to the task imports list.

---

## Phase 2: Frontend — API Layer

### Step 2.1 — Add backup API functions

**File:** `src/frontend/src/lib/api/backup.ts` (new file)

```typescript
import { apiFetch, API_BASE } from './transport';

export interface BackupFile {
  filename: string;
  size_bytes: number;
  created_at: string;
  provider: string | null;
  manifest: {
    record_counts: { incidents: number; citizens: number; users: number } | null;
    last_updates: {
      incident: string | null;
      citizen_report: string | null;
      user_change: string | null;
    } | null;
  } | null;
}

export interface BackupSchedule {
  enabled: boolean;
  cron_expr: string;
  last_run_at: string | null;
  next_run: string | null;
  last_backup_filename: string | null;
}

export interface BackupTriggerResult {
  filename: string;
  size_bytes: number;
  created_at: string;
}

export interface RestoreResult {
  status: string;
  filename: string;
  restored_at: string;
}

export async function triggerBackup(): Promise<BackupTriggerResult> {
  return apiFetch('/api/admin/backup', { method: 'POST' });
}

export async function listBackups(): Promise<BackupFile[]> {
  return apiFetch('/api/admin/backups');
}

export async function downloadBackup(filename: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/admin/backup/${encodeURIComponent(filename)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}

export async function deleteBackup(filename: string): Promise<void> {
  await apiFetch(`/api/admin/backup/${encodeURIComponent(filename)}`, { method: 'DELETE' });
}

export async function getBackupManifest(filename: string): Promise<Record<string, unknown>> {
  return apiFetch(`/api/admin/backup/${encodeURIComponent(filename)}/manifest`);
}

export async function restoreBackup(file: File): Promise<RestoreResult> {
  const formData = new FormData();
  formData.append('file', file);
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/admin/restore`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Restore failed: ${res.status}`);
  }
  return res.json();
}

export async function getBackupSchedule(): Promise<BackupSchedule | null> {
  return apiFetch('/api/admin/backup-schedule');
}

export async function saveBackupSchedule(schedule: { enabled: boolean; cron_expr: string }): Promise<BackupSchedule> {
  return apiFetch('/api/admin/backup-schedule', {
    method: 'POST',
    body: JSON.stringify(schedule),
  });
}

// Helper: get auth token from storage (adjust to match existing auth pattern)
function getToken(): string {
  // Use existing token retrieval — e.g., from AuthContext or localStorage
  // This should match how other API slices get the token
  return typeof window !== 'undefined'
    ? localStorage.getItem('access_token') || ''
    : '';
}
```

**Note:** The `getToken()` function should use the same auth mechanism as the rest of the app (likely from `AuthContext`). Update to match existing patterns.

### Step 2.2 — Add backup barrel exports

**File:** `src/frontend/src/lib/api/index.ts`

Add:
```typescript
export * from './backup';
```

---

## Phase 3: Frontend — Admin Hub Summary Card

### Step 3.1 — Add backup state and data fetching to admin/system/page.tsx

**File:** `src/frontend/src/app/admin/system/page.tsx`

Add:
1. Import backup API functions
2. Add state: `backups`, `loadingBackups`, `backupError`
3. Add `loadBackupSummary` effect + function
4. Add backup summary section **after** the `scheduled-reports` section

The section follows the same `card` + `card-header` pattern as existing sections:

```tsx
{/* Backup Manager (GAP-A01/A02) */}
<section id="backup" className="card overflow-hidden">
  <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
    <div className="flex items-center gap-2">
      <BookmarkIcon className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
      <span>Backup Manager</span>
    </div>
    <a
      href="/admin/backups"
      className="px-4 py-2 rounded-md text-sm font-medium text-white inline-flex items-center gap-2"
      style={{ backgroundColor: 'var(--sidebar-bg)' }}
    >
      <ArrowRight className="w-4 h-4" />
      Open Backup Manager
    </a>
  </div>

  {/* Cadence nudge — if no backup in 7+ days */}
  {nudgeDays > 7 && (...amber warning...)}

  {/* Summary stats row */}
  <div className="grid grid-cols-3 gap-0 border-b border-gray-100">
    {/* Last Backup, Total Backups, Storage Used */}
  </div>

  {/* Latest Backup Details */}
  <div className="p-4">
    {loadingBackups ? (skeleton) : backups.length === 0 ? (empty state) : (details card with manifest)}
  </div>
</section>
```

---

## Phase 4: Frontend — Dedicated Backup Page

### Step 4.1 — Create `/admin/backups/page.tsx`

**File:** `src/frontend/src/app/admin/backups/page.tsx` (new file)

This is the largest component (~800-1000 lines). Structure:

```
'use client'
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  triggerBackup, listBackups, downloadBackup, deleteBackup,
  restoreBackup, getBackupSchedule, saveBackupSchedule, BackupFile, BackupSchedule
} from '@/lib/api';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

export default function AdminBackupsPage() {
  // ── Auth guard ──
  // ── State ──
  //   backups[], loadingBackups, backupError
  //   triggering (boolean), triggeringError
  //   schedule: BackupSchedule | null, scheduleLoading
  //   cronInput, cronEnabled (boolean)
  //   restoring, restoreError, restoreSuccess
  //   uploadFile, confirmFilename
  //   deleteConfirmFilename (per-row)
  //   sortOrder: 'newest' | 'oldest' | 'size'
  // ── Effects ──
  //   loadBackups(), loadSchedule()
  // ── Handlers ──
  //   handleTrigger(), handleDownload(), handleDelete()
  //   handleRestore(), handleSaveSchedule()
  //   handleFileDrop(), handleFileSelect()
  // ── Render ──
  //   Page header (title + refresh)
  //   Summary bar (4 stat cards)
  //   Trigger section (button + status)
  //   Schedule section (toggle + cron input + presets + save)
  //   Backup timeline (date-grouped rows)
  //   Danger Zone: Restore (upload + confirm + button)
}
```

**Key render sections:**

**Summary Bar** — 4 stat cards (Last Backup, Total Backups, Storage Used, Oldest Backup)

**Trigger Section** — Green button, status line, retention indicator. During backup: spinner + "Backing up...". Uses the existing toast pattern for success/error.

**Schedule Section** — Toggle + custom cron input + preset buttons (Every 6h / 12h / Daily 02:00 / Weekly Sun 03:00 / Custom) + Save button. Client-side cron validation helper.

**Backup Timeline** — Grouped by date (Today / Yesterday / formatted date). Each row: filename (monospace), format badge, manifest summary line, size, relative time, download icon button, delete icon button. Sort dropdown. Empty state when no backups.

**Danger Zone: Restore** — Warning banner, file upload zone (drag-and-drop + click-to-browse), file preview with header validation status, filename confirmation input, restore button (disabled until confirmed). Progress states during restore. Success/error display.

---

## Phase 5: Integration & Polish

### Step 5.1 — Add `/admin/backups` route guard

The page should check `SYSTEM_ADMIN` role and redirect if unauthorized (same pattern as other admin pages).

### Step 5.2 — Add delete confirmation

Delete action should show a confirmation toast/modal before executing (prevent accidental deletion).

### Step 5.3 — Auto-refresh after trigger

After successful trigger, call `listBackups()` to show the new backup in the timeline.

### Step 5.4 — Handle network offline

Wrap backup operations with offline-aware pattern matching `offlineAdmin.ts` where possible (at minimum, read from cache when offline).

---

## Implementation Order

| Step | Description | Files | Effort |
|------|-------------|-------|--------|
| **1.1** | SQL migration: `wims.backup_schedule` | `74_backup_schedule.sql` | Small |
| **1.2** | Fix retention manifest cleanup | `backups.py` _(1 line)_ | Tiny |
| **1.3** | Add manifest writing to trigger | `backups.py` _(~30 lines)_ | Small |
| **1.4** | Fold manifest into list_backups | `backups.py` _(~20 lines)_ | Small |
| **1.5** | Add DELETE endpoint | `backups.py` _(~25 lines)_ | Small |
| **1.6** | Add manifest GET endpoint | `backups.py` _(~25 lines)_ | Small |
| **1.7** | Fix restore streaming | `backups.py` _(~25 lines)_ | Small |
| **1.8** | Schedule endpoints + DB | `backup_schedule.py` _(new, ~100 lines)_ | Medium |
| **1.9** | Celery beat task | `scheduled_backup.py` _(new, ~80 lines)_ + `celery_config.py` | Medium |
| **2.1** | Backup API functions | `backup.ts` _(new, ~100 lines)_ | Small |
| **2.2** | Barrel export | `index.ts` _(1 line)_ | Tiny |
| **3.1** | Admin hub summary card | `admin/system/page.tsx` _(+~120 lines)_ | Medium |
| **4.1** | Dedicated backup page | `admin/backups/page.tsx` _(new, ~1000 lines)_ | Large |
| **5.1-5.4** | Polish, guards, refresh | Various | Small |

**Total estimated effort:** ~5-7 focused implementation sessions

---

## Testing

### Backend Tests

| Test | What to verify |
|------|---------------|
| `test_backup_manifest_written` | Trigger writes `.manifest.json` sibling with correct fields |
| `test_list_backups_includes_manifest` | List returns manifest data for backup with manifest; `manifest: null` for legacy |
| `test_delete_backup_removes_manifest` | Both `.sql.enc` and `.manifest.json` are deleted |
| `test_delete_backup_404` | Non-existent filename returns 404 |
| `test_delete_backup_path_traversal` | `../` rejected |
| `test_restore_streaming` | Upload >50 MB succeeds within 1 GB cap |
| `test_restore_streaming_exceeds_cap` | Upload >1 GB returns 413 |
| `test_backup_schedule_save_read` | POST then GET returns same config |
| `test_backup_schedule_invalid_cron` | Bad cron returns 422 |
| `test_scheduled_backup_celery_task` | Task runs when cron is due, skips when not |
| `test_retention_cleans_manifest` | Retention deletes manifest sibling for rotated-out backups |

### Frontend Tests

| Test | What to verify |
|------|---------------|
| `admin hub shows backup card` | Summary card renders with correct data |
| `admin hub shows nudge` | Nudge appears when no backup >7 days |
| `backup page renders all sections` | Summary bar, trigger, schedule, timeline, restore render |
| `trigger backup flow` | Click trigger → loading state → success/error toast |
| `timeline shows backups` | Backups listed with manifest data |
| `delete backup flow` | Click delete → confirm → removed from list |
| `restore flow` | Upload file → confirm filename → restore button enabled → success/error |
| `schedule save/load` | Set cron → save → refresh → shows saved config |
| `sort dropdown` | Newest/oldest/size sort reorders the timeline |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `trigger_backup` runs synchronously (120s timeout) | Frontend shows spinner + "Backing up..." for the duration; future: offload to Celery |
| Concurrent triggers (two admins + scheduled) | Add Redis sentinel with TTL=180s or `BACKUP_RUNNING` file |
| Restore replaces live DB — no undo | Multi-step confirmation (type filename), warning banner, audit log |
| Manifest snapshots show stale data if queries run after pg_dump | Run snapshot BEFORE pg_dump so it matches the backup contents; accept minor skew |
| Large backup files cause slow page loads in list_backups | `list_backups` reads manifest files (small JSON) per backup — negligible for 100 files |
