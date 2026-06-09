'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { fetchAdminConfig, updateAdminConfig, SystemConfigEntry } from '@/lib/api/legacy';
import { Settings, Save, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { initOfflineStorageLimit } from '@/lib/offlineStore';

export default function SystemConfigPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    const [config, setConfig] = useState<SystemConfigEntry[]>([]);
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState<Record<string, boolean>>({});
    const [messages, setMessages] = useState<Record<string, { text: string; ok: boolean }>>({});
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        if (!authLoading && user?.role !== 'SYSTEM_ADMIN') {
            router.replace('/admin/system');
        }
    }, [user, authLoading, router]);

    const loadConfig = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const rows = await fetchAdminConfig();
            setConfig(rows);
            const initial: Record<string, string> = {};
            rows.forEach(r => { initial[r.key] = r.value; });
            setEdits(initial);
            // Sync offline storage cap from admin config.
            const offlineRow = rows.find(r => r.key === 'offline_storage_mb');
            if (offlineRow) {
                const mb = Number(offlineRow.value);
                if (!isNaN(mb) && mb > 0) {
                    initOfflineStorageLimit(mb);
                }
            }
        } catch {
            setLoadError('Failed to load configuration. Check your connection and try again.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!authLoading && user?.role === 'SYSTEM_ADMIN') {
            loadConfig();
        }
    }, [authLoading, user, loadConfig]);

    async function handleSave(key: string) {
        setSaving(prev => ({ ...prev, [key]: true }));
        setMessages(prev => ({ ...prev, [key]: { text: '', ok: true } }));
        try {
            await updateAdminConfig(key, edits[key] ?? '');
            setMessages(prev => ({ ...prev, [key]: { text: 'Saved.', ok: true } }));
            setConfig(prev => prev.map(r => r.key === key ? { ...r, value: edits[key] ?? '' } : r));
            // Immediately sync offline storage cap if that key was just saved.
            if (key === 'offline_storage_mb') {
                const mb = Number(edits[key] ?? '50');
                if (!isNaN(mb) && mb > 0) {
                    initOfflineStorageLimit(mb);
                }
            }
        } catch {
            setMessages(prev => ({ ...prev, [key]: { text: 'Save failed.', ok: false } }));
        } finally {
            setSaving(prev => ({ ...prev, [key]: false }));
        }
    }

    if (authLoading || (user?.role === 'SYSTEM_ADMIN' && loading)) {
        return (
            <div className="flex items-center justify-center min-h-[40vh]" style={{ color: 'var(--text-secondary)' }}>
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading configuration…
            </div>
        );
    }

    if (user?.role !== 'SYSTEM_ADMIN') return null;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    System Configuration
                </h1>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Admin-tunable thresholds and timeouts. Changes take effect on the next
                    relevant service invocation — no restart required.
                </p>
            </div>

            <div className="card overflow-hidden">
                <div
                    className="card-header flex items-center justify-between"
                    style={{ borderLeft: '4px solid var(--sidebar-bg)' }}
                >
                    <div className="flex items-center gap-2">
                        <Settings className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Configuration Values</span>
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

                {loadError && (
                    <div className="px-6 py-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border-b border-red-100">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        {loadError}
                    </div>
                )}

                <div className="divide-y divide-gray-100">
                    {config.map(row => {
                        const msg = messages[row.key];
                        const dirty = edits[row.key] !== row.value;
                        return (
                            <div key={row.key} className="px-6 py-5">
                                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <code
                                                className="text-sm font-mono font-semibold px-1.5 py-0.5 rounded"
                                                style={{
                                                    backgroundColor: 'rgba(60,75,100,0.08)',
                                                    color: 'var(--sidebar-bg)',
                                                }}
                                            >
                                                {row.key}
                                            </code>
                                        </div>
                                        {row.description && (
                                            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                                {row.description}
                                            </p>
                                        )}
                                        {row.updated_at && (
                                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                                                Last updated: {new Date(row.updated_at).toLocaleString()}
                                                {row.updated_by ? ` by ${row.updated_by.slice(0, 8)}…` : ''}
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-2 sm:min-w-[220px]">
                                        <input
                                            type="text"
                                            value={edits[row.key] ?? row.value}
                                            onChange={e =>
                                                setEdits(prev => ({ ...prev, [row.key]: e.target.value }))
                                            }
                                            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-28 font-mono focus:outline-none focus:ring-2"
                                            style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                                        />
                                        <button
                                            onClick={() => handleSave(row.key)}
                                            disabled={saving[row.key] || !dirty}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                                            style={{ backgroundColor: dirty ? 'var(--sidebar-bg)' : undefined }}
                                        >
                                            {saving[row.key] ? (
                                                <RefreshCw className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <Save className="w-3 h-3" />
                                            )}
                                            Save
                                        </button>
                                    </div>
                                </div>

                                {msg?.text && (
                                    <div
                                        className={`mt-2 flex items-center gap-1 text-xs ${msg.ok ? 'text-green-600' : 'text-red-600'}`}
                                    >
                                        {msg.ok
                                            ? <CheckCircle className="w-3 h-3" />
                                            : <AlertCircle className="w-3 h-3" />}
                                        {msg.text}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {!loading && config.length === 0 && !loadError && (
                        <div className="px-6 py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                            No configuration keys found. Run migration 49_system_config.sql.
                        </div>
                    )}
                </div>
            </div>

            <div className="card p-5 text-xs space-y-1" style={{ color: 'var(--text-secondary)', borderLeft: '3px solid #e2e8f0' }}>
                <p><strong>session_timeout_minutes</strong> — exposed for frontend idle-warning UI only. Actual JWT expiry is enforced at the Keycloak realm level and is not changed by this setting.</p>
                <p><strong>offline_storage_mb</strong> — advisory cap enforced client-side in offlineStore.ts. No server-side eviction occurs.</p>
                <p><strong>Redis hot-reload</strong> — deferred. Config reads go direct to DB; no Redis caching layer.</p>
            </div>
        </div>
    );
}
