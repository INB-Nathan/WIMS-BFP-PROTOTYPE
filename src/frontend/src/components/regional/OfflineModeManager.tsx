'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CloudDownload, Check, Trash2, Loader2, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import {
  enableOfflineMode,
  isOfflineModeEnabled,
  clearOfflineModeEnabled,
  type OfflineEnableProgress,
} from '@/lib/offlineEnable';
import { clearAllOfflineData, setActiveOfflineUser } from '@/lib/offlineStore';

/**
 * Encoder offline controls (items E10 / F11).
 *
 *  - variant="banner" (regional dashboard): persistent prompt shown until offline
 *    mode is enabled. No dismiss button — it stays visible so the encoder always
 *    knows where to set it up (Profile tab).
 *  - variant="panel"  (My Profile page): the persistent Enable/Update + Clear
 *    controls with live progress.
 *
 * Offline mode is an encoder-only feature, so the component renders nothing for
 * other roles.
 */
export function OfflineModeManager({ variant = 'panel' }: { variant?: 'banner' | 'panel' }) {
  const router = useRouter();
  const { user } = useAuth();
  const role = (user as { role?: string } | null)?.role ?? null;
  const { isOnline } = useNetworkStatus();
  const encoderId = (user as { id?: string })?.id ?? '';
  const isEncoder = role === 'REGIONAL_ENCODER' || role === 'ENCODER';

  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OfflineEnableProgress | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    setEnabled(isOfflineModeEnabled());
  }, []);

  const runEnable = useCallback(async () => {
    if (!encoderId || busy) return;
    setBusy(true);
    setProgress({ step: 'Starting…', done: 0, total: 1 });
    const result = await enableOfflineMode(encoderId, {
      prefetch: (href) => router.prefetch(href),
      onProgress: setProgress,
    });
    setBusy(false);
    setProgress(null);
    if (result.ok) {
      setEnabled(true);
      toast.success(
        `Offline mode ready — ${result.cachedDetails} incident${result.cachedDetails === 1 ? '' : 's'} saved for offline use.`,
      );
    } else {
      toast.error(result.error ?? 'Could not enable offline mode.');
    }
  }, [encoderId, busy, router]);

  const runClear = useCallback(async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await clearAllOfflineData();
      clearOfflineModeEnabled();
      if (encoderId) await setActiveOfflineUser(encoderId);
      setEnabled(false);
      toast.success('Offline data cleared from this device.');
    } catch {
      toast.error('Failed to clear offline data.');
    } finally {
      setClearing(false);
    }
  }, [clearing, encoderId]);

  if (!isEncoder) return null;

  // ── Banner variant (dashboard) ──────────────────────────────────────────
  // Stays visible until offline mode is enabled — no dismiss button so the
  // encoder always has a prompt to set it up. Full controls are in Profile.
  if (variant === 'banner') {
    if (enabled) return null;
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <CloudDownload className="mt-0.5 h-5 w-5 flex-shrink-0 text-sky-600" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-sky-900">This device is not set up for offline use</p>
            <p className="mt-0.5 text-xs text-sky-700">
              Download the encoding forms and your incidents so you can view, create, and edit
              reports without an internet connection.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push('/profile')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-800"
        >
          <CloudDownload className="h-4 w-4" aria-hidden />
          Set up in My Profile
        </button>
      </div>
    );
  }

  // ── Panel variant (profile) ─────────────────────────────────────────────
  return (
    <section className="card overflow-hidden">
      <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid #0369a1' }}>
        <CloudDownload className="w-4 h-4 text-sky-600" />
        <span>Offline Mode</span>
      </div>
      <div className="card-body space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Download the encoding forms and your incidents to this device so you can view, create, and
          edit reports without an internet connection. Offline data is encrypted and tied to your
          account; it is cleared automatically if a different user signs in on this device.
        </p>

        <ProgressBar busy={busy} progress={progress} />

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {enabled ? (
              <>
                <Check className="h-4 w-4 text-green-600" aria-hidden />
                Offline mode is enabled on this device
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-gray-400" aria-hidden />
                Offline mode is not enabled
              </>
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={runEnable}
              disabled={!isOnline || busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#0369a1' }}
              title={isOnline ? 'Download / refresh offline data' : 'Connect to the internet to enable offline mode'}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CloudDownload className="h-3.5 w-3.5" aria-hidden />}
              {enabled ? 'Update offline data' : 'Enable offline mode'}
            </button>
            <button
              type="button"
              onClick={runClear}
              disabled={clearing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
              title="Remove all incidents and cached data stored offline on this device"
            >
              {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
              Clear offline data
            </button>
          </div>
        </div>
        {!isOnline && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            You are offline — reconnect to download or refresh offline data.
          </p>
        )}
      </div>
    </section>
  );
}

function ProgressBar({ busy, progress }: { busy: boolean; progress: OfflineEnableProgress | null }) {
  if (!busy || !progress) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm" role="status">
      <div className="flex items-center gap-2 font-medium text-gray-700">
        <Loader2 className="h-4 w-4 animate-spin text-sky-600" aria-hidden />
        {progress.step}
        {progress.total > 1 && <span className="text-gray-500">({progress.done}/{progress.total})</span>}
      </div>
      {progress.total > 1 && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-sky-600 transition-all"
            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
