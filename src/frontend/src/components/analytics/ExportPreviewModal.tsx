'use client';

import { useState } from 'react';
import { Download, X, FileText, FileSpreadsheet, File } from 'lucide-react';
import { queueAnalyticsExport, downloadAnalyticsExport } from '@/lib/api';

export type ExportFormat = 'csv' | 'pdf' | 'excel';

const ALL_COLUMNS = [
  'incident_id',
  'notification_dt',
  'region_name',
  'region_id',
  'province_name',
  'municipality_name',
  'general_category',
  'sub_category',
  'alarm_level',
  'estimated_damage_php',
  'total_response_time_minutes',
  'civilian_injured',
  'civilian_deaths',
  'firefighter_injured',
  'firefighter_deaths',
  'verification_status',
  'created_at',
  'fire_origin',
  'extent_of_damage',
  'structures_affected',
  'households_affected',
  'families_affected',
  'individuals_affected',
  'vehicles_affected',
  'total_gas_consumed_liters',
  'extent_total_floor_area_sqm',
  'extent_total_land_area_hectares',
  'fire_station_name',
];

const COLUMN_LABELS: Record<string, string> = {
  incident_id: 'Incident ID',
  notification_dt: 'Notification Date/Time',
  region_name: 'Region',
  region_id: 'Region ID',
  province_name: 'Province',
  municipality_name: 'Municipality',
  barangay_name: 'Barangay',
  general_category: 'Category',
  sub_category: 'Sub Category',
  alarm_level: 'Alarm Level',
  estimated_damage_php: 'Est. Damage (PHP)',
  total_response_time_minutes: 'Response Time (min)',
  civilian_injured: 'Civilian Injured',
  civilian_deaths: 'Civilian Deaths',
  firefighter_injured: 'Firefighter Injured',
  firefighter_deaths: 'Firefighter Deaths',
  created_at: 'Created At',
  fire_origin: 'Fire Origin',
  extent_of_damage: 'Extent of Damage',
  structures_affected: 'Structures Affected',
  households_affected: 'Households Affected',
  families_affected: 'Families Affected',
  individuals_affected: 'Individuals Affected',
  vehicles_affected: 'Vehicles Affected',
  total_gas_consumed_liters: 'Gas Consumed (L)',
  extent_total_floor_area_sqm: 'Floor Area (sqm)',
  extent_total_land_area_hectares: 'Land Area (ha)',
  fire_station_name: 'Fire Station',
  verification_status: 'Status',
};

export const DEFAULT_SELECTED_COLUMNS = [
  'incident_id',
  'notification_dt',
  'region_name',
  'province_name',
  'municipality_name',
  'general_category',
  'alarm_level',
  'estimated_damage_php',
  'total_response_time_minutes',
] as const;

type ExportState = 'idle' | 'queued' | 'polling' | 'downloading' | 'done' | 'error';

interface ExportPreviewModalProps {
  format: ExportFormat;
  filters: Record<string, unknown>;
  filtersSummary: string;
  onClose: () => void;
}

export function ExportPreviewModal({ format, filters, filtersSummary, onClose }: ExportPreviewModalProps) {
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    new Set(DEFAULT_SELECTED_COLUMNS)
  );
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [error, setError] = useState<string | null>(null);

  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  };

  const handleExport = async () => {
    if (selectedColumns.size === 0) {
      setError('Select at least one column.');
      return;
    }
    setError(null);
    setExportState('queued');

    try {
      const { task_id } = await queueAnalyticsExport({
        format,
        filters,
        columns: Array.from(selectedColumns),
      });
      setExportState('polling');

      // Poll until the file is ready (max ~60s)
      const maxAttempts = 30;
      let attempts = 0;
      let blob: Blob | null = null;
      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          blob = await downloadAnalyticsExport(task_id);
          if (blob.size > 0) break;
        } catch {
          // still pending
        }
        attempts++;
      }

      if (!blob || blob.size === 0) {
        setError('Export is taking longer than expected. Check back shortly.');
        setExportState('error');
        return;
      }

      const url = URL.createObjectURL(blob);
      const ext = format === 'excel' ? 'xlsx' : format;
      const fmtName = format === 'excel' ? 'excel' : format;
      const { start_date, end_date } = filters as Record<string, string | undefined>;
      const datePart = start_date && end_date
        ? `${start_date.replace(/-/g, '')}-${end_date.replace(/-/g, '')}`
        : 'all-dates';
      const filename = `wims-bfp-${fmtName}-${datePart}.${ext}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed. Please try again.');
      setExportState('error');
    }
  };

  const formatLabel =
    format === 'excel' ? 'Excel (.xlsx)' : format === 'csv' ? 'CSV (.csv)' : 'PDF (.pdf)';
  const FormatIcon = format === 'pdf' ? FileText : format === 'excel' ? FileSpreadsheet : File;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <FormatIcon className="h-5 w-5 text-gray-600" />
            <h2 className="font-semibold text-gray-900">Export {formatLabel}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={exportState === 'polling' || exportState === 'queued'}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Active filters summary */}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Active Filters</p>
            <p className="text-sm text-gray-700">{filtersSummary || 'No filters applied (all data)'}</p>
          </div>

          {/* Column selection */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Columns to Include ({selectedColumns.size}/{ALL_COLUMNS.length})
            </p>
            <div className="max-h-52 overflow-y-auto rounded border border-gray-200 p-2 space-y-1">
              {ALL_COLUMNS.map((col) => (
                <label key={col} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedColumns.has(col)}
                    onChange={() => toggleColumn(col)}
                    className="h-4 w-4 rounded border-gray-300 text-red-700 focus:ring-red-600"
                  />
                  <span className="text-sm text-gray-700">{COLUMN_LABELS[col] ?? col}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={exportState === 'polling' || exportState === 'queued'}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportState === 'queued' || exportState === 'polling' || exportState === 'downloading'}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: '#1A3263' }}
          >
            <Download className="h-4 w-4" />
            {exportState === 'idle' && 'Queue Export'}
            {exportState === 'queued' && 'Queuing...'}
            {exportState === 'polling' && 'Preparing file...'}
            {exportState === 'downloading' && 'Downloading...'}
            {exportState === 'done' && 'Downloaded'}
            {exportState === 'error' && 'Retry Export'}
          </button>
        </div>
      </div>
    </div>
  );
}

