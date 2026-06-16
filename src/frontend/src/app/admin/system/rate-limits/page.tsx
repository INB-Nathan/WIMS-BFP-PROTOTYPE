'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { fetchRateLimits, updateRateLimits, RateLimitConfig } from '@/lib/api/legacy';
import { Shield, Save, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';

export default function RateLimitsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [config, setConfig] = useState<RateLimitConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Editable fields
  const [threshold, setThreshold] = useState('');
  const [windowSecs, setWindowSecs] = useState('');

  // Redirect non-admin
  useEffect(() => {
    if (!authLoading && user?.role !== 'SYSTEM_ADMIN') {
      router.replace('/admin/system');
    }
  }, [user, authLoading, router]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchRateLimits();
      setConfig(data);
      setThreshold(String(data.login_threshold));
      setWindowSecs(String(data.login_window_seconds));
    } catch {
      setLoadError('Failed to load rate-limit configuration. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user?.role === 'SYSTEM_ADMIN') {
      loadConfig();
    }
  }, [authLoading, user, loadConfig]);

  const validationError = (): string | null => {
    const t = Number(threshold);
    const w = Number(windowSecs);
    if (threshold === '' || windowSecs === '') return 'Both fields are required.';
    if (!Number.isFinite(t) || !Number.isInteger(t) || t < 1) {
      return 'Threshold must be a whole number ≥ 1.';
    }
    if (!Number.isFinite(w) || !Number.isInteger(w) || w < 1) {
      return 'Window must be a whole number ≥ 1 seconds.';
    }
    return null;
  };

  const isDirty = (): boolean => {
    if (!config) return false;
    return String(config.login_threshold) !== threshold || String(config.login_window_seconds) !== windowSecs;
  };

  async function handleSave() {
    const err = validationError();
    if (err) {
      setMessage({ text: err, ok: false });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const updated = await updateRateLimits('login', Number(threshold), Number(windowSecs));
      setConfig(updated);
      setThreshold(String(updated.login_threshold));
      setWindowSecs(String(updated.login_window_seconds));
      setMessage({ text: 'Rate-limit configuration saved.', ok: true });
    } catch (e: unknown) {
      const detail =
        e instanceof Error ? e.message : 'Save failed. Check your connection and try again.';
      setMessage({ text: detail, ok: false });
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || (user?.role === 'SYSTEM_ADMIN' && loading)) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]" style={{ color: 'var(--text-secondary)' }}>
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading rate-limit configuration…
      </div>
    );
  }

  if (user?.role !== 'SYSTEM_ADMIN') return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Rate Limits
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Auth-flow rate-limit controls for the login and Keycloak callback endpoint.
          Changes take effect immediately in Redis — no restart required.
        </p>
      </div>

      {/* Explanatory card */}
      <div className="card p-5 text-sm space-y-2" style={{ borderLeft: '3px solid var(--sidebar-bg)' }}>
        <div className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Shield className="w-4 h-4" />
          What this protects
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>
          The <strong>login</strong> tier governs the rate limiter applied to the
          Keycloak authentication callback (<code>/auth/callback</code>) in{' '}
          <code>main.py</code>. It limits how many auth attempts a single IP can
          make within the configured window. This is the legacy API label; the
          limiter now protects the OIDC callback flow rather than a standalone
          login endpoint.
        </p>
        <ul className="list-disc list-inside space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          <li><strong>Threshold</strong> — maximum number of auth attempts allowed per IP in the window.</li>
          <li><strong>Window</strong> — sliding time window in seconds over which the threshold is enforced.</li>
          <li>Stored in Redis key <code>rate_limit_config:login</code>; read by the FastAPI rate-limit middleware on every auth request.</li>
        </ul>
      </div>

      {loadError && (
        <div className="px-6 py-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {loadError}
        </div>
      )}

      {config && (
        <div className="card overflow-hidden">
          <div
            className="card-header flex items-center justify-between"
            style={{ borderLeft: '4px solid var(--sidebar-bg)' }}
          >
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              <span>Login Tier Configuration</span>
            </div>
            <button
              onClick={loadConfig}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-gray-100"
              style={{ color: 'var(--text-secondary)' }}
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Threshold */}
            <div className="flex flex-col sm:flex-row sm:items-start gap-3">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Threshold
                </label>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Maximum auth attempts per IP within the window. Default: 5. Minimum: 1.
                </p>
              </div>
              <div className="sm:min-w-[140px]">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={threshold}
                  onChange={e => {
                    setThreshold(e.target.value);
                    setMessage(null);
                  }}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full font-mono focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                />
              </div>
            </div>

            {/* Window */}
            <div className="flex flex-col sm:flex-row sm:items-start gap-3">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Window (seconds)
                </label>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Sliding time window in seconds. Default: 900 (15 minutes). Minimum: 1.
                </p>
              </div>
              <div className="sm:min-w-[140px]">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={windowSecs}
                  onChange={e => {
                    setWindowSecs(e.target.value);
                    setMessage(null);
                  }}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full font-mono focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                />
              </div>
            </div>

            {/* Save */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={saving || !isDirty()}
                className="flex items-center gap-1 px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                style={{ backgroundColor: isDirty() ? 'var(--sidebar-bg)' : undefined }}
              >
                {saving ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                Save Changes
              </button>
            </div>

            {/* Message */}
            {message && (
              <div
                className={`flex items-center gap-1 text-sm ${message.ok ? 'text-green-600' : 'text-red-600'}`}
              >
                {message.ok ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {message.text}
              </div>
            )}

            {/* Updated-at timestamp */}
            {config.updated_at && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Last updated: {new Date(Number(config.updated_at) * 1000).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
