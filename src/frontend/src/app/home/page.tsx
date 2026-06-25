'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { Search, Loader2, Pencil, Plus, Trash2, Link2 } from 'lucide-react';
import { MapPickerInner } from '@/components/MapPickerInner';
import { OperationsConsole } from '@/components/operations/OperationsConsole';
import {
  fetchOperations,
  createOperation,
  updateOperation,
  deleteOperation,
  linkReport,
  unlinkReport,
  type Operation,
  type FireStatus,
  type OperationCreate,
  type LinkableReportDetail,
} from '@/lib/api/operations';
import { LinkableReportSearch } from '@/components/operations/LinkableReportSearch';

type TabValue = 'ON-GOING' | 'FIRE OUT' | 'ALL';

const STATUS_BADGE: Record<FireStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-red-100 text-red-700 border-red-200' },
  CONTAINED: { label: 'Contained', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  FIRE_OUT: { label: 'Fire Out', className: 'bg-green-100 text-green-700 border-green-200' },
};

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const role = (user as { role?: string } | null)?.role ?? null;
  const isValidator = role === 'NATIONAL_VALIDATOR';
  const auditHref =
    role === 'SYSTEM_ADMIN'
      ? '/admin/audit'
      : role === 'NATIONAL_VALIDATOR'
      ? '/dashboard/validator/audit'
      : role === 'REGIONAL_ENCODER'
      ? '/dashboard/regional/audit'
      : null;

  const [ops, setOps] = useState<Operation[]>([]);
  const [opsLoading, setOpsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabValue>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Operation | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [linkingTarget, setLinkingTarget] = useState<Operation | null>(null);
  const [selectedOperationId, setSelectedOperationId] = useState<number | null>(null);

  const loadOps = useCallback(async () => {
    setOpsLoading(true);
    try {
      const data = await fetchOperations();
      setOps(data);
    } catch {
      /* non-critical — board renders empty */
    } finally {
      setOpsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) void loadOps();
  }, [authLoading, loadOps]);

  async function handleLink(opId: number, reportId: number) {
    await linkReport(opId, reportId);
    await loadOps();
  }

  async function handleUnlink(opId: number, reportId: number) {
    await unlinkReport(opId, reportId);
    await loadOps();
  }

  const filteredOps = ops.filter((op) => {
    const matchTab =
      activeTab === 'ON-GOING'
        ? op.fire_status === 'ACTIVE' || op.fire_status === 'CONTAINED'
        : activeTab === 'FIRE OUT'
          ? op.fire_status === 'FIRE_OUT'
          : true;
    const matchSearch =
      op.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (op.notes ?? '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchTab && matchSearch;
  });

  useEffect(() => {
    if (filteredOps.length === 0) {
      setSelectedOperationId(null);
      return;
    }
    if (selectedOperationId == null || !filteredOps.some((op) => op.operation_id === selectedOperationId)) {
      setSelectedOperationId(filteredOps[0].operation_id);
    }
  }, [filteredOps, selectedOperationId]);

  async function handleStatusChange(id: number, status: FireStatus) {
    await updateOperation(id, { fire_status: status });
    await loadOps();
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this operation?')) return;
    await deleteOperation(id);
    await loadOps();
  }

  if (authLoading)
    return (
      <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
        Loading Operations Center...
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="card">
        <div className="card-body flex flex-col md:flex-row gap-4 items-center justify-between">
          <div
            className="flex items-center gap-3 flex-1 w-full md:max-w-md px-4 py-2.5 rounded-lg"
            style={{ backgroundColor: '#f3f4f6' }}
          >
            <span
              className="text-xs font-bold tracking-wider uppercase"
              style={{ color: 'var(--bfp-maroon)' }}
            >
              Operations
            </span>
            <div className="w-px h-5 bg-gray-300" />
            <input
              type="text"
              placeholder="Search location or notes..."
              className="bg-transparent outline-none flex-1 text-sm placeholder-gray-400"
              style={{ color: 'var(--text-primary)' }}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Search className="w-4 h-4 text-gray-400" />
          </div>
          {auditHref && (
            <Link
              href={auditHref}
              className="text-sm font-bold text-white px-5 py-2 rounded-lg transition-colors"
              style={{ backgroundColor: '#16a34a' }}
            >
              View All Logs
            </Link>
          )}
        </div>
      </div>

      {/* Operations Board */}
      <div className="card">
        <div className="card-body space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Operations Board
            </h2>
            {isValidator && (
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-2 rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800"
              >
                <Plus className="h-4 w-4" /> New Operation
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 flex-wrap">
            {(['ON-GOING', 'FIRE OUT', 'ALL'] as TabValue[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  activeTab === tab
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {opsLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
            </div>
          ) : filteredOps.length === 0 ? (
            <div className="rounded-md border border-slate-200 p-8 text-center text-sm text-slate-500">
              No operations found.
            </div>
          ) : (
            <OperationsConsole
              operations={filteredOps}
              selectedOperationId={selectedOperationId}
              onSelectOperation={setSelectedOperationId}
              canManageReports={isValidator}
              onLinkReport={(operationId, reportId) => void handleLink(operationId, reportId)}
              onUnlinkReport={(operationId, reportId) => void handleUnlink(operationId, reportId)}
            />
          )}
        </div>
      </div>

      {/* Create / Edit modal */}
      {(showForm || editTarget) && (
        <OperationFormModal
          initial={editTarget}
          onClose={() => {
            setShowForm(false);
            setEditTarget(null);
          }}
          onSave={async (data) => {
            if (editTarget) {
              await updateOperation(editTarget.operation_id, data);
            } else {
              await createOperation(data);
            }
            setShowForm(false);
            setEditTarget(null);
            await loadOps();
          }}
        />
      )}

      {linkingTarget && (
        <ReportLinkingModal
          operation={linkingTarget}
          onClose={() => { setLinkingTarget(null); loadOps(); }}
          onLink={handleLink}
          onUnlink={handleUnlink}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OperationFormModal
// ---------------------------------------------------------------------------

function OperationFormModal({
  initial,
  onClose,
  onSave,
}: {
  initial: Operation | null;
  onClose: () => void;
  onSave: (data: OperationCreate) => Promise<void>;
}) {
  const [fireStatus, setFireStatus] = useState<FireStatus>(initial?.fire_status ?? 'ACTIVE');
  const [startTime, setStartTime] = useState(
    initial?.start_time ? new Date(initial.start_time).toISOString().slice(0, 16) : '',
  );
  const [location, setLocation] = useState(initial?.location ?? '');
  const [sizeHa, setSizeHa] = useState(initial?.size_hectares?.toString() ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [lat, setLat] = useState<number | null>(initial?.latitude ?? null);
  const [lng, setLng] = useState<number | null>(initial?.longitude ?? null);
  const [radius, setRadius] = useState<number | null>(initial?.radius_meters ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedReports, setSelectedReports] = useState<LinkableReportDetail[]>([]);
  const [showReportPicker, setShowReportPicker] = useState(false);

  function handleSelectReport(report: LinkableReportDetail) {
    setSelectedReports((current) => {
      if (current.some((item) => item.report_id === report.report_id)) return current;
      return [...current, report];
    });
    if (selectedReports.length === 0) {
      if (report.latitude != null && report.longitude != null) {
        setLat(report.latitude);
        setLng(report.longitude);
        if (!location) setLocation(`Report #${report.report_id} (${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)})`);
      }
      if (report.reported_at && !startTime) {
        setStartTime(new Date(report.reported_at).toISOString().slice(0, 16));
      }
      if (!notes) {
        setNotes(`Report #${report.report_id}: ${report.category}${report.sub_category ? ` / ${report.sub_category}` : ''}`);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        fire_status: fireStatus,
        start_time: new Date(startTime).toISOString(),
        location,
        size_hectares: sizeHa ? parseFloat(sizeHa) : undefined,
        notes: notes || undefined,
        latitude: lat ?? undefined,
        longitude: lng ?? undefined,
        radius_meters: radius ?? undefined,
        linked_report_ids: selectedReports.map((report) => report.report_id),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        className="z-[1001] w-full max-w-md rounded-md bg-white p-5 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <h3 className="text-base font-semibold text-slate-900">
          {initial ? 'Edit Operation' : 'New Operation'}
        </h3>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
            <select
              value={fireStatus}
              onChange={(e) => setFireStatus(e.target.value as FireStatus)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="ACTIVE">Active</option>
              <option value="CONTAINED">Contained</option>
              <option value="FIRE_OUT">Fire Out</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Start Time *</label>
            <input
              type="datetime-local"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Location *</label>
            <input
              required
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Address or descriptive location"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Pin on Map
            </label>
            <MapPickerInner
              center={lat && lng ? [lat, lng] : [14.5995, 120.9842]}
              zoom={12}
              value={lat && lng ? { lat, lng } : null}
              onChange={(newLat, newLng) => {
                setLat(newLat);
                setLng(newLng);
                // Auto-fill location from coordinates if empty
                if (!location) setLocation(`(${newLat.toFixed(5)}, ${newLng.toFixed(5)})`);
              }}
              mapHeight="220px"
            />
            {lat !== null && lng !== null && (
              <p className="text-xs text-slate-500 mt-1">
                📍 {lat.toFixed(5)}, {lng.toFixed(5)}
                <button
                  type="button"
                  onClick={() => { setLat(null); setLng(null); setRadius(null); }}
                  className="ml-2 text-red-600 hover:underline"
                >
                  Clear pin
                </button>
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Fire Radius (meters)
            </label>
            <input
              type="number"
              min="0"
              step="10"
              value={radius ?? ''}
              onChange={(e) => {
                const val = e.target.value ? parseFloat(e.target.value) : null;
                setRadius(val);
                // Auto-calculate hectares: π * r² / 10000
                if (val && val > 0) {
                  const ha = (Math.PI * val * val) / 10000;
                  setSizeHa(ha.toFixed(2));
                }
              }}
              placeholder="e.g. 500"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Size (hectares){' '}
              <span className="text-slate-400 font-normal">— auto from radius</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={sizeHa}
              onChange={(e) => setSizeHa(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-slate-700">Linked civilian reports</p>
                <p className="text-xs text-slate-500">{selectedReports.length} selected report(s)</p>
              </div>
              <button
                type="button"
                onClick={() => setShowReportPicker((value) => !value)}
                className="rounded-md border border-red-200 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
              >
                Select civilian reports
              </button>
            </div>
            {selectedReports.length === 0 && (
              <p className="mt-2 text-xs text-amber-700">No civilian reports linked yet. You can save without links.</p>
            )}
            {selectedReports.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedReports.map((report) => (
                  <span key={report.report_id} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                    Report #{report.report_id}
                  </span>
                ))}
              </div>
            )}
            {showReportPicker && (
              <div className="mt-3">
                <LinkableReportSearch
                  operation={null}
                  mode="select"
                  selectedReportIds={selectedReports.map((report) => report.report_id)}
                  onSelect={handleSelectReport}
                />
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReportLinkingModal — search + link citizen reports to an operation
// ---------------------------------------------------------------------------

function ReportLinkingModal({
  operation,
  onClose,
  onLink,
  onUnlink,
}: {
  operation: Operation;
  onClose: () => void;
  onLink: (opId: number, reportId: number) => Promise<void>;
  onUnlink: (opId: number, reportId: number) => Promise<void>;
}) {
  const [reportIdInput, setReportIdInput] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = parseInt(reportIdInput, 10);
    if (!id || id < 1) {
      setError('Enter a valid report ID');
      return;
    }
    if (operation.linked_report_ids.includes(id)) {
      setError('This report is already linked');
      return;
    }
    setLinking(true);
    setError(null);
    try {
      await onLink(operation.operation_id, id);
      setReportIdInput('');
    } catch {
      setError('Failed to link report');
    } finally {
      setLinking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="z-[1001] w-full max-w-md rounded-md bg-white p-5 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900">
          Linked Reports — {operation.location}
        </h3>

        {/* Currently linked reports */}
        <div>
          <p className="text-xs font-medium text-slate-700 mb-2">Currently linked:</p>
          {operation.linked_report_ids.length === 0 ? (
            <p className="text-xs text-slate-500">No reports linked yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {operation.linked_report_ids.map((rid) => (
                <span
                  key={rid}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 border border-blue-200"
                >
                  Report #{rid}
                  <button
                    type="button"
                    onClick={() => void onUnlink(operation.operation_id, rid)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-blue-200 transition-colors"
                    aria-label={`Unlink report ${rid}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Link new report */}
        <form onSubmit={(e) => void handleLinkSubmit(e)} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Link a citizen report by ID
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                value={reportIdInput}
                onChange={(e) => setReportIdInput(e.target.value)}
                placeholder="Report ID"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={linking}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {linking ? 'Linking…' : 'Link'}
              </button>
            </div>
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          </div>
        </form>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
