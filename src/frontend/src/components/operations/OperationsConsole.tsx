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
}: {
  operations: Operation[];
  selectedOperationId: number | null;
  onSelectOperation: (operationId: number) => void;
  canManageReports: boolean;
  canEditOperations: boolean;
  onEditOperation: (operation: Operation) => void;
  onLinkReport: (operationId: number, reportId: number) => void;
  onUnlinkReport: (operationId: number, reportId: number) => void;
}) {
  const [showReportSearch, setShowReportSearch] = useState(false);
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
          <h2 className="text-lg font-black text-slate-950">Board</h2>
        </div>
        <div className="space-y-2">
          {operations.map((op) => (
            <button
              key={op.operation_id}
              type="button"
              onClick={() => onSelectOperation(op.operation_id)}
              className={`w-full rounded-xl border p-3 text-left transition ${
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
              <p className="mt-1 text-xs font-medium text-slate-600">
                {op.linked_reports?.length ?? op.linked_report_ids.length} linked report(s)
              </p>
            </button>
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
              {canManageReports && (
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
                {canManageReports
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
      </aside>
    </div>
  );
}
