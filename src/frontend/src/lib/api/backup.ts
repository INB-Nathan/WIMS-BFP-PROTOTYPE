/**
 * Backup management API functions (SYSTEM_ADMIN only).
 *
 * All paths start with `/admin/...` NOT `/api/admin/...` because
 * API_BASE in transport.ts already resolves to `/api`.
 */

import { apiFetch, API_BASE } from './transport';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface BackupFile {
  filename: string;
  size_bytes: number;
  created_at: string;
  provider: string | null;
  manifest: {
    record_counts: {
      incidents: number;
      citizens: number;
      users: number;
    } | null;
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

// ─── API Functions ──────────────────────────────────────────────────────────────

/** Trigger an on-demand backup. POST /admin/backup */
export async function triggerBackup(): Promise<BackupTriggerResult> {
  return apiFetch('/admin/backup', { method: 'POST' });
}

/** List all backups with manifest data. GET /admin/backups */
export async function listBackups(): Promise<BackupFile[]> {
  return apiFetch('/admin/backups');
}

/**
 * Download a backup file as a Blob.
 * Uses raw fetch (not apiFetch) because apiFetch parses JSON, not blobs.
 * Auth is handled via the session cookie (credentials: 'include'),
 * consistent with downloadAnalyticsExport in legacy.ts.
 */
export async function downloadBackup(filename: string): Promise<Blob> {
  const url = `${API_BASE.replace(/\/$/, '')}/admin/backup/${encodeURIComponent(filename)}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`);
  }
  return res.blob();
}

/** Delete a backup file and its manifest. DELETE /admin/backup/{filename} */
export async function deleteBackup(filename: string): Promise<void> {
  await apiFetch(`/admin/backup/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
}

/** Get the manifest for a specific backup. GET /admin/backup/{filename}/manifest */
export async function getBackupManifest(
  filename: string,
): Promise<Record<string, unknown>> {
  return apiFetch(`/admin/backup/${encodeURIComponent(filename)}/manifest`);
}

/**
 * Restore a database from an uploaded backup file.
 * Uses raw fetch with FormData (not apiFetch) because apiFetch parses JSON
 * and cannot stream multipart uploads. Auth via session cookie.
 * Do NOT set Content-Type header — the browser sets it with the boundary
 * for FormData uploads.
 */
export async function restoreBackup(file: File): Promise<RestoreResult> {
  const url = `${API_BASE.replace(/\/$/, '')}/admin/restore`;
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(errText || `Restore failed: ${res.status}`);
  }
  return res.json();
}

/** Get the backup schedule config. GET /admin/backup-schedule */
export async function getBackupSchedule(): Promise<BackupSchedule | null> {
  return apiFetch('/admin/backup-schedule');
}

/** Save the backup schedule config. POST /admin/backup-schedule */
export async function saveBackupSchedule(schedule: {
  enabled: boolean;
  cron_expr: string;
}): Promise<BackupSchedule> {
  return apiFetch('/admin/backup-schedule', {
    method: 'POST',
    body: JSON.stringify(schedule),
  });
}

// ─── Token Helper ──────────────────────────────────────────────────────────────

/**
 * Retrieve the OIDC access token from the oidc-client-ts UserManager.
 *
 * The primary auth mechanism is the __Host-access_token cookie (set during
 * login sync and refreshed server-side). This helper exists for edge cases
 * that need the raw token value (e.g. WebSocket auth, debugging).
 *
 * Returns the access token string, or `null` if the user is not logged in
 * or the token is unavailable.
 *
 * This is aligned with the app's OIDC auth flow (see callback/page.tsx
 * which retrieves the token via createUserManager().signinCallback()).
 */
export async function getToken(): Promise<string | null> {
  try {
    const { createUserManager } = await import('@/lib/oidc');
    const userManager = createUserManager();
    const user = await userManager.getUser();
    return user?.access_token ?? null;
  } catch {
    return null;
  }
}
