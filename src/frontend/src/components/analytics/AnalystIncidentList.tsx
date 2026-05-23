'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, ListChecks, X } from 'lucide-react';
import {
  fetchAnalystIncidentList,
  type AnalystIncidentListItem,
  type AnalystIncidentListParams,
  type AnalystListSortField,
  type SortDirection,
} from '@/lib/api';
import {
  createAnalystWorkflowTransferUrl,
  type AnalystWorkflowSlug,
} from '@/lib/analyst-workflow-transfer';

type Column = {
  key: AnalystListSortField;
  label: string;
  align?: 'left' | 'right';
  render: (incident: AnalystIncidentListItem) => ReactNode;
};

function formatDateTime(value: string | null): string {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
}

function formatMoney(value: number | null): string {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMinutes(value: number | null): string {
  if (value == null) return 'N/A';
  return `${Number(value).toFixed(1)} min`;
}

const COLUMNS: Column[] = [
  { key: 'notification_dt', label: 'Notification', render: (i) => formatDateTime(i.notification_dt) },
  { key: 'region', label: 'Region', render: (i) => i.region || 'N/A' },
  { key: 'municipality_name', label: 'Municipality', render: (i) => i.municipality_name || 'N/A' },
  { key: 'barangay_name', label: 'Barangay', render: (i) => i.barangay_name || 'N/A' },
  { key: 'general_category', label: 'Category', render: (i) => i.general_category || 'N/A' },
  { key: 'sub_category', label: 'Sub Category', render: (i) => i.sub_category || 'N/A' },
  { key: 'alarm_level', label: 'Alarm', render: (i) => i.alarm_level || 'N/A' },
  { key: 'estimated_damage_php', label: 'Damage', align: 'right', render: (i) => formatMoney(i.estimated_damage_php) },
  { key: 'total_response_time_minutes', label: 'Response', align: 'right', render: (i) => formatMinutes(i.total_response_time_minutes) },
];

const ANALYZE_WORKFLOWS: Array<{ slug: AnalystWorkflowSlug; label: string }> = [
  { slug: 'incident-explorer', label: 'Incident Explorer' },
  { slug: 'comparative', label: 'Comparative' },
  { slug: 'heatmap', label: 'Heatmap' },
  { slug: 'trends', label: 'Trends' },
  { slug: 'response-time', label: 'Response Time' },
  { slug: 'top-n', label: 'Top-N' },
];

function SortIcon({
  column,
  sortBy,
  sortDir,
}: {
  column: AnalystListSortField;
  sortBy: AnalystListSortField;
  sortDir: SortDirection;
}) {
  if (column !== sortBy) return <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" />;
  return sortDir === 'asc'
    ? <ArrowUp className="h-3.5 w-3.5 text-red-700" />
    : <ArrowDown className="h-3.5 w-3.5 text-red-700" />;
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 border-b border-gray-100 py-2 text-sm last:border-0">
      <dt className="font-medium text-gray-500">{label}</dt>
      <dd className="col-span-2 text-gray-900">{value || 'N/A'}</dd>
    </div>
  );
}

function listErrorMessage(error: unknown): string {
  if (error instanceof Error && /Request failed:\s*500/i.test(error.message)) {
    return 'Incident list is temporarily unavailable. The filters and analytics panels remain usable while the list request is retried.';
  }
  return error instanceof Error ? error.message : 'Failed to load incidents.';
}

interface AnalystIncidentListProps {
  filters: AnalystIncidentListParams;
  pageSize?: number;
  title?: string;
  description?: string;
  prominent?: boolean;
  initialSelectedIncidentIds?: number[];
  onSelectionChange?: (selectedIds: number[]) => void;
}

