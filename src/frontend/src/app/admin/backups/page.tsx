'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  triggerBackup,
  listBackups,
  downloadBackup,
  deleteBackup,
  restoreBackup,
  getBackupSchedule,
  saveBackupSchedule,
} from '@/lib/api';
import type {
  BackupFile,
  BackupSchedule,
  BackupTriggerResult,
  RestoreResult,
} from '@/lib/api';
import {
  Bookmark,
  RefreshCw,
  Download,
  Trash2,
  Upload,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  HardDrive,
  Database,
  Calendar,
  ChevronDown,
  ArrowUpDown,
  FileText,
  Users,
  ShieldAlert,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDateLabel(iso: string | null | undefined): string {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getDateGroupKey(iso: string | null | undefined): string {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return '__TODAY__';
  if (d.toDateString() === yesterday.toDateString()) return '__YESTERDAY__';
  return d.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function isTodayOrYesterday(key: string): boolean {
  return key === '__TODAY__' || key === '__YESTERDAY__';
}

const BACKUP_FILENAME_REGEX = /^wims_\d{8}_\d{6}\.sql\.enc$/;

// ─── Preset Cron Values ───────────────────────────────────────────────────────

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: 'Every 6h', value: '0 */6 * * *' },
  { label: 'Every 12h', value: '0 */12 * * *' },
  { label: 'Daily 02:00', value: '0 2 * * *' },
  { label: 'Weekly Sun 03:00', value: '0 3 * * 0' },
  { label: 'Custom', value: '' },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminBackupsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;

  // ── State — Data ─────────────────────────────────────────────────────────
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(true);
  const [backupError, setBackupError] = useState<string | null>(null);

  const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);

  // ── State — Trigger ──────────────────────────────────────────────────────
  const [triggering, setTriggering] = useState(false);
  const [triggeringError, setTriggeringError] = useState<string | null>(null);

  // ── State — Schedule Form ────────────────────────────────────────────────
  const [cronEnabled, setCronEnabled] = useState(false);
  const [cronInput, setCronInput] = useState('0 2 * * *');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleSaveError, setScheduleSaveError] = useState<string | null>(null);

  // ── State — Restore ──────────────────────────────────────────────────────
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmFilename, setConfirmFilename] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<RestoreResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // ── State — Delete ───────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  // ── State — Sort ─────────────────────────────────────────────────────────
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'size'>('newest');

  // ── State — Toast ────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Auth Guard ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && role !== 'SYSTEM_ADMIN') {
      router.replace('/dashboard');
    }
  }, [authLoading, role, router]);

  // ── Data Loading ─────────────────────────────────────────────────────────
  const loadBackups = useCallback(async () => {
    setLoadingBackups(true);
    setBackupError(null);
    try {
      const data = await listBackups();
      setBackups(data);
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Failed to load backups';
      setBackupError(msg);
      setBackups([]);
    } finally {
      setLoadingBackups(false);
    }
  }, []);

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const data = await getBackupSchedule();
      setSchedule(data);
      if (data) {
        setCronEnabled(data.enabled);
        setCronInput(data.cron_expr);
      }
    } catch {
      setSchedule(null);
    } finally {
      setScheduleLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role === 'SYSTEM_ADMIN') {
      loadBackups();
      loadSchedule();
    }
  }, [role, loadBackups, loadSchedule]);

  // ── Computed Summary Values ──────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!backups.length) {
      return {
        lastBackup: null,
        totalBackups: 0,
        storageUsed: 0,
        oldestBackup: null,
        avgSize: 0,
      };
    }
    const sorted = [...backups].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const totalBytes = backups.reduce((sum, b) => sum + b.size_bytes, 0);
    return {
      lastBackup: sorted[0].created_at,
      totalBackups: backups.length,
      storageUsed: totalBytes,
      oldestBackup: sorted[sorted.length - 1].created_at,
      avgSize: totalBytes / backups.length,
    };
  }, [backups]);

  // ── Handlers — Trigger ──────────────────────────────────────────────────
  const handleTrigger = async () => {
    setTriggering(true);
    setTriggeringError(null);
    try {
      const result: BackupTriggerResult = await triggerBackup();
      setToast({ type: 'success', text: `Backup created: ${result.filename}` });
      await loadBackups();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Backup failed';
      setTriggeringError(msg);
      setToast({ type: 'error', text: `Backup failed: ${msg}` });
    } finally {
      setTriggering(false);
    }
  };

  // ── Handlers — Download ─────────────────────────────────────────────────
  const handleDownload = async (filename: string) => {
    try {
      const blob = await downloadBackup(filename);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Download failed';
      setToast({ type: 'error', text: msg });
    }
  };

  // ── Handlers — Delete ───────────────────────────────────────────────────
  const handleDeleteRequest = (filename: string) => {
    setDeleteConfirm(filename);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    const fn = deleteConfirm;
    setDeleteConfirm(null);
    setDeletingName(fn);
    try {
      await deleteBackup(fn);
      setToast({ type: 'success', text: `Backup deleted: ${fn}` });
      await loadBackups();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Delete failed';
      setToast({ type: 'error', text: msg });
    } finally {
      setDeletingName(null);
    }
  };

  // ── Handlers — Schedule ─────────────────────────────────────────────────
  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    setScheduleSaveError(null);
    try {
      const result = await saveBackupSchedule({
        enabled: cronEnabled,
        cron_expr: cronInput.trim(),
      });
      setSchedule(result);
      setToast({ type: 'success', text: 'Schedule saved.' });
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Failed to save schedule';
      setScheduleSaveError(msg);
      setToast({ type: 'error', text: msg });
    } finally {
      setSavingSchedule(false);
    }
  };

  const handlePreset = (value: string) => {
    setCronInput(value);
  };

  // ── Handlers — Restore ──────────────────────────────────────────────────
  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.sql.enc')) {
        setRestoreFile(file);
        setConfirmFilename('');
        setRestoreError(null);
        setRestoreSuccess(null);
      } else {
        setToast({ type: 'error', text: 'Invalid file type. Must be a .sql.enc file.' });
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.sql.enc')) {
        setRestoreFile(file);
        setConfirmFilename('');
        setRestoreError(null);
        setRestoreSuccess(null);
      } else {
        setToast({ type: 'error', text: 'Invalid file type. Must be a .sql.enc file.' });
      }
    }
  };

  const handleRestore = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    setRestoreError(null);
    setRestoreSuccess(null);
    setRestoreProgress('Uploading...');

    try {
      setRestoreProgress('Uploading...');
      const result = await restoreBackup(restoreFile);
      setRestoreSuccess(result);
      setRestoreProgress(null);
      setToast({ type: 'success', text: 'Database restored successfully. Please re-login.' });
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Restore failed';
      setRestoreError(msg);
      setRestoreProgress(null);
      setToast({ type: 'error', text: `Restore failed: ${msg}` });
    } finally {
      setRestoring(false);
    }
  };

  // ── Sorted Backups ──────────────────────────────────────────────────────
  const sortedBackups = useMemo(() => {
    const sorted = [...backups];
    switch (sortOrder) {
      case 'newest':
        sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case 'oldest':
        sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case 'size':
        sorted.sort((a, b) => b.size_bytes - a.size_bytes);
        break;
    }
    return sorted;
  }, [backups, sortOrder]);

  // ── Grouped Backups ─────────────────────────────────────────────────────
  const groupedBackups = useMemo(() => {
    const groups: Record<string, BackupFile[]> = {};
    for (const b of sortedBackups) {
      const key = getDateGroupKey(b.created_at);
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    }
    // Sort groups: Today first, Yesterday second, then chronological
    const keys = Object.keys(groups).sort((a, b) => {
      if (a === '__TODAY__') return -1;
      if (b === '__TODAY__') return 1;
      if (a === '__YESTERDAY__') return -1;
      if (b === '__YESTERDAY__') return 1;
      // For date strings, compare by date value
      return new Date(b).getTime() - new Date(a).getTime();
    });
    return keys.map((key) => ({
      label: isTodayOrYesterday(key)
        ? key === '__TODAY__'
          ? 'Today'
          : 'Yesterday'
        : key,
      backups: groups[key],
    }));
  }, [sortedBackups]);

  // ── Auth loading ────────────────────────────────────────────────────────
  if (authLoading || role !== 'SYSTEM_ADMIN') {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-gray-500">
        {authLoading ? 'Loading...' : 'Redirecting...'}
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Toast banner */}
      {toast && (
        <div
          className={`rounded-md border px-4 py-3 text-sm font-medium flex items-center gap-2 ${
            toast.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
          role="alert"
        >
          {toast.type === 'success' ? (
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span className="flex-1">{toast.text}</span>
          <button
            onClick={() => setToast(null)}
            className="text-current opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="rounded-xl shadow-2xl max-w-sm w-full bg-white overflow-hidden">
            <div className="px-6 py-4">
              <h3 className="text-base font-bold text-gray-900">Delete Backup?</h3>
              <p className="text-sm text-gray-600 mt-2">
                This action cannot be undone. The backup file and its manifest will be permanently removed.
              </p>
              <p className="text-xs font-mono text-gray-500 mt-2 bg-gray-50 rounded px-2 py-1">
                {deleteConfirm}
              </p>
            </div>
            <div className="px-6 py-3 bg-gray-50 flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ Page Header ═══════ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bookmark className="w-6 h-6" style={{ color: 'var(--sidebar-bg)' }} />
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Backup Manager
          </h1>
        </div>
        <button
          onClick={loadBackups}
          disabled={loadingBackups}
          className="flex items-center gap-1 text-sm font-medium disabled:opacity-50 transition-opacity"
          style={{ color: 'var(--bfp-maroon)' }}
        >
          <RefreshCw className={`w-4 h-4 ${loadingBackups ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ═══════ Summary Bar ═══════ */}
      {loadingBackups ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-3 bg-gray-100 rounded w-20 mb-2" />
              <div className="h-6 bg-gray-100 rounded w-24" />
              <div className="h-3 bg-gray-100 rounded w-16 mt-1" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Last Backup */}
          <div
            className="card p-4"
            style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Last Backup
              </span>
            </div>
            <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {summary.lastBackup ? formatRelativeTime(summary.lastBackup) : '—'}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {summary.lastBackup
                ? new Date(summary.lastBackup).toLocaleString('en-PH', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'No backups yet'}
            </div>
          </div>

          {/* Total Backups */}
          <div
            className="card p-4"
            style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Total Backups
              </span>
            </div>
            <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {summary.totalBackups}
              <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                {' '}/ 100
              </span>
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Slots used
            </div>
          </div>

          {/* Storage Used */}
          <div
            className="card p-4"
            style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <HardDrive className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Storage Used
              </span>
            </div>
            <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {summary.totalBackups > 0 ? formatBytes(summary.storageUsed) : '—'}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {summary.totalBackups > 0
                ? `~${formatBytes(Math.round(summary.avgSize))} avg`
                : 'No backups'}
            </div>
          </div>

          {/* Oldest Backup */}
          <div
            className="card p-4"
            style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Oldest Backup
              </span>
            </div>
            <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {summary.oldestBackup ? formatRelativeTime(summary.oldestBackup) : '—'}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {summary.oldestBackup
                ? new Date(summary.oldestBackup).toLocaleDateString('en-PH', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'No backups yet'}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ Trigger Section ═══════ */}
      <section className="card overflow-hidden">
        <div
          className="card-header flex items-center justify-between"
          style={{ borderLeft: '4px solid var(--sidebar-bg)' }}
        >
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            <span>Trigger Backup</span>
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>Auto-retention: 100 max</span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            <span>Healthy</span>
          </div>
        </div>
        <div className="card-body flex flex-col sm:flex-row sm:items-center gap-4">
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white font-semibold disabled:opacity-60 transition-opacity"
            style={{ backgroundColor: '#16a34a' }}
          >
            {triggering ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Backing up...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Trigger Backup Now
              </>
            )}
          </button>
          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {triggering ? (
              <span className="flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Creating backup — this may take up to 2 minutes...
              </span>
            ) : (
              <>
                Status:{' '}
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  Idle
                </span>
                {summary.lastBackup && (
                  <span className="ml-2">
                    · Last backup: {formatRelativeTime(summary.lastBackup)}
                  </span>
                )}
              </>
            )}
          </div>
          {triggeringError && (
            <div className="text-sm text-red-600 flex items-center gap-1">
              <XCircle className="w-3 h-3" />
              {triggeringError}
            </div>
          )}
        </div>
      </section>

      {/* ═══════ Schedule Section ═══════ */}
      <section className="card overflow-hidden">
        <div
          className="card-header flex items-center justify-between"
          style={{ borderLeft: '4px solid var(--sidebar-bg)' }}
        >
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            <span>Backup Schedule</span>
          </div>
        </div>
        <div className="card-body space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="schedule-enabled"
              checked={cronEnabled}
              onChange={(e) => setCronEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
              style={{ accentColor: 'var(--sidebar-bg)' }}
            />
            <label htmlFor="schedule-enabled" className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Enable automatic backups
            </label>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="flex-1 w-full sm:max-w-xs">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Cron expression
              </label>
              <input
                type="text"
                value={cronInput}
                onChange={(e) => setCronInput(e.target.value)}
                placeholder="0 2 * * *"
                className="form-input"
                disabled={!cronEnabled}
              />
            </div>
            <button
              onClick={handleSaveSchedule}
              disabled={savingSchedule || !cronEnabled || !cronInput.trim()}
              className="px-4 py-2.5 rounded-lg text-white font-medium text-sm disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: 'var(--sidebar-bg)' }}
            >
              {savingSchedule ? 'Saving...' : 'Save Schedule'}
            </button>
          </div>

          {scheduleSaveError && (
            <div className="text-sm text-red-600 flex items-center gap-1">
              <XCircle className="w-3 h-3" />
              {scheduleSaveError}
            </div>
          )}

          {/* Preset Buttons */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Presets</p>
            <div className="flex flex-wrap gap-2">
              {CRON_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePreset(preset.value)}
                  disabled={!cronEnabled}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors disabled:opacity-40 ${
                    cronInput === preset.value && preset.value
                      ? 'border-gray-400 bg-gray-100 text-gray-800'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Next Run Display */}
          {schedule && (
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                Next run:
              </span>{' '}
              {schedule.next_run
                ? new Date(schedule.next_run).toLocaleString('en-PH', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZoneName: 'short',
                  })
                : '—'}
              {schedule.last_run_at && (
                <span className="ml-3">
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    Last run:
                  </span>{' '}
                  {new Date(schedule.last_run_at).toLocaleString('en-PH', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ═══════ Backup Timeline ═══════ */}
      <section className="card overflow-hidden">
        <div
          className="card-header flex items-center justify-between"
          style={{ borderLeft: '4px solid var(--sidebar-bg)' }}
        >
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            <span>Backup Timeline</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {backups.length}
            </span>
            <div className="relative">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest' | 'size')}
                className="appearance-none border border-gray-300 rounded px-3 py-1.5 pr-8 text-xs focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                aria-label="Sort backups"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="size">By size</option>
              </select>
              <ArrowUpDown className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
            </div>
          </div>
        </div>

        <div className="card-body">
          {loadingBackups ? (
            /* Skeleton loading state */
            <div className="space-y-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-24 mb-3" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-2 border-b border-gray-100 last:border-b-0">
                  <div className="h-3 w-3 rounded-full bg-gray-100" />
                  <div className="flex-1 space-y-1">
                    <div className="h-4 bg-gray-100 rounded w-48" />
                    <div className="h-3 bg-gray-100 rounded w-32" />
                  </div>
                  <div className="h-4 bg-gray-100 rounded w-16" />
                  <div className="h-4 bg-gray-100 rounded w-12" />
                  <div className="h-8 w-8 bg-gray-100 rounded" />
                  <div className="h-8 w-8 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          ) : backupError ? (
            <div className="flex items-center gap-2 text-red-600 text-sm py-4">
              <XCircle className="w-4 h-4" />
              {backupError}
            </div>
          ) : backups.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Database className="w-12 h-12 mb-3" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                No backups yet
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                Trigger your first backup above.
              </p>
            </div>
          ) : (
            /* Timeline groups */
            <div className="space-y-6">
              {groupedBackups.map((group) => (
                <div key={group.label}>
                  <h3
                    className="text-sm font-semibold mb-2 px-1"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {group.label}
                  </h3>
                  <div className="space-y-0 divide-y divide-gray-100">
                    {group.backups.map((b) => (
                      <div
                        key={b.filename}
                        className="flex items-center gap-3 py-3 px-2 hover:bg-gray-50 rounded-lg transition-colors"
                      >
                        {/* Green dot */}
                        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />

                        {/* Filename + Badge + Manifest */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                              {b.filename.replace(/\.sql\.enc$/, '')}
                            </span>
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                b.provider === 'openbao_transit'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {b.provider === 'openbao_transit' ? 'WIMSBAO1' : b.provider ? 'Legacy AES' : 'Legacy AES'}
                            </span>
                          </div>

                          {/* Manifest summary */}
                          {b.manifest && b.manifest.record_counts ? (
                            <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                              <span className="flex items-center gap-1">
                                <FileText className="w-3 h-3" />
                                {b.manifest.record_counts.incidents} inc
                              </span>
                              <span className="flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                {b.manifest.record_counts.citizens} civ
                              </span>
                              <span className="flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3" />
                                {b.manifest.record_counts.users} users
                              </span>
                              {b.manifest.last_updates?.incident && (
                                <span className="text-[10px]">
                                  Last update: {formatRelativeTime(b.manifest.last_updates.incident)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs mt-0.5 italic opacity-60" style={{ color: 'var(--text-muted)' }}>
                              No manifest
                            </div>
                          )}
                        </div>

                        {/* File Size */}
                        <div className="text-xs font-mono whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {formatBytes(b.size_bytes)}
                        </div>

                        {/* Relative Time */}
                        <div className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                          {formatRelativeTime(b.created_at)}
                        </div>

                        {/* Download Button */}
                        <button
                          onClick={() => handleDownload(b.filename)}
                          className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
                          style={{ color: 'var(--text-secondary)' }}
                          title="Download backup"
                          aria-label={`Download ${b.filename}`}
                        >
                          <Download className="w-4 h-4" />
                        </button>

                        {/* Delete Button */}
                        <button
                          onClick={() => handleDeleteRequest(b.filename)}
                          disabled={deletingName === b.filename}
                          className="p-1.5 rounded-md hover:bg-red-50 transition-colors disabled:opacity-40"
                          style={{ color: deletingName === b.filename ? 'var(--text-muted)' : '#dc2626' }}
                          title="Delete backup"
                          aria-label={`Delete ${b.filename}`}
                        >
                          {deletingName === b.filename ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ═══════ Danger Zone: Restore ═══════ */}
      <section
        className="card overflow-hidden"
        style={{ borderColor: '#fecaca' }}
      >
        <div
          className="card-header flex items-center gap-2"
          style={{
            borderLeft: '4px solid #dc2626',
            borderBottom: '1px solid #fecaca',
            backgroundColor: '#fef2f2',
          }}
        >
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <span className="text-red-800">Danger Zone: Restore</span>
        </div>

        <div className="card-body space-y-4">
          {/* Warning Banner */}
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800">
                Restoring will REPLACE the live database with the uploaded backup.
              </p>
              <p className="text-xs text-red-700 mt-1">
                All current data will be overwritten. This action is irreversible.
                Ensure you have a recent backup before proceeding.
              </p>
            </div>
          </div>

          {/* Upload Zone */}
          {!restoreFile ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-gray-300 hover:border-gray-400 bg-gray-50'
              }`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
              aria-label="Drop .sql.enc file here or click to browse"
            >
              <Upload className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Drop .sql.enc file here or click to browse
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Max upload size: 1 GB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".enc,.sql.enc"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          ) : (
            /* File Preview */
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="text-sm font-mono font-medium text-green-800">
                      {restoreFile.name}
                    </p>
                    <p className="text-xs text-green-700">
                      {formatBytes(restoreFile.size)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setRestoreFile(null); setConfirmFilename(''); setRestoreError(null); setRestoreSuccess(null); }}
                  className="p-1 rounded hover:bg-green-100 transition-colors"
                  aria-label="Remove file"
                >
                  <XCircle className="w-5 h-5 text-green-700" />
                </button>
              </div>

              {/* Format Badge */}
              <div>
                {restoreFile.name.match(BACKUP_FILENAME_REGEX) ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-blue-100 text-blue-800">
                    WIMSBAO1
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-800">
                    Legacy AES — Filename format mismatch
                  </span>
                )}
                {restoreFile.name.endsWith('.sql.enc') && (
                  <span className="ml-2 text-xs text-green-700">
                    Header valid ✓
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Confirmation Input */}
          {restoreFile && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Type the backup filename to confirm:
              </label>
              <input
                type="text"
                value={confirmFilename}
                onChange={(e) => setConfirmFilename(e.target.value)}
                placeholder={restoreFile.name}
                className="form-input"
                disabled={restoring}
              />
            </div>
          )}

          {/* Restore Error */}
          {restoreError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
              <XCircle className="w-4 h-4 flex-shrink-0" />
              {restoreError}
            </div>
          )}

          {/* Restore Success */}
          {restoreSuccess && (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 text-green-800 font-medium">
                <CheckCircle className="w-5 h-5" />
                <span>Database restored successfully</span>
              </div>
              <p className="text-sm text-green-700">
                Please re-login to continue.
              </p>
              <p className="text-xs text-green-600">
                Restored file: {restoreSuccess.filename} at{' '}
                {new Date(restoreSuccess.restored_at).toLocaleString('en-PH')}
              </p>
            </div>
          )}

          {/* Restore Progress */}
          {restoreProgress && (
            <div className="flex items-center gap-2 text-sm text-blue-700">
              <RefreshCw className="w-4 h-4 animate-spin" />
              {restoreProgress}
            </div>
          )}

          {/* Restore Button */}
          {restoreFile && !restoreSuccess && (
            <button
              onClick={handleRestore}
              disabled={
                restoring ||
                confirmFilename.trim() !== restoreFile.name ||
                !restoreFile.name.match(BACKUP_FILENAME_REGEX)
              }
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-white font-semibold disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: '#dc2626' }}
            >
              {restoring ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  {restoreProgress || 'Restoring...'}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Restore Database
                </>
              )}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
