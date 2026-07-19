'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  ApiRequestError,
  fetchPerimeter,
  fetchPerimeterIncidentOptions,
  fetchRegionalIncident,
  type PerimeterIncidentOption,
  type PerimeterResponse,
  type RegionalIncidentDetailResponse,
} from '@/lib/api';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { PH_REGIONS } from '@/lib/ph-regions';

const PerimeterDrawInner = dynamic(() => import('./PerimeterDrawInner'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading perimeter workspace...</div>,
});

const OFFLINE_UNAVAILABLE_MESSAGE =
  'The perimeter workspace is unavailable offline. Reconnect to load the incident and map tiles.';

function formatDate(value: string | null): string {
  if (!value) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

export default function ValidatorPerimeterDrawPage() {
  const { user, loading: authLoading, serverValidated } = useAuth();
  const networkStatus = useNetworkStatus();
  const searchParams = useSearchParams();
  const requestedIncidentId = Number(searchParams.get('incident_id')) || null;
  const [options, setOptions] = useState<PerimeterIncidentOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [incidentId, setIncidentId] = useState<number | null>(null);
  const [incident, setIncident] = useState<RegionalIncidentDetailResponse | null>(null);
  const [perimeter, setPerimeter] = useState<PerimeterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = user?.role === 'NATIONAL_VALIDATOR' || user?.role === 'SYSTEM_ADMIN';
  const selectedOption = useMemo(
    () => options.find((option) => option.incident_id === incidentId) ?? null,
    [incidentId, options],
  );

  useEffect(() => {
    if (!serverValidated || !canEdit || !networkStatus.isOnline) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOptionsLoading(true);
    setError(null);
    fetchPerimeterIncidentOptions()
      .then((loadedOptions) => {
        if (cancelled) return;
        setOptions(loadedOptions);
        if (requestedIncidentId) {
          const requested = loadedOptions.find((option) => option.incident_id === requestedIncidentId);
          if (requested) setIncidentId(requested.incident_id);
          else setError('That incident is not a mapped verified incident backed by civilian reports.');
        } else if (loadedOptions.length === 0) {
          setError('No mapped verified incidents backed by civilian reports are available.');
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setOptions([]);
          setError(requestError instanceof Error ? requestError.message : 'Unable to load incidents.');
        }
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [canEdit, networkStatus.isOnline, requestedIncidentId, serverValidated]);

  useEffect(() => {
    if (!incidentId || !serverValidated || !canEdit) return;
    let cancelled = false;
    // This fetch lifecycle deliberately clears the previous selection before loading the next one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setIncident(null);
    setPerimeter(null);
    Promise.all([
      fetchRegionalIncident(incidentId),
      fetchPerimeter(incidentId).catch((requestError: unknown) => {
        if (requestError instanceof ApiRequestError && requestError.status === 404) return null;
        throw requestError;
      }),
    ])
      .then(([loadedIncident, loadedPerimeter]) => {
        if (cancelled) return;
        if (loadedIncident.verification_status !== 'VERIFIED') {
          setError('Perimeters can only be drawn for verified incidents.');
          return;
        }
        if (loadedIncident.latitude == null || loadedIncident.longitude == null) {
          setError('This verified incident has no mapped location.');
          return;
        }
        setIncident(loadedIncident);
        setPerimeter(loadedPerimeter);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to load incident.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [canEdit, incidentId, serverValidated]);

  function changeIncident(value: string) {
    const nextId = value ? Number(value) : null;
    setIncidentId(nextId);
    setIncident(null);
    setPerimeter(null);
    setError(null);
  }

  if (authLoading) return <div className="p-6 text-sm text-slate-500">Checking access...</div>;
  if (!canEdit) return <div className="p-6 text-sm text-slate-600">Access restricted.</div>;

  const province = typeof incident?.nonsensitive.province_district === 'string'
    ? incident.nonsensitive.province_district
    : 'Province unavailable';
  const region = incident
    ? PH_REGIONS.find((item) => item.regionId === incident.region_id)?.regionName ?? `Region ${incident.region_id}`
    : '';
  const description = incident
    ? (typeof incident.nonsensitive.general_category === 'string' ? incident.nonsensitive.general_category : incident.incident_type_code ?? 'Fire incident')
    : '';

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/dashboard/validator" className="text-sm font-medium text-blue-700 hover:text-blue-900">← Queue</Link>
          <h1 className="text-lg font-bold text-slate-800">Perimeter Drawing</h1>
          <div className="ml-auto flex min-w-72 items-center gap-2">
            <label className="shrink-0 text-xs font-medium text-slate-500" htmlFor="incident-select">Verified incident</label>
            <select
              id="incident-select"
              value={incidentId ?? ''}
              disabled={optionsLoading}
              aria-busy={optionsLoading}
              onChange={(event) => changeIncident(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-100"
            >
              <option value="">{optionsLoading ? 'Loading civilian-report incidents...' : 'Select an incident'}</option>
              {options.map((option) => (
                <option key={option.incident_id} value={option.incident_id}>
                  {option.reference_number ?? `Incident #${option.incident_id}`} · {option.general_category ?? 'Fire'} · {option.location} · {formatDate(option.notification_dt)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {optionsLoading && <span className="sr-only" role="status">Loading civilian-report incidents...</span>}
        {selectedOption && (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600" aria-live="polite">
            <span><strong className="text-slate-700">Incident:</strong> {selectedOption.reference_number ?? `#${selectedOption.incident_id}`}</span>
            <span><strong className="text-slate-700">Location:</strong> {selectedOption.location}</span>
            <span><strong className="text-slate-700">Incident date:</strong> {formatDate(selectedOption.notification_dt)}</span>
            <span><strong className="text-slate-700">Civilian reports applied:</strong> {selectedOption.civilian_report_count} · {formatDate(selectedOption.applied_at)}</span>
          </div>
        )}
      </header>

      {!networkStatus.isOnline ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
          <WifiOff className="h-12 w-12 text-slate-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-slate-600">Perimeter Workspace Unavailable Offline</h2>
          <p className="max-w-sm text-sm text-slate-400">{OFFLINE_UNAVAILABLE_MESSAGE}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500" role="status">Loading verified incident...</div>
      ) : (
        <PerimeterDrawInner
          key={incident?.incident_id ?? 'standalone'}
          incident={incident ? {
            id: incident.incident_id,
            description,
            latitude: incident.latitude as number,
            longitude: incident.longitude as number,
            province,
            region,
          } : null}
          perimeter={perimeter}
          onSaved={setPerimeter}
          error={error}
        />
      )}
    </div>
  );
}