export function AnalystIncidentList({
  filters,
  pageSize = 25,
  title = 'Incident List',
  description = 'Verified, non-archived incidents matching the active filters.',
  prominent = false,
  initialSelectedIncidentIds,
  onSelectionChange,
}: AnalystIncidentListProps) {
  const router = useRouter();
  const [items, setItems] = useState<AnalystIncidentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<AnalystListSortField>('notification_dt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [selected, setSelected] = useState<AnalystIncidentListItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(initialSelectedIncidentIds ?? []));
  const [targetWorkflow, setTargetWorkflow] = useState<AnalystWorkflowSlug>('incident-explorer');
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<AnalystListSortField>>(
    () => new Set(COLUMNS.map((column) => column.key)),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);
  const initialSelectedKey = JSON.stringify(initialSelectedIncidentIds ?? []);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const selectedCount = selectedIds.size;
  const currentPageIds = useMemo(() => items.map((incident) => incident.incident_id), [items]);
  const allCurrentPageSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.has(id));
  const visibleColumns = useMemo(
    () => COLUMNS.filter((column) => visibleColumnKeys.has(column.key)),
    [visibleColumnKeys],
  );

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set(initialSelectedIncidentIds ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialSelectedKey is the stable dependency for the optional initial selection array
  }, [filterKey, initialSelectedKey]);

  useEffect(() => {
    onSelectionChange?.(Array.from(selectedIds));
  }, [onSelectionChange, selectedIds]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchAnalystIncidentList({
          ...filters,
          page,
          page_size: pageSize,
          sort_by: sortBy,
          sort_dir: sortDir,
        });
        if (cancelled) return;
        setItems(response.incidents);
        setTotal(response.total);
      } catch (e) {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setError(listErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [filterKey, filters, page, pageSize, sortBy, sortDir]);

  const toggleSort = (column: AnalystListSortField) => {
    if (column === sortBy) {
      setSortDir((current) => current === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDir(column === 'notification_dt' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const toggleIncidentSelection = (incidentId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(incidentId)) {
        next.delete(incidentId);
      } else {
        next.add(incidentId);
      }
      return next;
    });
  };

  const toggleCurrentPageSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allCurrentPageSelected) {
        currentPageIds.forEach((id) => next.delete(id));
      } else {
        currentPageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const analyzeSelected = () => {
    if (selectedIds.size === 0) return;
    const url = createAnalystWorkflowTransferUrl(targetWorkflow, {
      filters,
      selectedIncidentIds: Array.from(selectedIds),
    });
    router.push(url);
  };

  const toggleColumnVisibility = (columnKey: AnalystListSortField) => {
    setVisibleColumnKeys((current) => {
      const next = new Set(current);
      if (next.has(columnKey) && next.size > 1) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }
      return next;
    });
  };

  return (
    <section className={`overflow-hidden rounded-md border bg-white shadow-sm ${prominent ? 'border-red-200 ring-1 ring-red-100' : 'border-gray-200'}`} aria-labelledby="incident-list-heading">
      <div className="flex flex-col gap-3 border-b border-gray-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className={`flex shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700 ${prominent ? 'h-11 w-11' : 'h-9 w-9'}`}>
            <ListChecks className={prominent ? 'h-6 w-6' : 'h-5 w-5'} />
          </div>
          <div>
            <h2 id="incident-list-heading" className={prominent ? 'text-lg font-bold text-gray-900' : 'text-base font-bold text-gray-900'}>
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">{description}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
            {total.toLocaleString()} total
          </span>
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
            {selectedCount.toLocaleString()} selected
          </span>
        </div>
      </div>

      <div>
        <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-5 py-3 text-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleCurrentPageSelection}
              disabled={items.length === 0 || loading}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {allCurrentPageSelected ? 'Unselect page' : 'Select page'}
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={selectedCount === 0}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Reset selection
            </button>
            <span className="text-gray-500">Selection persists across pages until filters change.</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <details className="relative">
              <summary className="cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-1.5 font-semibold text-gray-700 hover:bg-gray-100">
                Columns
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-md border border-gray-200 bg-white p-2 shadow-lg">
                {COLUMNS.map((column) => (
                  <div key={column.key} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={visibleColumnKeys.has(column.key)}
                      onChange={() => toggleColumnVisibility(column.key)}
                      className="h-4 w-4 rounded border-gray-300 text-red-700 focus:ring-red-600"
                      aria-label={`Toggle ${column.label === 'Region' ? 'area' : column.label} column`}
                    />
                    <span>{column.label}</span>
                  </div>
                ))}
              </div>
            </details>
            <select
              value={targetWorkflow}
              onChange={(event) => setTargetWorkflow(event.target.value as AnalystWorkflowSlug)}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800"
              aria-label="Workflow for selected incidents"
            >
              {ANALYZE_WORKFLOWS.map((workflow) => (
                <option key={workflow.slug} value={workflow.slug}>{workflow.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={analyzeSelected}
              disabled={selectedCount === 0}
              className="rounded-md px-3 py-1.5 font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--bfp-maroon)' }}
            >
              Analyze selected
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-[1080px] w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="w-12 border-b border-gray-200 px-3 py-2 text-left">
                  <span className="sr-only">Select</span>
                </th>
                {visibleColumns.map((column) => (
                  <th
                    key={column.key}
                    className={`border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase text-gray-600 ${column.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={`inline-flex items-center gap-1 ${column.align === 'right' ? 'justify-end' : 'justify-start'} w-full hover:text-red-700`}
                    >
                      <span>{column.label}</span>
                      <SortIcon column={column.key} sortBy={sortBy} sortDir={sortDir} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={visibleColumns.length + 1} className="px-4 py-8 text-center text-gray-500">
                    Loading verified incidents...
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={visibleColumns.length + 1} className="px-4 py-8 text-center text-gray-500">
                    No verified incidents match the active filters.
                  </td>
                </tr>
              )}
              {!loading && items.map((incident) => (
                <tr
                  key={incident.incident_id}
                  onClick={() => setSelected(incident)}
                  className={`cursor-pointer border-b border-gray-100 hover:bg-red-50/50 ${selectedIds.has(incident.incident_id) ? 'bg-red-50/60' : ''}`}
                >
                  <td className="px-3 py-3 align-top">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(incident.incident_id)}
                      onChange={() => toggleIncidentSelection(incident.incident_id)}
                      onClick={(event) => event.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 text-red-700 focus:ring-red-600"
                      aria-label={`Select incident ${incident.reference_number || incident.incident_id}`}
                    />
                  </td>
                  {visibleColumns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-3 align-top ${column.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      {column.render(incident)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-gray-200 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-gray-500">
            Page {page} of {pageCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              className="rounded-md border border-gray-200 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={page >= pageCount || loading}
              className="rounded-md border border-gray-200 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true">
          <div className="flex h-full w-full max-w-[640px] flex-col bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
              <div>
                <h3 className="font-mono text-lg font-bold text-gray-900">
                  {selected.reference_number || `Incident #${selected.incident_id}`}
                </h3>
                <p className="mt-1 text-sm text-gray-500">{formatDateTime(selected.notification_dt)}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                aria-label="Close incident summary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <dl>
                <SummaryRow label="Region" value={selected.region} />
                <SummaryRow label="Province" value={selected.province_name} />
                <SummaryRow label="Municipality" value={selected.municipality_name} />
                <SummaryRow label="Barangay" value={selected.barangay_name} />
                <SummaryRow label="Category" value={selected.general_category} />
                <SummaryRow label="Sub Category" value={selected.sub_category} />
                <SummaryRow label="Alarm Level" value={selected.alarm_level} />
                <SummaryRow label="Damage" value={formatMoney(selected.estimated_damage_php)} />
                <SummaryRow label="Response Time" value={formatMinutes(selected.total_response_time_minutes)} />
                <SummaryRow label="Status" value={selected.verification_status} />
                <SummaryRow label="Created" value={formatDateTime(selected.created_at)} />
              </dl>
            </div>

            <div className="border-t border-gray-200 px-5 py-4">
              <Link
                href={`/dashboard/analyst/incidents/${selected.incident_id}`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: 'var(--bfp-maroon)' }}
              >
                Open Full Page
                <ExternalLink className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
