'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { fetchBreaches, updateBreach, Breach, BreachStatus } from '@/lib/api/breach';
import { fetchAdminConfig, updateAdminConfig, SystemConfigEntry } from '@/lib/api/legacy';
import Link from 'next/link';
import { ShieldX, Clock, CheckCircle, AlertTriangle, Phone, User, Building2, Pencil, X, ArrowRight } from 'lucide-react';

const STATUS_LABELS: Record<BreachStatus, string> = {
    DETECTED: 'Detected',
    DPO_NOTIFIED: 'DPO Notified',
    NPC_SUBMITTED: 'NPC Submitted',
    CLOSED: 'Closed',
};

const STATUS_BADGE_STYLE: Record<BreachStatus, string> = {
    DETECTED: 'bg-red-100 text-red-800',
    DPO_NOTIFIED: 'bg-orange-100 text-orange-800',
    NPC_SUBMITTED: 'bg-yellow-100 text-yellow-800',
    CLOSED: 'bg-green-100 text-green-800',
};

const NEXT_STATUS: Partial<Record<BreachStatus, BreachStatus>> = {
    DETECTED: 'DPO_NOTIFIED',
    DPO_NOTIFIED: 'NPC_SUBMITTED',
    NPC_SUBMITTED: 'CLOSED',
};

const NPC_CONFIRM_PHRASE = 'confirm-npc-update';

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function DeadlineCell({ npcDeadlineAt }: { npcDeadlineAt: string }) {
    const deadline = new Date(npcDeadlineAt);
    const now = new Date();
    const overdue = now > deadline;
    const diffMs = deadline.getTime() - now.getTime();
    const diffHours = Math.floor(Math.abs(diffMs) / 3_600_000);
    const diffMins = Math.floor((Math.abs(diffMs) % 3_600_000) / 60_000);

    return (
        <div>
            <div className={`font-medium text-sm ${overdue ? 'text-red-600' : 'text-gray-900'}`}>
                {formatDate(npcDeadlineAt)}
            </div>
            <div className={`text-xs mt-0.5 ${overdue ? 'text-red-500 font-semibold' : 'text-gray-500'}`}>
                {overdue
                    ? `${diffHours}h ${diffMins}m overdue`
                    : `${diffHours}h ${diffMins}m remaining`}
            </div>
        </div>
    );
}

// ─── NPC Contact Edit Modal ─────────────────────────────────────────────────

