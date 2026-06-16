'use client';

import React, { useMemo, useState } from 'react';
import type { Region } from '@/types/api';
import { Code2, Filter } from 'lucide-react';

export interface FilterBuilderFilters {
  region_id?: number | null;
  severity?: string;
  start_date?: string;
  end_date?: string;
  incident_type?: string;
  [key: string]: unknown;
}

export interface FilterBuilderErrors {
  region_id?: string;
  severity?: string;
  start_date?: string;
  end_date?: string;
  incident_type?: string;
  _json?: string;
}

interface ReportFilterBuilderProps {
  /** Current structured filters object */
  filters: Record<string, unknown>;
  /** Called whenever filters change (always a structured object) */
  onChange: (filters: Record<string, unknown>) => void;
  /** Available regions for dropdown */
  regions?: Region[];
  /** Per-field inline error messages */
  errors?: FilterBuilderErrors;
}

const VALID_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * Helper: serialise filters to a JSON string for the expert textarea.
 * Returns pretty-printed JSON or '{}' on error.
 */
function filtersToJson(filters: Record<string, unknown>): string {
  try {
    return JSON.stringify(filters, null, 2);
  } catch {
    return '{}';
  }
}

/**
 * Extract a typed partial from the filters object.
 */
function extractBuilderFilters(filters: Record<string, unknown>): FilterBuilderFilters {
  return {
    region_id: typeof filters.region_id === 'number' ? filters.region_id : (filters.region_id ? undefined : undefined),
    severity: typeof filters.severity === 'string' ? filters.severity : undefined,
    start_date: typeof filters.start_date === 'string' ? filters.start_date : undefined,
    end_date: typeof filters.end_date === 'string' ? filters.end_date : undefined,
    incident_type: typeof filters.incident_type === 'string' ? filters.incident_type : undefined,
    // Passthrough any extra keys
    ...Object.fromEntries(
      Object.entries(filters).filter(([k]) => !['region_id', 'severity', 'start_date', 'end_date', 'incident_type'].includes(k))
    ),
  };
}

