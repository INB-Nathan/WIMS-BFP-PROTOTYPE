'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { Search, Plus, Archive } from 'lucide-react';
import { GhostOperationCards } from '@/components/ui/GhostOperationsCard';
import { MapPickerInner } from '@/components/MapPickerInner';
import { OperationsConsole } from '@/components/operations/OperationsConsole';
import {
  createOperation,
  updateOperation,
  linkReport,
  unlinkReport,
  fetchResetPreview,
  runResetDay,
  restoreOperation,
  type Operation,
  type FireStatus,
  type OperationCreate,
  type OperationResetPreview,
  type LinkableReportDetail,
} from '@/lib/api/operations';
import { fetchOperationsOfflineAware } from '@/lib/api/offlineOperations';
import { LinkableReportSearch } from '@/components/operations/LinkableReportSearch';

type TabValue = 'ON-GOING' | 'FIRE OUT' | 'ALL';
type BoardMode = 'active' | 'archived';

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
  const [boardMode, setBoardMode] = useState<BoardMode>('active');
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Operation | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [linkingTarget, setLinkingTarget] = useState<Operation | null>(null);
  const [selectedOperationId, setSelectedOperationId] = useState<number | null>(null);
  const [resetPreview, setResetPreview] = useState<OperationResetPreview | null>(null);
  const [opsRefreshTrigger, setOpsRefreshTrigger] = useState(0);

  const loadOps = useCallback(async (archived = false) => {
    setOpsLoading(true);
    try {
      const result = await fetchOperationsOfflineAware(undefined, archived);
      setOps(result.response);
    } catch {
      /* non-critical — board renders empty */
    } finally {
      setOpsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) void loadOps(boardMode === 'archived');
  }, [authLoading, boardMode, loadOps]);

  async function handleLink(opId: number, reportId: number) {
    await linkReport(opId, reportId);
    await loadOps(boardMode === 'archived');
  }

  async function handleUnlink(opId: number, reportId: number) {
    await unlinkReport(opId, reportId);
    await loadOps(boardMode === 'archived');
  }

  async function handleKeepOvernight(opId: number, keep: boolean) {
    await updateOperation(opId, { keep_overnight: keep });
    await loadOps(boardMode === 'archived');
    setOpsRefreshTrigger((value) => value + 1);
  }

  async function handleRestore(opId: number, status: FireStatus) {
    await restoreOperation(opId, status);
    await loadOps(boardMode === 'archived');
  }

  async function handleResetDay() {
    await runResetDay();
    setResetPreview(null);
    await loadOps(false);
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

  // Load reset preview when on active board and user is validator
  useEffect(() => {
    if (boardMode === 'active' && isValidator) {
      fetchResetPreview()
        .then(setResetPreview)
        .catch(() => setResetPreview(null));
    } else {
      setResetPreview(null);
    }
  }, [boardMode, isValidator, opsRefreshTrigger]);

  if (authLoading)
    return (
      <div className="space-y-6 p-6" aria-hidden="true">
        {/* Header skeleton */}
        <div className="animate-pulse card">
          <div className="card-body">
            <div className="h-10 w-full rounded-lg bg-gray-200" />
          </div>
        </div>
        {/* Board skeleton */}
        <div className="animate-pulse card">
          <div className="card-body space-y-4">
            <div className="h-6 w-48 rounded bg-gray-200" />
            <div className="flex gap-2">
              <div className="h-8 w-24 rounded-md bg-gray-200" />
              <div className="h-8 w-24 rounded-md bg-gray-200" />
              <div className="h-8 w-16 rounded-md bg-gray-200" />
            </div>
            <GhostOperationCards />
          </div>
        </div>
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
          <div className="flex gap-2 flex-wrap items-center">
            {/* Active / Archived toggle */}
            <div className="flex rounded-lg border border-slate-200 p-0.5">
              <button
                type="button"
                onClick={() => setBoardMode('active')}
                className={`rounded-md px-3 py-1 text-xs font-bold transition ${
                  boardMode === 'active'
                    ? 'bg-red-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setBoardMode('archived')}
                className={`rounded-md px-3 py-1 text-xs font-bold transition ${
                  boardMode === 'archived'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Archive className="mr-1 inline-block h-3 w-3" />
                Archived
              </button>
            </div>
            <div className="w-px h-6 bg-slate-200" />
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
            <GhostOperationCards />
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
              isArchivedBoard={boardMode === 'archived'}
              onKeepOvernight={isValidator ? (id, keep) => void handleKeepOvernight(id, keep) : undefined}
              onRestore={isValidator ? (id, status) => handleRestore(id, status) : undefined}
              resetPreview={resetPreview}
              onResetDay={isValidator ? () => handleResetDay() : undefined}
              loading={opsLoading}
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
            await loadOps(boardMode === 'archived');
            setOpsRefreshTrigger((value) => value + 1);
          }}
        />
      )}

      {linkingTarget && (
        <ReportLinkingModal
          operation={linkingTarget}
          onClose={() => { setLinkingTarget(null); void loadOps(boardMode === 'archived'); }}
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

  function handleRemoveReport(reportId: number) {
    setSelectedReports((current) => current.filter((report) => report.report_id !== reportId));
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
      className="fixed inset-0 z-[1000] flex items-stretch justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <form
        className="z-[1001] flex h-full w-full flex-col overflow-hidden bg-white shadow-xl sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:max-w-5xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-700">Operations</p>
          <h3 className="text-lg font-black text-slate-950">
            {initial ? 'Edit Operation' : 'New Operation'}
          </h3>
          <p className="text-xs text-slate-500">
            Add operation details, set the map pin, and optionally link civilian reports.
          </p>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.95fr)]">
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Status</label>
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
                  <label className="mb-1 block text-xs font-medium text-slate-700">Start Time *</label>
                  <input
                    type="datetime-local"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Location *</label>
                <input
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Address or descriptive location"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
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
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Size (hectares){' '}
                    <span className="font-normal text-slate-400">— auto from radius</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={sizeHa}
                    onChange={(e) => setSizeHa(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="text-xs font-bold text-slate-700">Linked civilian reports</p>
                  <p className="text-xs text-slate-500">{selectedReports.length} selected report(s)</p>
                </div>
                {selectedReports.length === 0 ? (
                  <p className="mt-2 text-xs text-amber-700">No civilian reports linked yet. You can save without links.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedReports.map((report) => (
                      <span key={report.report_id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                        Report #{report.report_id}
                        <button
                          type="button"
                          onClick={() => handleRemoveReport(report.report_id)}
                          aria-label={`Remove report ${report.report_id}`}
                          className="rounded-full px-1 hover:bg-blue-100"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </section>

            <aside className="space-y-3">
              <section className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-700">
                    Pin on Map
                  </label>
                  {lat !== null && lng !== null && (
                    <button
                      type="button"
                      onClick={() => { setLat(null); setLng(null); setRadius(null); }}
                      className="text-xs font-bold text-red-600 hover:underline"
                    >
                      Clear pin
                    </button>
                  )}
                </div>
                <MapPickerInner
                  center={lat && lng ? [lat, lng] : [14.5995, 120.9842]}
                  zoom={12}
                  value={lat && lng ? { lat, lng } : null}
                  onChange={(newLat, newLng) => {
                    setLat(newLat);
                    setLng(newLng);
                    if (!location) setLocation(`(${newLat.toFixed(5)}, ${newLng.toFixed(5)})`);
                  }}
                  mapHeight="260px"
                />
                {lat !== null && lng !== null && (
                  <p className="mt-1 text-xs text-slate-500">📍 {lat.toFixed(5)}, {lng.toFixed(5)}</p>
                )}
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">Civilian reports</p>
                    <p className="text-xs text-slate-500">Search and select reports without expanding the modal height.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowReportPicker((value) => !value)}
                    className="rounded-md border border-red-200 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                  >
                    {showReportPicker ? 'Hide' : 'Select civilian reports'}
                  </button>
                </div>

                {selectedReports.length > 0 && (
                  <div
                    className="mt-3 space-y-2"
                    data-testid="selected-report-summaries"
                    role="region"
                    aria-label="Selected report summaries"
                  >
                    {selectedReports.map((report) => (
                      <div key={report.report_id} className="rounded-lg border border-blue-100 bg-blue-50 p-2 text-xs text-blue-900">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-black">Report #{report.report_id}</p>
                            <p>{report.category}{report.sub_category ? ` / ${report.sub_category}` : ''}</p>
                            {report.distance_meters != null && <p>{Math.round(report.distance_meters)} m away</p>}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveReport(report.report_id)}
                            aria-label={`Remove report ${report.report_id}`}
                            className="font-black text-blue-700 hover:text-blue-900"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {showReportPicker && (
                  <div className="mt-3">
                    <LinkableReportSearch
                      operation={null}
                      mode="select"
                      selectedReportIds={selectedReports.map((report) => report.report_id)}
                      pageSize={5}
                      onSelect={handleSelectReport}
                    />
                  </div>
                )}
              </section>
            </aside>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 flex justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4">
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
