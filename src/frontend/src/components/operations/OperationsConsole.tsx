import { Moon, RotateCcw, History } from 'lucide-react';
import { useState } from 'react';
import OperationsMap from '@/components/OperationsMap';
import type { FireStatus, Operation } from '@/lib/api/operations';
import { LinkedReportCard } from './LinkedReportCard';
import { LinkableReportSearch } from './LinkableReportSearch';

const STATUS_BADGE: Record<FireStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-red-100 text-red-700 border-red-200' },
  CONTAINED: { label: 'Contained', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  FIRE_OUT: { label: 'Fire Out', className: 'bg-green-100 text-green-700 border-green-200' },
};

export function OperationsConsole({
  operations,
  selectedOperationId,
  onSelectOperation,
  canManageReports,
  canEditOperations,
  onEditOperation,
  onLinkReport,
  onUnlinkReport,
  isArchivedBoard = false,
  onKeepOvernight,
  onRestore,
  resetPreview,
  onResetDay,
  loading = false,
}: {
  operations: Operation[];
  selectedOperationId: number | null;
  onSelectOperation: (operationId: number) => void;
  canManageReports: boolean;
  canEditOperations: boolean;
  onEditOperation: (operation: Operation) => void;
  onLinkReport: (operationId: number, reportId: number) => void;
  onUnlinkReport: (operationId: number, reportId: number) => void;
  isArchivedBoard?: boolean;
  onKeepOvernight?: (id: number, keep: boolean) => void;
  onRestore?: (id: number, status: FireStatus) => void;
  resetPreview?: { archive_count: number; carried_over_count: number } | null;
  onResetDay?: () => void;
  loading?: boolean;
}) {
  const [showReportSearch, setShowReportSearch] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Operation | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const selectedOperation =
    operations.find((op) => op.operation_id === selectedOperationId) ?? operations[0] ?? null;
  const selectedReports = selectedOperation?.linked_reports ?? [];

  return (
    <div
      data-testid="operations-split-console"
      className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]"
    >
      <section
        data-testid="operations-map-pane"
        className="order-1 rounded-2xl border border-slate-200 bg-slate-950/5 p-2"
      >
        <OperationsMap
          operations={operations}
          selectedOperationId={selectedOperation?.operation_id ?? null}
          linkedReports={selectedReports}
        />
      </section>

      <aside
        data-testid="operations-panel-pane"
        className="order-2 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-700">Operations</p>
          <h2 className="text-lg font-black text-slate-950">
            {isArchivedBoard ? 'Archived' : 'Board'}
          </h2>
          {isArchivedBoard && selectedOperation && (
            <p className="mt-0.5 text-xs text-slate-500">
              Archived {selectedOperation.archived_at ? new Date(selectedOperation.archived_at).toLocaleDateString() : ''}
              {selectedOperation.archive_reason ? ` · ${selectedOperation.archive_reason}` : ''}
            </p>
          )}
        </div>
        {/* Reset Day button — active board, validator only */}
        {!isArchivedBoard && canManageReports && onResetDay && operations.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset Day
            </button>
          </div>
        )}
        <div className="space-y-2">
          {operations.map((op) => (
            <div
              key={op.operation_id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectOperation(op.operation_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectOperation(op.operation_id);
                }
              }}
              className={`w-full cursor-pointer rounded-xl border p-3 text-left transition ${
                selectedOperation?.operation_id === op.operation_id
                  ? 'border-red-300 bg-red-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">{op.location}</p>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[op.fire_status].className}`}
                >
                  {STATUS_BADGE[op.fire_status].label}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {new Date(op.start_time).toLocaleString()}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-600">
                  {op.linked_reports?.length ?? op.linked_report_ids.length} linked report(s)
                </p>
                {/* Keep overnight — active board, validator only */}
                {!isArchivedBoard && canManageReports && onKeepOvernight && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onKeepOvernight(op.operation_id, !op.keep_overnight);
                    }}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      op.keep_overnight
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
                    }`}
                    title={op.keep_overnight ? 'Will be kept overnight' : 'Keep overnight'}
                  >
                    <Moon className="h-3 w-3" />
                    {op.keep_overnight ? 'Kept overnight' : 'Keep overnight'}
                  </button>
                )}
                {/* Restore — archived board, validator only */}
                {isArchivedBoard && canManageReports && onRestore && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRestoreTarget(op);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700 hover:bg-green-100"
                  >
                    <History className="h-3 w-3" /> Restore
                  </button>
                )}
              </div>
              {op.keep_overnight && !isArchivedBoard && (
                <p className="mt-0.5 text-[10px] text-indigo-500">
                  This operation will survive the next day reset.
                </p>
              )}
            </div>
          ))}
        </div>

        {selectedOperation && (
          <section className="space-y-3 border-t border-slate-200 pt-4">
            {canEditOperations && (
              <button
                type="button"
                onClick={() => onEditOperation(selectedOperation)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Edit Operation
              </button>
            )}
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-slate-900">Linked civilian reports</h3>
              {!isArchivedBoard && canManageReports && (
                <button
                  type="button"
                  onClick={() => setShowReportSearch((value) => !value)}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                >
                  Add civilian reports
                </button>
              )}
            </div>
            {selectedReports.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                {!isArchivedBoard && canManageReports
                  ? 'No civilian reports linked yet. Add civilian reports from this panel.'
                  : 'No civilian reports linked.'}
              </div>
            ) : (
              <div className="space-y-2">
                {selectedReports.map((report) => (
                  <LinkedReportCard
                    key={report.report_id}
                    report={report}
                    canManage={canManageReports}
                    onUnlink={(reportId) =>
                      onUnlinkReport(selectedOperation.operation_id, reportId)
                    }
                  />
                ))}
              </div>
            )}
            {canManageReports && selectedOperation && showReportSearch && (
              <LinkableReportSearch
                operation={selectedOperation}
                mode="link"
                pageSize={Number.MAX_SAFE_INTEGER}
                onLink={(reportId) => onLinkReport(selectedOperation.operation_id, reportId)}
              />
            )}
          </section>
        )}

        {/* Reset Day confirmation modal */}
        {resetConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-black text-slate-900">Reset Day</h3>
              <p className="mt-2 text-sm text-slate-600">
                {resetPreview
                  ? `This will archive ${resetPreview.archive_count} operation(s) and carry over ${resetPreview.carried_over_count} kept-overnight operation(s).`
                  : 'All active operations without the Keep Overnight flag will be archived.'}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetConfirmOpen(false)}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetConfirmOpen(false);
                    onResetDay?.();
                  }}
                  className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-700"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Restore modal */}
        {restoreTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-black text-slate-900">Restore Operation</h3>
              <p className="mt-1 text-sm text-slate-600">
                Choose the current fire status for {restoreTarget.location}.
              </p>
              <div className="mt-3 space-y-2">
                {(['ACTIVE', 'CONTAINED', 'FIRE_OUT'] as FireStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={restoreBusy}
                    onClick={async () => {
                      if (!onRestore) return;
                      setRestoreBusy(true);
                      try {
                        await onRestore(restoreTarget.operation_id, status);
                      } finally {
                        setRestoreBusy(false);
                        setRestoreTarget(null);
                      }
                    }}
                    className={`w-full rounded-lg border px-4 py-2 text-left text-sm font-bold ${
                      STATUS_BADGE[status].className
                    } hover:opacity-80 disabled:opacity-40`}
                  >
                    {STATUS_BADGE[status].label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setRestoreTarget(null)}
                disabled={restoreBusy}
                className="mt-3 w-full rounded-md border border-slate-200 py-1.5 text-sm text-slate-600 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
