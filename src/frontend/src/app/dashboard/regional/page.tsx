'use client';

import { Fragment, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Upload, FileDown, CheckCircle, AlertCircle, RefreshCw, X, MapPin, ChevronDown, ChevronUp
} from 'lucide-react';
import { importAforFile, commitAforImport, type AforImportPreviewResponse } from '@/lib/api';
import { MapPicker } from '@/components/MapPicker';
import {
  FIELD_LABELS,
  fieldLabel,
  displayValue,
  ALL_PROBLEM_OPTIONS,
  normalizeProblemLabel,
} from '@/lib/afor-utils';

// ── Types ────────────────────────────────────────────────────────────────────
type PersonnelOnDuty = Record<string, string | { name?: string; contact?: string }>;
type OtherPerson = { name: string; designation: string };

// ── Helpers ──────────────────────────────────────────────────────────────────
function isValidWgs84(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

// ── FIX 4: Narrative rendered as ordered bullet list ─────────────────────────
function NarrativeReport({ text }: { text: string }) {
  const paragraphs = text.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!paragraphs.length) return <span className="text-gray-400 text-sm">N/A</span>;
  return (
    <ol className="list-decimal list-inside space-y-2">
      {paragraphs.map((p, i) => (
        <li key={i} className="text-sm leading-relaxed text-gray-800">{p}</li>
      ))}
    </ol>
  );
}

