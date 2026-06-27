'use client';

import { useEffect, useMemo, useReducer, useState } from 'react';
import { Search } from 'lucide-react';
import { fetchLinkableReports, type LinkableReportDetail, type Operation } from '@/lib/api/operations';

type FetchState = {
  loading: boolean;
  error: string | null;
  reports: LinkableReportDetail[];
};
type FetchAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; reports: LinkableReportDetail[] }
  | { type: 'FETCH_ERROR'; error: string };

function fetchReducer(state: FetchState, action: FetchAction): FetchState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS':
      return { loading: false, error: null, reports: action.reports };
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.error };
    default:
      return state;
  }
}

export function LinkableReportSearch({
  operation,
  mode,
  selectedReportIds = [],
  pageSize = 5,
  onLink,
  onSelect,
}: {
  operation: Operation | null;
  mode: 'link' | 'select';
  selectedReportIds?: number[];
  pageSize?: number;
  onLink?: (reportId: number) => void;
  onSelect?: (report: LinkableReportDetail) => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [state, dispatch] = useReducer(fetchReducer, { loading: true, error: null, reports: [] });
  const { loading, error, reports } = state;
  const safePageSize = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(reports.length / safePageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedReports = useMemo(
    () => reports.slice(currentPage * safePageSize, currentPage * safePageSize + safePageSize),
    [currentPage, reports, safePageSize],
  );

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'FETCH_START' });
    fetchLinkableReports({
      operation_id: operation?.operation_id,
      q: query || undefined,
      latitude: operation?.latitude ?? undefined,
      longitude: operation?.longitude ?? undefined,
    })
      .then((data) => {
        if (!cancelled) {
          setPage(0);
          dispatch({ type: 'FETCH_SUCCESS', reports: data });
        }
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'FETCH_ERROR', error: 'Unable to load linkable reports.' });
      });
    return () => {
      cancelled = true;
    };
  }, [operation?.operation_id, operation?.latitude, operation?.longitude, query]);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder="Search reports by category or location..."
          className="w-full bg-transparent outline-none"
        />
      </label>
      {loading && <p className="text-xs text-slate-500">Loading civilian reports…</p>}
      {error && <p className="text-xs font-medium text-red-700">{error}</p>}
      {!loading && !error && reports.length === 0 && <p className="text-xs text-slate-500">No linkable reports match the current filters.</p>}
      <div className="max-h-80 space-y-2 overflow-y-auto pr-1" data-testid="linkable-report-results">
        {pagedReports.map((report) => {
          const categoryLabel = report.sub_category ? `${report.category} / ${report.sub_category}` : report.category;
          const selected = selectedReportIds.includes(report.report_id);
          const disabled = report.link_disabled || selected;
          return (
            <article key={report.report_id} className={`rounded-lg border p-3 ${disabled ? 'border-slate-200 bg-slate-100' : 'border-white bg-white shadow-sm'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900">Report #{report.report_id}</p>
                  <p className="text-xs text-slate-600">{categoryLabel}</p>
                  {report.distance_meters != null && <p className="text-xs text-slate-500">{Math.round(report.distance_meters)} m away</p>}
                </div>
                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700">{report.status}</span>
              </div>
              {report.disabled_reason && <p className="mt-2 text-xs font-medium text-amber-700">{report.disabled_reason}</p>}
              {selected && <p className="mt-2 text-xs font-medium text-green-700">Selected for this operation</p>}
              {!disabled && mode === 'link' && onLink && (
                <button type="button" aria-label={`Link report ${report.report_id}`} onClick={() => onLink(report.report_id)} className="mt-3 rounded-md px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: '#1A3263' }}>
                  Link report
                </button>
              )}
              {!disabled && mode === 'select' && onSelect && (
                <button type="button" aria-label={`Select report ${report.report_id}`} onClick={() => onSelect(report)} className="mt-3 rounded-md px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: '#1A3263' }}>
                  Select report
                </button>
              )}
            </article>
          );
        })}
      </div>
      {!loading && !error && reports.length > safePageSize && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2 text-xs text-slate-600">
          <button
            type="button"
            aria-label="Previous civilian report results page"
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            disabled={currentPage === 0}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <span className="font-bold">
            Page {currentPage + 1} of {pageCount}
          </span>
          <button
            type="button"
            aria-label="Next civilian report results page"
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
            disabled={currentPage >= pageCount - 1}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