export default function ReportFilterBuilder({
  filters,
  onChange,
  regions,
  errors,
}: ReportFilterBuilderProps) {
  const [expertMode, setExpertMode] = useState(false);
  const [expertJson, setExpertJson] = useState(() => filtersToJson(filters));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const builder = useMemo(() => extractBuilderFilters(filters), [filters]);

  const updateField = (field: keyof FilterBuilderFilters, value: unknown) => {
    const next: Record<string, unknown> = { ...filters };
    if (value === '' || value === undefined || value === null) {
      delete next[field];
    } else {
      next[field] = value;
    }
    onChange(next);
  };

  const handleToggleExpertMode = () => {
    if (expertMode) {
      // Switching back to builder — validate and parse JSON
      const trimmed = expertJson.trim();
      if (!trimmed) {
        // Empty JSON → use empty object
        setExpertMode(false);
        onChange({});
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setJsonError('Filters must be a JSON object (e.g. {"region_id": 1}), not an array or primitive.');
          return;
        }
        setJsonError(null);
        setExpertMode(false);
        onChange(parsed as Record<string, unknown>);
      } catch {
        setJsonError('Invalid JSON. Please fix syntax errors before switching back.');
        return;
      }
    } else {
      // Switching to expert mode — serialise current filters
      setExpertJson(filtersToJson(filters));
      setJsonError(null);
      setExpertMode(true);
    }
  };

  const handleExpertJsonChange = (val: string) => {
    setExpertJson(val);
    // Live validation feedback while typing
    const trimmed = val.trim();
    if (!trimmed) {
      setJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setJsonError('Must be a JSON object (not array or primitive).');
      } else {
        setJsonError(null);
      }
    } catch {
      setJsonError('Invalid JSON.');
    }
  };

  // In expert mode, call onChange with parsed JSON when it's valid
  const handleExpertBlur = () => {
    const trimmed = expertJson.trim();
    if (!trimmed) {
      onChange({});
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        onChange(parsed as Record<string, unknown>);
      }
    } catch {
      // Invalid — do not update structured filters
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Filters
        </label>
        <button
          type="button"
          onClick={handleToggleExpertMode}
          className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded transition-colors ${
            expertMode
              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {expertMode ? (
            <>
              <Filter className="w-3 h-3" /> Builder
            </>
          ) : (
            <>
              <Code2 className="w-3 h-3" /> Expert
            </>
          )}
        </button>
      </div>

      {expertMode ? (
        /* Expert Mode — raw JSON textarea */
        <div>
          <textarea
            value={expertJson}
            onChange={(e) => handleExpertJsonChange(e.target.value)}
            onBlur={handleExpertBlur}
            placeholder='{"region_id": 1, "severity": "HIGH"}'
            rows={4}
            className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 ${
              jsonError || errors?._json
                ? 'border-red-400 focus:ring-red-300'
                : 'border-gray-300 focus:ring-gray-300'
            }`}
            aria-label="Filters raw JSON"
          />
          {jsonError && (
            <p className="text-xs text-red-600 mt-1">{jsonError}</p>
          )}
          {errors?._json && (
            <p className="text-xs text-red-600 mt-1">{errors._json}</p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            Edit filters as raw JSON. Switch back to Builder to use the form controls.
          </p>
        </div>
      ) : (
        /* Builder Mode — structured form fields */
        <div className="space-y-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
          {/* Region */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Region
              {errors?.region_id && (
                <span className="text-red-500 ml-2">{errors.region_id}</span>
              )}
            </label>
            <select
              value={builder.region_id ?? ''}
              onChange={(e) =>
                updateField(
                  'region_id',
                  e.target.value ? parseInt(e.target.value, 10) : undefined
                )
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              aria-label="Filter by region"
            >
              <option value="">All Regions</option>
              {regions?.map((r) => (
                <option key={r.region_id} value={r.region_id}>
                  {r.region_name}
                </option>
              ))}
            </select>
          </div>

          {/* Severity */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Severity
              {errors?.severity && (
                <span className="text-red-500 ml-2">{errors.severity}</span>
              )}
            </label>
            <select
              value={builder.severity ?? ''}
              onChange={(e) =>
                updateField('severity', e.target.value || undefined)
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              aria-label="Filter by severity"
            >
              <option value="">All Severities</option>
              {VALID_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Incident Type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Incident Type
              {errors?.incident_type && (
                <span className="text-red-500 ml-2">{errors.incident_type}</span>
              )}
            </label>
            <input
              type="text"
              value={builder.incident_type ?? ''}
              onChange={(e) =>
                updateField(
                  'incident_type',
                  e.target.value.trim() || undefined
                )
              }
              placeholder="e.g. STRUCTURAL, WILDLAND"
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              aria-label="Filter by incident type"
            />
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Start Date
                {errors?.start_date && (
                  <span className="text-red-500 ml-2">{errors.start_date}</span>
                )}
              </label>
              <input
                type="date"
                value={builder.start_date ?? ''}
                onChange={(e) =>
                  updateField('start_date', e.target.value || undefined)
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                aria-label="Filter start date"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                End Date
                {errors?.end_date && (
                  <span className="text-red-500 ml-2">{errors.end_date}</span>
                )}
              </label>
              <input
                type="date"
                value={builder.end_date ?? ''}
                onChange={(e) =>
                  updateField('end_date', e.target.value || undefined)
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                aria-label="Filter end date"
              />
            </div>
          </div>
          {builder.start_date && builder.end_date && builder.start_date > builder.end_date && (
            <p className="text-xs text-red-600">End date must be on or after start date.</p>
          )}
        </div>
      )}

      {/* Show a summary of applied filters when in builder mode */}
      {!expertMode && Object.keys(filters).length > 0 && (
        <p className="text-xs text-gray-400">
          {Object.keys(filters).length} filter{Object.keys(filters).length !== 1 ? 's' : ''} applied:{' '}
          {Object.entries(filters)
            .map(([k, v]) => {
              if (k === 'region_id' && regions) {
                const region = regions.find((r) => r.region_id === v);
                return `Region=${region?.region_name ?? v}`;
              }
              return `${k}=${v}`;
            })
            .join(', ')}
        </p>
      )}
    </div>
  );
}