// ── FIX 5: Personnel on Duty section ─────────────────────────────────────────
function PersonnelSection({ pod, others }: { pod: PersonnelOnDuty; others: OtherPerson[] }) {
  const simpleKeys = ['engine_commander', 'shift_in_charge', 'nozzleman', 'lineman', 'engine_crew', 'driver', 'pump_operator'] as const;
  const complexKeys = ['safety_officer', 'fire_arson_investigator'] as const;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-y-2">
        {simpleKeys.map((k) => {
          const val = pod[k];
          if (val === undefined) return null;
          return (
            <div key={k} className="grid grid-cols-3 gap-2 text-sm border-b border-gray-100 pb-2">
              <span className="font-medium text-gray-600 col-span-1">{FIELD_LABELS[k] ?? k}</span>
              <span className="col-span-2 text-gray-900">{displayValue(typeof val === 'string' ? val : JSON.stringify(val))}</span>
            </div>
          );
        })}
        {complexKeys.map((k) => {
          const val = pod[k];
          if (val === undefined) return null;
          const nameStr = typeof val === 'object' ? (val as { name?: string }).name ?? '' : String(val);
          const contactStr = typeof val === 'object' ? (val as { contact?: string }).contact ?? '' : '';
          return (
            <div key={k} className="grid grid-cols-3 gap-2 text-sm border-b border-gray-100 pb-2">
              <span className="font-medium text-gray-600 col-span-1">{FIELD_LABELS[k] ?? k}</span>
              <span className="col-span-2 text-gray-900">
                {displayValue(nameStr)}
                {contactStr ? <span className="ml-2 text-gray-500">({contactStr})</span> : null}
              </span>
            </div>
          );
        })}
      </div>

      {others.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold text-gray-500 uppercase mb-2">Other Personnel at Scene</p>
          <table className="w-full text-sm border border-gray-200 rounded-md overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 w-1/2">Name</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 w-1/2">Designation / Agency</th>
              </tr>
            </thead>
            <tbody>
              {others.map((p, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-2">{displayValue(p.name)}</td>
                  <td className="px-3 py-2">{displayValue(p.designation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── FIX 6: Problems Encountered grid ─────────────────────────────────────────
function ProblemsGrid({ selected }: { selected: string[] }) {
  const selectedSet = new Set((selected ?? []).map((s) => normalizeProblemLabel(String(s))));
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
      {ALL_PROBLEM_OPTIONS.map((label) => {
        const checked = selectedSet.has(label);
        return (
          <div key={label} className="flex items-center gap-2 py-1">
            {checked
              ? <span className="text-green-600 text-base">✅</span>
              : <span className="text-gray-400 text-base">—</span>}
            <span className={`text-sm ${checked ? 'font-bold text-gray-900' : 'text-gray-400'}`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Data preview expandable panel ────────────────────────────────────────────
function RowDetailPanel({ rowData, formKind }: { rowData: Record<string, unknown>; formKind: string }) {
  const [open, setOpen] = useState(false);

  if (formKind === 'WILDLAND_AFOR') {
    const wl = rowData.wildland as Record<string, unknown> | undefined;
    if (!wl) return null;
    return (
      <div className="px-4 pb-4 whitespace-normal break-words">
        <button onClick={() => setOpen(!open)} className="text-xs text-blue-600 flex items-center gap-1">
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {open ? 'Hide' : 'Show'} wildland details
        </button>
        {open && (
          <div className="mt-3 space-y-2 text-sm whitespace-normal break-words">
            {Object.entries(wl).map(([k, v]) => (
              <div key={k} className="grid grid-cols-1 gap-1 border-b border-gray-100 pb-1 md:grid-cols-3 md:gap-2">
                <span className="font-medium text-gray-600 md:min-w-0">{fieldLabel(k)}</span>
                <span className="text-gray-900 break-words whitespace-pre-wrap md:col-span-2 md:min-w-0">
                  {displayValue(typeof v === 'object' ? JSON.stringify(v) : v)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // STRUCTURAL_AFOR detail panel
  const ns = rowData.incident_nonsensitive_details as Record<string, unknown> | undefined;
  const sens = rowData.incident_sensitive_details as Record<string, unknown> | undefined;
  const pod = (sens?.personnel_on_duty ?? {}) as PersonnelOnDuty;
  const others = (sens?.other_personnel ?? []) as OtherPerson[];
  const narrative = String(sens?.narrative_report ?? '');
  const problems = (ns?.problems_encountered ?? []) as string[];

  return (
    <div className="px-4 pb-4 whitespace-normal break-words">
      <button onClick={() => setOpen(!open)} className="text-xs text-blue-600 flex items-center gap-1">
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {open ? 'Hide' : 'Show'} full record details
      </button>
      {open && (
        <div className="mt-4 space-y-6 whitespace-normal break-words">
          {/* A. Response Details */}
          {ns && (
            <div>
              <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">A. Response Details</h4>
              <div className="grid grid-cols-1 gap-y-2">
                {([
                  'notification_dt', 'fire_station_name', 'responder_type', 'alarm_level',
                  'engine_dispatched', 'time_engine_dispatched', 'time_arrived_at_scene',
                  'total_response_time_minutes', 'distance_to_fire_scene_km',
                  'time_returned_to_base', 'total_gas_consumed_liters',
                ] as const).map((k) => {
                  const v = (ns as Record<string, unknown>)[k];
                  return (
                    <div key={k} className="grid grid-cols-1 gap-1 text-sm border-b border-gray-100 pb-1 whitespace-normal md:grid-cols-3 md:gap-2">
                      <span className="font-medium text-gray-600 md:min-w-0">{FIELD_LABELS[k] ?? k}</span>
                      <span className="text-gray-900 whitespace-normal break-words md:col-span-2 md:min-w-0">{displayValue(v)}</span>
                    </div>
                  );
                })}
                {/* receiver_name lives in sensitive details */}
                <div className="grid grid-cols-1 gap-1 text-sm border-b border-gray-100 pb-1 whitespace-normal md:grid-cols-3 md:gap-2">
                  <span className="font-medium text-gray-600 md:min-w-0">{FIELD_LABELS.receiver_name}</span>
                  <span className="text-gray-900 whitespace-normal break-words md:col-span-2 md:min-w-0">
                    {displayValue((sens as Record<string, unknown> | undefined)?.receiver_name ?? (ns as Record<string, unknown>).receiver_name)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* B. Nature & Classification */}
          {ns && (
            <div>
              <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">B. Nature &amp; Classification</h4>
              <div className="grid grid-cols-1 gap-y-2">
                {([
                  'classification_of_involved', 'type_of_involved_general_category',
                  'general_description_of_involved', 'stage_of_fire_upon_arrival',
                  'fire_origin', 'extent_of_damage',
                  'extent_total_floor_area_sqm', 'extent_total_land_area_hectares',
                  'structures_affected', 'households_affected',
                  'families_affected', 'individuals_affected', 'vehicles_affected',
                ] as const).map((k) => {
                  const v = (ns as Record<string, unknown>)[k];
                  return (
                    <div key={k} className="grid grid-cols-1 gap-1 text-sm border-b border-gray-100 pb-1 whitespace-normal md:grid-cols-3 md:gap-2">
                      <span className="font-medium text-gray-600 md:min-w-0">{FIELD_LABELS[k] ?? k}</span>
                      <span className="text-gray-900 whitespace-normal break-words md:col-span-2 md:min-w-0">{displayValue(v)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* C. Assets & Resources (nested JSONB) */}
          {ns?.resources_deployed && (
            <div>
              <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">C. Assets &amp; Resources</h4>
              <div className="space-y-1 text-sm">
                {Object.entries(ns.resources_deployed as Record<string, unknown>).map(([section, val]) => (
                  <div key={section} className="border-b border-gray-100 pb-1">
                    <span className="font-semibold text-gray-600 capitalize mr-2">{section.replace(/_/g, ' ')}:</span>
                    {typeof val === 'object' && val !== null
                      ? Object.entries(val as Record<string, unknown>).map(([sk, sv]) => (
                          <span key={sk} className="mr-3 text-gray-900">
                            {sk.replace(/_/g, ' ')}: <strong>{displayValue(sv)}</strong>
                          </span>
                        ))
                      : <span className="text-gray-900">{displayValue(val)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Location & Contact (sensitive) */}
          {sens && (
            <div>
              <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Location &amp; Contact</h4>
              <div className="grid grid-cols-1 gap-y-2">
                {(['street_address', 'landmark', 'caller_name', 'caller_number', 'owner_name'] as const).map((k) => (
                  <div key={k} className="grid grid-cols-1 gap-1 text-sm border-b border-gray-100 pb-1 whitespace-normal md:grid-cols-3 md:gap-2">
                    <span className="font-medium text-gray-600 md:min-w-0">{FIELD_LABELS[k]}</span>
                    <span className="text-gray-900 whitespace-normal break-words md:col-span-2 md:min-w-0">{displayValue((sens as Record<string, unknown>)[k])}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Personnel on Duty — FIX 5 */}
          <div>
            <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Personnel on Duty</h4>
            <PersonnelSection pod={pod} others={others} />
          </div>

          {/* Narrative Report — FIX 4 */}
          {narrative && (
            <div>
              <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Narrative Report</h4>
              <NarrativeReport text={narrative} />
            </div>
          )}

          {/* Problems Encountered — FIX 6 */}
          <div>
            <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Problems Encountered</h4>
            <ProblemsGrid selected={problems} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── FIX 9: Geocoding hook ─────────────────────────────────────────────────────
function useGeocoding(address: string, city: string) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);

  useEffect(() => {
    if (!address && !city) return;
    const query = [address, city, 'Philippines'].filter(Boolean).join(', ');
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;

    fetch(url, {
      headers: { 'User-Agent': 'WIMS-BFP/1.0' },
    })
      .then((r) => r.json())
      .then((results: Array<{ lat: string; lon: string }>) => {
        if (results.length > 0) {
          const lat = parseFloat(results[0].lat);
          const lng = parseFloat(results[0].lon);
          if (isValidWgs84(lat, lng)) {
            setCoords({ lat, lng });
            setAutoDetected(true);
          }
        }
      })
      .catch(() => {
        // Geocoding failed silently — user can set manually
      });
  }, [address, city]);

  return { coords, autoDetected };
}

// ── Main page component ──────────────────────────────────────────────────────
export default function AforImportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [previewData, setPreviewData] = useState<AforImportPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewStatusFilter, setPreviewStatusFilter] = useState<'ALL' | 'VALID' | 'INVALID'>('ALL');
  const [previewSearch, setPreviewSearch] = useState('');
  const [commitLatStr, setCommitLatStr] = useState('');
  const [commitLngStr, setCommitLngStr] = useState('');
  const geocodeTriggered = useRef(false);

  const filteredPreviewRows = useMemo(() => {
    if (!previewData) return [];

    const q = previewSearch.trim().toLowerCase();
    return previewData.rows.filter((row) => {
      if (previewStatusFilter !== 'ALL' && row.status !== previewStatusFilter) {
        return false;
      }
      if (!q) return true;

      const ns = (row.data.incident_nonsensitive_details ?? {}) as Record<string, unknown>;
      const haystack = [
        row.data._city_text,
        ns.fire_station_name,
        ns.general_category,
        ns.sub_category,
        ns.alarm_level,
        row.errors.join(' '),
      ]
        .map((v) => String(v ?? '').toLowerCase())
        .join(' ');

      return haystack.includes(q);
    });
  }, [previewData, previewStatusFilter, previewSearch]);

  // FIX 9: extract address + city from first valid row for geocoding
  const firstRow = previewData?.rows.find((r) => r.status === 'VALID');
  const sensData = (firstRow?.data?.incident_sensitive_details ?? {}) as Record<string, unknown>;
  const geocodeAddress = String(sensData.street_address ?? '');
  const geocodeCity = String(firstRow?.data?._city_text ?? '');
  const { coords: geoCoords, autoDetected } = useGeocoding(geocodeAddress, geocodeCity);

  // Pre-fill coordinates once geocoding resolves
  useEffect(() => {
    if (geoCoords && !geocodeTriggered.current && !commitLatStr && !commitLngStr) {
      setCommitLatStr(String(geoCoords.lat));
      setCommitLngStr(String(geoCoords.lng));
      geocodeTriggered.current = true;
    }
  }, [geoCoords, commitLatStr, commitLngStr]);

  useEffect(() => {
    if (searchParams.get('reset') === '1') {
      setFile(null);
      setPreviewData(null);
      setError(null);
      setCommitLatStr('');
      setCommitLngStr('');
      geocodeTriggered.current = false;
    }
  }, [searchParams]);

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const handleFileDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setError(null);
      if (isOffline) return;
      validateAndSetFile(e.dataTransfer.files[0]);
    },
    [isOffline],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (isOffline) return;
    validateAndSetFile(e.target.files?.[0]);
  };

  const validateAndSetFile = (f: File | undefined | null) => {
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'xls') {
      setError('Please upload a valid .csv or .xlsx file.');
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setError(null);
    geocodeTriggered.current = false;
    try {
      const data = await importAforFile(file);
      setPreviewData(data);
      setCommitLatStr('');
      setCommitLngStr('');
    } catch (err: unknown) {
      setError((err as { message?: string }).message || 'Failed to upload and parse the file.');
    } finally {
      setIsUploading(false);
    }
  };

  const commitLat = parseFloat(commitLatStr);
  const commitLng = parseFloat(commitLngStr);
  const requiresLocation = previewData?.requires_location !== false;
  const coordsReady = !requiresLocation || isValidWgs84(commitLat, commitLng);

  const onMapPick = useCallback((lat: number, lng: number) => {
    setCommitLatStr(String(lat));
    setCommitLngStr(String(lng));
  }, []);

  const handleCommit = async () => {
    if (!previewData || previewData.valid_rows === 0) return;
    if (!coordsReady) {
      setError('Please provide a valid map pin (latitude/longitude) before committing.');
      return;
    }
    setIsCommitting(true);
    setError(null);
    const validRows = previewData.rows.filter((r) => r.status === 'VALID').map((r) => r.data);
    try {
      const res = await commitAforImport(validRows, previewData.form_kind, {
        latitude: commitLat,
        longitude: commitLng,
      });
      if (res.status === 'ok') {
        router.push('/dashboard/regional');
      }
    } catch (err: unknown) {
      const errMsg = (err as { message?: string }).message || 'Failed to commit the imported data.';
      if (errMsg.includes('DUPLICATE_INCIDENT')) {
        try {
          const replaceOriginal = window.confirm(
            'Duplicate incident detected. Press OK to Replace Original, or Cancel to Keep Original and skip duplicate rows.',
          );
          const retry = await commitAforImport(validRows, previewData.form_kind, {
            latitude: commitLat,
            longitude: commitLng,
            duplicateStrategy: replaceOriginal ? 'REPLACE_ORIGINAL' : 'KEEP_ORIGINAL',
          });
          if (retry.status === 'ok') {
            if (retry.total_committed === 0) {
              setError('No rows were committed because all valid rows were duplicates and were kept as original.');
              setIsCommitting(false);
              return;
            }
            router.push('/dashboard/regional');
            return;
          }
        } catch (retryErr: unknown) {
          const retryMsg = (retryErr as { message?: string }).message || 'Failed while resolving duplicate incidents.';
          setError(retryMsg);
          setIsCommitting(false);
          return;
        }
      } else {
        setError(errMsg);
      }
      setIsCommitting(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreviewData(null);
    setError(null);
    setPreviewStatusFilter('ALL');
    setPreviewSearch('');
    setCommitLatStr('');
    setCommitLngStr('');
    geocodeTriggered.current = false;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Regional AFOR Import
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Upload tabular AFOR data directly to your regional database.
          </p>
        </div>
        {!previewData && (
          <div className="flex flex-wrap gap-2">
            <a href="/templates/afor_template.xlsx" download className="card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
              <FileDown className="w-4 h-4" /> Structural template (.xlsx)
            </a>
            <a href="/templates/wildland_afor_template.xlsx" download className="card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
              <FileDown className="w-4 h-4" /> Wildland template (.xlsx)
            </a>
          </div>
        )}
      </div>

      {isOffline && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 p-4" style={{ backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444' }}>
            <AlertCircle className="text-red-500 w-5 h-5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-800">You are offline</p>
              <p className="text-xs text-red-600 mt-0.5">AFOR import requires an active internet connection to validate and process data.</p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 p-4" style={{ backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444' }}>
            <AlertCircle className="text-red-500 w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium text-red-800">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {!previewData ? (
        <div className="card p-8">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              isOffline ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:bg-blue-50/50 cursor-pointer'
            }`}
            style={{ borderColor: 'var(--border-color)' }}
            onClick={() => !isOffline && document.getElementById('file-upload')?.click()}
          >
            <input type="file" id="file-upload" className="hidden" accept=".csv, .xlsx, .xls" onChange={handleFileInput} disabled={isOffline || isUploading} />
            <div className="flex justify-center mb-4">
              <div className="p-4 rounded-full bg-blue-50 text-blue-600">
                <Upload className="w-8 h-8" />
              </div>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              {file ? file.name : 'Click to upload or drag and drop'}
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {file ? `${(file.size / 1024).toFixed(1)} KB` : 'Excel (.xlsx) or CSV files up to 10MB'}
            </p>
            {file && !isOffline && (
              <div className="mt-8 flex justify-center gap-3" onClick={(e) => e.stopPropagation()}>
                <button onClick={reset} className="px-4 py-2 text-sm font-medium rounded-md border hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="px-6 py-2 text-sm font-bold text-white rounded-md flex items-center gap-2 transition-colors disabled:opacity-70"
                  style={{ backgroundColor: 'var(--bfp-maroon)' }}
                >
                  {isUploading ? <><RefreshCw className="w-4 h-4 animate-spin" /> Analyzing...</> : 'Analyze File'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-semibold uppercase tracking-wide text-xs" style={{ color: 'var(--text-primary)' }}>
              Detected form
            </span>
            <span
              className="px-2 py-0.5 rounded border text-xs font-semibold"
              style={{
                borderColor: previewData.form_kind === 'WILDLAND_AFOR' ? '#15803d' : '#1d4ed8',
                color: previewData.form_kind === 'WILDLAND_AFOR' ? '#15803d' : '#1d4ed8',
              }}
            >
              {previewData.form_kind === 'WILDLAND_AFOR' ? 'Wildland AFOR' : 'Structural AFOR'}
            </span>
          </div>

          {/* FIX 9: Location picker with geocoding */}
          {requiresLocation && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Incident location (WGS84)
                </p>
                {autoDetected && isValidWgs84(commitLat, commitLng) && (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 border border-green-200 rounded text-xs text-green-700 font-medium">
                    <MapPin className="w-3 h-3" />
                    Location auto-detected — drag to adjust
                  </div>
                )}
              </div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Set latitude and longitude before commit. PostGIS stores POINT(longitude latitude); not GeoJSON [lat, lon].
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Latitude (-90 to 90)</label>
                  <input
                    type="number" step="any" value={commitLatStr}
                    onChange={(e) => setCommitLatStr(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    placeholder="e.g. 14.5547"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Longitude (-180 to 180)</label>
                  <input
                    type="number" step="any" value={commitLngStr}
                    onChange={(e) => setCommitLngStr(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    placeholder="e.g. 121.0244"
                  />
                </div>
              </div>
              <div className="w-full rounded-md overflow-hidden border border-gray-200">
                <MapPicker
                  value={isValidWgs84(commitLat, commitLng) ? { lat: commitLat, lng: commitLng } : null}
                  onChange={onMapPick}
                />
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card p-4 flex items-center justify-between" style={{ borderLeft: '4px solid #3b82f6' }}>
              <div>
                <p className="text-xs uppercase font-bold text-gray-500">Total Rows</p>
                <p className="text-xl font-bold">{previewData.total_rows}</p>
              </div>
              <Upload className="w-6 h-6 text-blue-300" />
            </div>
            <div className="card p-4 flex items-center justify-between" style={{ borderLeft: '4px solid #22c55e' }}>
              <div>
                <p className="text-xs uppercase font-bold text-gray-500">Valid Rows</p>
                <p className="text-xl font-bold text-green-600">{previewData.valid_rows}</p>
              </div>
              <CheckCircle className="w-6 h-6 text-green-300" />
            </div>
            <div className="card p-4 flex items-center justify-between" style={{ borderLeft: '4px solid #ef4444' }}>
              <div>
                <p className="text-xs uppercase font-bold text-gray-500">Errors</p>
                <p className="text-xl font-bold text-red-600">{previewData.invalid_rows}</p>
              </div>
              <AlertCircle className="w-6 h-6 text-red-300" />
            </div>
          </div>

          {/* Data preview table */}
          <div className="card">
            <div className="card-header flex items-center justify-between p-4 border-b">
              <span className="font-bold">Data Preview</span>
              <div className="flex gap-2">
                <button onClick={reset} className="px-4 py-2 text-sm font-medium border rounded-md hover:bg-white transition-colors bg-white">
                  Start Over
                </button>
                <button
                  onClick={handleCommit}
                  disabled={isCommitting || previewData.valid_rows === 0 || !coordsReady}
                  className="px-6 py-2 text-sm font-bold text-white rounded-md flex items-center gap-2 transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--bfp-maroon)' }}
                >
                  {isCommitting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Committing...</> : `Commit ${previewData.valid_rows} Valid Rows`}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b bg-gray-50/60">
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                Row status
                <select
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
                  value={previewStatusFilter}
                  onChange={(e) => setPreviewStatusFilter(e.target.value as 'ALL' | 'VALID' | 'INVALID')}
                >
                  <option value="ALL">All rows</option>
                  <option value="VALID">Valid only</option>
                  <option value="INVALID">Invalid only</option>
                </select>
              </label>
              <label className="flex-1 min-w-[220px] flex flex-col gap-1 text-xs font-medium text-gray-700">
                Search
                <input
                  type="text"
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm bg-white"
                  placeholder="Search city, station, category, alarm level, or errors"
                  value={previewSearch}
                  onChange={(e) => setPreviewSearch(e.target.value)}
                />
              </label>
              <p className="text-xs text-gray-600 pb-1">
                Showing {filteredPreviewRows.length} of {previewData.rows.length}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-gray-50 text-gray-700">
                  <tr>
                    <th className="px-4 py-3 w-10">Status</th>
                    {previewData.form_kind === 'WILDLAND_AFOR' ? (
                      <>
                        <th className="px-4 py-3">Call received</th>
                        <th className="px-4 py-3">Engine</th>
                        <th className="px-4 py-3">Wildland type</th>
                        <th className="px-4 py-3">Primary action</th>
                      </>
                    ) : (
                      <>
                        <th className="px-4 py-3">Date/Time of Notification</th>
                        <th className="px-4 py-3">City / Municipality</th>
                        <th className="px-4 py-3">Classification</th>
                        <th className="px-4 py-3">Highest Alarm Level</th>
                      </>
                    )}
                    <th className="px-4 py-3">Errors (if any)</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPreviewRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                        No rows match the current filter.
                      </td>
                    </tr>
                  ) : filteredPreviewRows.map((row, i) => {
                    const wl = row.data.wildland as Record<string, unknown> | undefined;
                    const callAt =
                      typeof wl?.call_received_at === 'string'
                        ? wl.call_received_at.substring(0, 16)
                        : wl?.call_received_at != null
                          ? String(wl.call_received_at).substring(0, 16)
                          : '—';
                    const ns = row.data.incident_nonsensitive_details as Record<string, unknown> | undefined;
                    return (
                      <Fragment key={`${row.status}-${i}`}>
                        <tr className={`border-b ${row.status === 'INVALID' ? 'bg-red-50/30' : 'hover:bg-gray-50'}`}>
                          <td className="px-4 py-3">
                            {row.status === 'VALID'
                              ? <CheckCircle className="w-4 h-4 text-green-500" />
                              : <AlertCircle className="w-4 h-4 text-red-500" />}
                          </td>
                          {previewData.form_kind === 'WILDLAND_AFOR' ? (
                            <>
                              <td className="px-4 py-3 font-medium">{callAt}</td>
                              <td className="px-4 py-3">{displayValue(wl?.engine_dispatched)}</td>
                              <td className="px-4 py-3">{displayValue(wl?.wildland_fire_type ?? wl?.raw_wildland_fire_type)}</td>
                              <td className="px-4 py-3 max-w-[220px] truncate" title={String(wl?.primary_action_taken ?? '')}>
                                {displayValue(wl?.primary_action_taken)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-3 font-medium">
                                {ns?.notification_dt ? String(ns.notification_dt).substring(0, 16) : <span className="text-red-500">Missing</span>}
                              </td>
                              <td className="px-4 py-3">{displayValue(row.data._city_text) === 'N/A' ? <span className="text-red-500">Missing</span> : displayValue(row.data._city_text)}</td>
                              <td className="px-4 py-3">{displayValue(ns?.general_category)}</td>
                              <td className="px-4 py-3">{displayValue(ns?.alarm_level)}</td>
                            </>
                          )}
                          <td className="px-4 py-3 text-red-600 text-xs truncate max-w-[200px]" title={row.errors.join(', ')}>
                            {row.errors.join(', ')}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => {
                                sessionStorage.setItem('temp_afor_review', JSON.stringify(row.data));
                                sessionStorage.setItem('temp_afor_form_kind', previewData.form_kind);
                                router.push('/afor/create?from=import');
                              }}
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              {row.status === 'INVALID' ? 'Fix Error' : 'Review'}
                            </button>
                          </td>
                        </tr>
                        {/* Expandable detail panel */}
                        <tr className="border-b bg-white whitespace-normal">
                          <td colSpan={7} className="p-0 whitespace-normal">
                            <RowDetailPanel rowData={row.data} formKind={previewData.form_kind} />
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
