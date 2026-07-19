'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { FormEvent, useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { ApiRequestError, fetchPerimeter, fetchRegionalIncident, type PerimeterResponse, type RegionalIncidentDetailResponse } from '@/lib/api';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { PH_REGIONS } from '@/lib/ph-regions';

const PerimeterDrawInner = dynamic(() => import('./PerimeterDrawInner'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading perimeter workspace...</div>,
});

const OFFLINE_UNAVAILABLE_MESSAGE =
  'The perimeter workspace is unavailable offline. Reconnect to load the incident and map tiles.';

export default function ValidatorPerimeterDrawPage() {
  const { user, loading: authLoading, serverValidated } = useAuth();
  const networkStatus = useNetworkStatus();
  const searchParams = useSearchParams();
  const [incidentId, setIncidentId] = useState<number | null>(() => Number(searchParams.get('incident_id')) || null);
  const [incidentInput, setIncidentInput] = useState(searchParams.get('incident_id') ?? '');
  const [incident, setIncident] = useState<RegionalIncidentDetailResponse | null>(null);
  const [perimeter, setPerimeter] = useState<PerimeterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = user?.role === 'NATIONAL_VALIDATOR' || user?.role === 'SYSTEM_ADMIN';

  useEffect(() => {
    if (!incidentId || !serverValidated || !canEdit) return;
    let cancelled = false;
    // This fetch lifecycle deliberately clears the previous selection before loading the next one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
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
          setIncident(null);
          setPerimeter(null);
          setError('Perimeters can only be drawn for verified incidents.');
          return;
        }
        if (loadedIncident.latitude == null || loadedIncident.longitude == null) {
          setIncident(null);
          setPerimeter(null);
          setError('This verified incident has no mapped location.');
          return;
        }
        setIncident(loadedIncident);
        setPerimeter(loadedPerimeter);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setIncident(null);
          setPerimeter(null);
          setError(requestError instanceof Error ? requestError.message : 'Unable to load incident.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [canEdit, incidentId, serverValidated]);

  function selectIncident(event: FormEvent) {
    event.preventDefault();
    const nextId = Number(incidentInput);
    if (!Number.isInteger(nextId) || nextId < 1) {
      setError('Enter a valid verified incident ID.');
      return;
    }
    setIncidentId(nextId);
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
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <Link href="/dashboard/validator" className="text-sm font-medium text-blue-700 hover:text-blue-900">← Queue</Link>
        <h1 className="text-lg font-bold text-slate-800">Perimeter Drawing</h1>
        <form className="ml-auto flex items-center gap-2" onSubmit={selectIncident}>
          <label className="text-xs font-medium text-slate-500" htmlFor="incident-id">Verified incident ID</label>
          <input
            id="incident-id"
            inputMode="numeric"
            min="1"
            value={incidentInput}
            onChange={(event) => setIncidentInput(event.target.value)}
            className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-md bg-[#991B1B] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#7f1d1d]">Load</button>
        </form>
      </header>

      {!networkStatus.isOnline ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
          <WifiOff className="h-12 w-12 text-slate-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-slate-600">Perimeter Workspace Unavailable Offline</h2>
          <p className="max-w-sm text-sm text-slate-400">{OFFLINE_UNAVAILABLE_MESSAGE}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading verified incident...</div>
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