function NpcEditModal({
    name,
    phone,
    officePhone,
    onClose,
    onSaved,
}: {
    name: string;
    phone: string;
    officePhone: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [editName, setEditName] = useState(name);
    const [editPhone, setEditPhone] = useState(phone);
    const [editOfficePhone, setEditOfficePhone] = useState(officePhone);
    const [confirmInput, setConfirmInput] = useState('');
    const [saving, setSaving] = useState(false);
    const [modalError, setModalError] = useState<string | null>(null);

    const handleSave = async () => {
        if (confirmInput !== NPC_CONFIRM_PHRASE) {
            setModalError('Please type the confirmation phrase exactly to save changes.');
            return;
        }
        setSaving(true);
        setModalError(null);
        const updates: Promise<unknown>[] = [];
        if (editName !== name) updates.push(updateAdminConfig('npc_contact_name', editName));
        if (editPhone !== phone) updates.push(updateAdminConfig('npc_contact_phone', editPhone));
        if (editOfficePhone !== officePhone) updates.push(updateAdminConfig('npc_office_phone', editOfficePhone));
        try {
            await Promise.all(updates);
            onSaved();
        } catch (err) {
            setModalError('Failed to save NPC contact. Please try again.');
            console.error('NPC contact update error', err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Edit NPC Contact</h2>
                    <button onClick={onClose} className="p-1 rounded hover:bg-gray-100" aria-label="Close">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Contact Person Name</label>
                        <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full border rounded-lg px-3 py-2 text-sm"
                            style={{ borderColor: 'var(--border-color)' }}
                            data-testid="npc-edit-name"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Contact Phone</label>
                        <input
                            type="text"
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                            className="w-full border rounded-lg px-3 py-2 text-sm"
                            style={{ borderColor: 'var(--border-color)' }}
                            data-testid="npc-edit-phone"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>NPC Office Phone</label>
                        <input
                            type="text"
                            value={editOfficePhone}
                            onChange={(e) => setEditOfficePhone(e.target.value)}
                            className="w-full border rounded-lg px-3 py-2 text-sm"
                            style={{ borderColor: 'var(--border-color)' }}
                            data-testid="npc-edit-office-phone"
                        />
                    </div>

                    <div className="border-t pt-3 mt-2">
                        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                            Type <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">{NPC_CONFIRM_PHRASE}</code> to confirm changes:
                        </p>
                        <input
                            type="text"
                            value={confirmInput}
                            onChange={(e) => setConfirmInput(e.target.value)}
                            placeholder="Type confirmation phrase"
                            className="w-full border rounded-lg px-3 py-2 text-sm"
                            style={{ borderColor: 'var(--border-color)' }}
                            data-testid="npc-edit-confirm-input"
                        />
                    </div>

                    {modalError && (
                        <div className="text-sm text-red-600 bg-red-50 p-2 rounded" data-testid="npc-edit-error">
                            {modalError}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
                        data-testid="npc-edit-cancel"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 text-sm rounded-lg text-white font-medium disabled:opacity-50"
                        style={{ backgroundColor: 'var(--bfp-maroon)' }}
                        data-testid="npc-edit-save"
                    >
                        {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Status Advance Confirmation Modal ──────────────────────────────────────

function StatusAdvanceModal({
    breach,
    onClose,
    onConfirm,
}: {
    breach: Breach;
    onClose: () => void;
    onConfirm: (notes: string) => Promise<void>;
}) {
    const next = NEXT_STATUS[breach.status];
    const [notes, setNotes] = useState(breach.notes ?? '');
    const [confirming, setConfirming] = useState(false);
    const [modalError, setModalError] = useState<string | null>(null);

    const deadline = new Date(breach.npc_deadline_at);
    const now = new Date();
    const isOverdue = now > deadline && breach.status !== 'CLOSED';
    const diffMs = deadline.getTime() - now.getTime();
    const diffHours = Math.floor(Math.abs(diffMs) / 3_600_000);

    const handleConfirm = async () => {
        setConfirming(true);
        setModalError(null);
        try {
            await onConfirm(notes);
            onClose();
        } catch {
            setModalError('Failed to advance status. The record has not been changed.');
        } finally {
            setConfirming(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Advance Breach Status
                    </h2>
                    <button onClick={onClose} className="p-1 rounded hover:bg-gray-100" aria-label="Close">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Status transition display */}
                <div className="flex items-center justify-center gap-3 mb-4 p-4 bg-gray-50 rounded-lg">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE_STYLE[breach.status]}`}>
                        {STATUS_LABELS[breach.status]}
                    </span>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                    {next && (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE_STYLE[next]}`}>
                            {STATUS_LABELS[next]}
                        </span>
                    )}
                </div>

                {/* Deadline impact */}
                <div className={`p-3 rounded-lg text-sm mb-4 ${isOverdue ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                    <strong>NPC Deadline:</strong> {formatDate(breach.npc_deadline_at)}
                    {isOverdue
                        ? ` — ${diffHours}h overdue`
                        : diffHours < 24
                            ? ` — ${diffHours}h remaining (urgent)`
                            : ` — ${diffHours}h remaining`}
                </div>

                {/* Notes */}
                <div className="mb-4">
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                        Notes / Evidence (optional)
                    </label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                        style={{ borderColor: 'var(--border-color)' }}
                        placeholder="Add supporting notes or evidence for this status change…"
                        data-testid="advance-notes-input"
                    />
                </div>

                {modalError && (
                    <div className="text-sm text-red-600 bg-red-50 p-2 rounded mb-4" data-testid="advance-modal-error">
                        {modalError}
                    </div>
                )}

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
                        data-testid="advance-modal-cancel"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={confirming}
                        className="px-4 py-2 text-sm rounded-lg text-white font-medium disabled:opacity-50"
                        style={{ backgroundColor: 'var(--bfp-maroon)' }}
                        data-testid="advance-modal-confirm"
                    >
                        {confirming ? 'Advancing…' : 'Confirm Advance'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function BreachNotificationsPage() {
    const { user, loading: authLoading } = useAuth();
    const role = (user as { role?: string })?.role ?? null;
    const isAdmin = role === 'SYSTEM_ADMIN';

    const [breaches, setBreaches] = useState<Breach[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState<number | null>(null);

    // NPC contact state
    const [npcConfig, setNpcConfig] = useState<{ name: string; phone: string; officePhone: string }>({
        name: '',
        phone: '',
        officePhone: '',
    });
    const [npcLoading, setNpcLoading] = useState(true);
    const [showNpcEdit, setShowNpcEdit] = useState(false);

    // Status advance modal state
    const [advanceTarget, setAdvanceTarget] = useState<Breach | null>(null);

    // Feedback state
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    const loadNpcConfig = useCallback(async () => {
        if (!isAdmin) return;
        setNpcLoading(true);
        try {
            const config = await fetchAdminConfig();
            const name = config.find((c: SystemConfigEntry) => c.key === 'npc_contact_name')?.value ?? '';
            const phone = config.find((c: SystemConfigEntry) => c.key === 'npc_contact_phone')?.value ?? '';
            const officePhone = config.find((c: SystemConfigEntry) => c.key === 'npc_office_phone')?.value ?? '';
            setNpcConfig({ name, phone, officePhone });
        } catch (err) {
            console.error('Failed to load NPC config', err);
        } finally {
            setNpcLoading(false);
        }
    }, [isAdmin]);

    const loadAll = useCallback(async () => {
        if (!isAdmin) return;
        setLoading(true);
        setError(null);
        setActionError(null);
        try {
            const [data] = await Promise.all([fetchBreaches(), loadNpcConfig()]);
            setBreaches(data);
        } catch (err) {
            setError('Failed to load breach records.');
            console.error('fetchBreaches error', err);
        } finally {
            setLoading(false);
        }
    }, [isAdmin, loadNpcConfig]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    // ─── Status advance handler (opens modal) ──────────────────────────────
    const openStatusAdvance = (breach: Breach) => {
        const next = NEXT_STATUS[breach.status];
        if (!next) return;
        setAdvanceTarget(breach);
    };

    const confirmStatusAdvance = async (notes: string) => {
        if (!advanceTarget) return;
        const next = NEXT_STATUS[advanceTarget.status];
        if (!next) return;
        setUpdating(advanceTarget.breach_id);
        const payload: { status: BreachStatus; notes?: string } = { status: next };
        if (notes.trim()) {
            payload.notes = notes.trim();
        }
        try {
            const updated = await updateBreach(advanceTarget.breach_id, payload);
            setBreaches((prev) =>
                prev.map((b) => (b.breach_id === updated.breach_id ? updated : b))
            );
            setSuccessMessage(`Breach #${advanceTarget.breach_id} advanced to ${STATUS_LABELS[next]}.`);
            setTimeout(() => setSuccessMessage(null), 5000);
            setAdvanceTarget(null);
        } catch {
            // The modal will display its own error; keep prior row state
            throw new Error('updateBreach failed');
        } finally {
            setUpdating(null);
        }
    };

    if (authLoading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh] text-gray-500">
                Loading…
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
                Access restricted to System Administrators.
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="card">
                <div className="card-body flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ShieldX className="w-6 h-6 text-red-600" />
                        <div>
                            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                                Breach Notifications
                            </h1>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                RA 10173 — NPC 72-hour tracking
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={loadAll}
                        className="text-sm px-4 py-2 rounded-lg font-medium transition-colors"
                        style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {/* Success banner */}
            {successMessage && (
                <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-3 text-sm flex items-center gap-2" data-testid="success-banner">
                    <CheckCircle className="w-4 h-4" />
                    {successMessage}
                </div>
            )}

            {/* Action-level error */}
            {actionError && (
                <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm flex items-center gap-2" data-testid="action-error-banner">
                    <AlertTriangle className="w-4 h-4" />
                    {actionError}
                </div>
            )}

            {/* NPC Contact Card */}
            <div className="card" data-testid="npc-contact-card">
                <div className="card-body">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            NPC Contact Information
                        </h2>
                        <button
                            onClick={() => setShowNpcEdit(true)}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
                            style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
                            data-testid="npc-edit-button"
                        >
                            <Pencil className="w-3 h-3" />
                            Edit
                        </button>
                    </div>
                    {npcLoading ? (
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading NPC contact…</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="flex items-center gap-2">
                                <User className="w-4 h-4" style={{ color: 'var(--bfp-maroon)' }} />
                                <div>
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Contact Person</p>
                                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }} data-testid="npc-name-display">
                                        {npcConfig.name || 'Not configured'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Phone className="w-4 h-4" style={{ color: 'var(--bfp-maroon)' }} />
                                <div>
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Contact Phone</p>
                                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }} data-testid="npc-phone-display">
                                        {npcConfig.phone || 'Not configured'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Building2 className="w-4 h-4" style={{ color: 'var(--bfp-maroon)' }} />
                                <div>
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>NPC Office Phone</p>
                                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }} data-testid="npc-office-phone-display">
                                        {npcConfig.officePhone || 'Not configured'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="card overflow-hidden">
                {loading ? (
                    <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
                        Loading breach records…
                    </div>
                ) : error ? (
                    <div className="p-10 text-center text-red-600">{error}</div>
                ) : breaches.length === 0 ? (
                    <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
                        <CheckCircle className="w-10 h-10 mx-auto mb-3 text-green-500" />
                        No breach records found.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr style={{ backgroundColor: 'var(--table-header-bg)', borderBottom: '1px solid var(--border-color)' }}>
                                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Breach #</th>
                                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Threat Log</th>
                                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Detected</th>
                                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>NPC Deadline</th>
                                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                                    {isAdmin && (
                                        <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Action</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {breaches.map((breach) => {
                                    const overdue = new Date() > new Date(breach.npc_deadline_at) && breach.status !== 'CLOSED';
                                    const nextStatus = NEXT_STATUS[breach.status];
                                    return (
                                        <tr
                                            key={breach.breach_id}
                                            style={{
                                                borderBottom: '1px solid var(--border-color)',
                                                backgroundColor: overdue ? '#fff5f5' : undefined,
                                            }}
                                        >
                                            <td className="px-4 py-3 font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {overdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500 inline mr-1" />}
                                                #{breach.breach_id}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Link
                                                    href={`/admin/system#telemetry`}
                                                    className="text-blue-600 hover:underline font-mono text-xs"
                                                >
                                                    Log #{breach.threat_log_id}
                                                </Link>
                                            </td>
                                            <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
                                                {formatDate(breach.detected_at)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <DeadlineCell npcDeadlineAt={breach.npc_deadline_at} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE_STYLE[breach.status]}`}>
                                                    {breach.status === 'DETECTED' && <Clock className="w-3 h-3" />}
                                                    {breach.status === 'CLOSED' && <CheckCircle className="w-3 h-3" />}
                                                    {STATUS_LABELS[breach.status]}
                                                </span>
                                            </td>
                                            {isAdmin && (
                                                <td className="px-4 py-3">
                                                    {nextStatus && (
                                                        <button
                                                            onClick={() => openStatusAdvance(breach)}
                                                            disabled={updating === breach.breach_id}
                                                            className="text-xs px-3 py-1.5 rounded-md font-medium transition-colors disabled:opacity-50"
                                                            style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
                                                            data-testid={`advance-breach-${breach.breach_id}`}
                                                        >
                                                            {updating === breach.breach_id
                                                                ? 'Updating…'
                                                                : `→ ${STATUS_LABELS[nextStatus]}`}
                                                        </button>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* NPC Edit Modal */}
            {showNpcEdit && (
                <NpcEditModal
                    name={npcConfig.name}
                    phone={npcConfig.phone}
                    officePhone={npcConfig.officePhone}
                    onClose={() => setShowNpcEdit(false)}
                    onSaved={() => {
                        setShowNpcEdit(false);
                        setSuccessMessage('NPC contact information updated.');
                        setTimeout(() => setSuccessMessage(null), 5000);
                        loadNpcConfig();
                    }}
                />
            )}

            {/* Status Advance Confirmation Modal */}
            {advanceTarget && (
                <StatusAdvanceModal
                    breach={advanceTarget}
                    onClose={() => setAdvanceTarget(null)}
                    onConfirm={confirmStatusAdvance}
                />
            )}
        </div>
    );
}
