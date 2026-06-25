import { Link2, MapPin, ShieldCheck } from 'lucide-react';
import type { LinkedReportDetail } from '@/lib/api/operations';

export function LinkedReportCard({
  report,
  canManage,
  onUnlink,
}: {
  report: LinkedReportDetail;
  canManage: boolean;
  onUnlink?: (reportId: number) => void;
}) {
  const categoryLabel = report.sub_category
    ? `${report.category} / ${report.sub_category}`
    : report.category;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">Report #{report.report_id}</p>
          <p className="text-xs font-medium text-slate-600">{categoryLabel}</p>
        </div>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
          {report.status}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div className="flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" /> Trust {report.trust_score ?? '—'}
        </div>
        <div>{report.safety_status ?? 'Safety unknown'}</div>
        <div>{report.reporting_context ?? 'Context unknown'}</div>
        <div>
          {report.reported_at
            ? new Date(report.reported_at).toLocaleString()
            : 'Submission time only'}
        </div>
        <div className="col-span-2 flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {report.latitude != null && report.longitude != null
            ? `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`
            : 'No coordinates'}
        </div>
        {report.distance_meters != null && (
          <div className="col-span-2">
            {Math.round(report.distance_meters)} m from operation
          </div>
        )}
      </dl>
      {canManage && onUnlink && (
        <button
          type="button"
          onClick={() => onUnlink(report.report_id)}
          aria-label={`Unlink report ${report.report_id}`}
          className="mt-3 inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
        >
          <Link2 className="h-3 w-3" /> Unlink
        </button>
      )}
    </article>
  );
}
