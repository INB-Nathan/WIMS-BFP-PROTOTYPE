'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { fetchAnalystIncidentWildlandDetailOfflineAware } from '@/lib/api';
import type { AnalystIncidentWildlandDetailResponse } from '@/lib/api';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { StaleCacheBanner } from '@/components/ui/StaleCacheBanner';

const ANALYST_ROLES = ['NATIONAL_ANALYST', 'SYSTEM_ADMIN'];

function displayValue(value: unknown): string {
  if (value == null || value === '') return 'N/A';
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function FieldRow({ label, value }: { label: string; value: unknown }) {
  const rendered = displayValue(value);
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-gray-100 py-3 text-sm last:border-0 md:grid-cols-3 md:gap-4">
      <dt className="font-medium text-gray-500">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-gray-900 md:col-span-2">{rendered}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-header">{title}</div>
      <dl className="card-body">{children}</dl>
    </section>
  );
}

export default function AnalystWildlandDetailPage() {
  const router = useRouter();
  const params = useParams();
  const rawId = params?.id as string | undefined;
  const incidentId = rawId != null ? parseInt(rawId, 10) : NaN;
  const { user, loading: authLoading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;
  const canAccess = ANALYST_ROLES.includes(role ?? '');

  const networkStatus = useNetworkStatus();
  const [detail, setDetail] = useState<AnalystIncidentWildlandDetailResponse | null>(null);
  const [cachedAt, setCachedAt] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailableOffline, setUnavailableOffline] = useState(false);

  useEffect(() => {
    if (!authLoading && role && !canAccess) {
      router.replace('/dashboard');
    }
  }, [authLoading, canAccess, role, router]);

  const load = useCallback(async () => {
    if (Number.isNaN(incidentId)) {
      setError('Invalid incident id.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setUnavailableOffline(false);
    try {
      const result = await fetchAnalystIncidentWildlandDetailOfflineAware(incidentId);
      setDetail(result.response);
      setCachedAt(result.fromCache ? result.cachedAt : undefined);
    } catch (e) {
      setDetail(null);
      setCachedAt(undefined);
      const message = e instanceof Error ? e.message : 'Failed to load wildland AFOR.';
      if (!networkStatus.isOnline) {
        setUnavailableOffline(true);
        setError(null);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [incidentId, networkStatus.isOnline]);

  useEffect(() => {
    if (authLoading || !canAccess) return;
    void load();
  }, [authLoading, canAccess, load]);

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        <RefreshCw className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (role && !canAccess) {
    return <div className="text-sm text-gray-500">Redirecting...</div>;
  }

  if (error || unavailableOffline || !detail) {
    return (
      <div className="space-y-4">
        <Link href={`/dashboard/analyst/incidents/${incidentId}`} className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />
          Back to incident detail
        </Link>
        {unavailableOffline ? (
          <div
            data-testid="wildland-offline-unavailable"
            className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            role="status"
          >
            <p className="font-medium">Wildland AFOR unavailable offline.</p>
            <p className="mt-1 text-amber-700">
              Reconnect to the network to load this wildland AFOR. Previously viewed
              details will appear here automatically once you go online.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error || 'Wildland AFOR not found.'}
          </div>
        )}
      </div>
    );
  }

  const wildland = detail.wildland;

  return (
    <div className="space-y-6">
      <StaleCacheBanner
        freshness={cachedAt ? { cachedAt, isOnline: networkStatus.isOnline } : undefined}
      />
      <div>
        <Link href={`/dashboard/analyst/incidents/${detail.incident_id}`} className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />
          Back to incident detail
        </Link>
        <h1 className="font-mono text-2xl font-bold text-gray-900">
          {detail.reference_number || `Incident #${detail.incident_id}`} Wildland AFOR
        </h1>
        <p className="mt-1 text-sm text-gray-500">Read-only wildland fire detail for national analytics review.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Response Details">
          <FieldRow label="Source" value={wildland.source} />
          <FieldRow label="External Reference" value={wildland.external_reference} />
          <FieldRow label="Call Received At" value={wildland.call_received_at} />
          <FieldRow label="Fire Started At" value={wildland.fire_started_at} />
          <FieldRow label="Fire Arrival At" value={wildland.fire_arrival_at} />
          <FieldRow label="Fire Controlled At" value={wildland.fire_controlled_at} />
          <FieldRow label="Caller Transmitted By" value={wildland.caller_transmitted_by} />
          <FieldRow label="Received By Personnel" value={wildland.call_received_by_personnel} />
          <FieldRow label="Engine Dispatched" value={wildland.engine_dispatched} />
        </Section>

        <Section title="Location And Action">
          <FieldRow label="Caller Office Address" value={wildland.caller_office_address} />
          <FieldRow label="Incident Location" value={wildland.incident_location_description} />
          <FieldRow label="Distance To Fire Station" value={wildland.distance_to_fire_station_km} />
          <FieldRow label="Primary Action Taken" value={wildland.primary_action_taken} />
          <FieldRow label="Assistance Summary" value={wildland.assistance_combined_summary} />
        </Section>

        <Section title="Property And Area">
          <FieldRow label="Buildings Involved" value={wildland.buildings_involved} />
          <FieldRow label="Buildings Threatened" value={wildland.buildings_threatened} />
          <FieldRow label="Ownership And Property Notes" value={wildland.ownership_and_property_notes} />
          <FieldRow label="Total Area Burned" value={wildland.total_area_burned_display} />
          <FieldRow label="Area Burned (Hectares)" value={wildland.total_area_burned_hectares} />
          <FieldRow label="Wildland Fire Type" value={wildland.wildland_fire_type} />
        </Section>

        <Section title="Wildland Factors">
          <FieldRow label="Area Type" value={wildland.area_type_summary} />
          <FieldRow label="Causes And Ignition" value={wildland.causes_and_ignition_factors} />
          <FieldRow label="Suppression Factors" value={wildland.suppression_factors} />
          <FieldRow label="Weather" value={wildland.weather} />
          <FieldRow label="Fire Behavior" value={wildland.fire_behavior} />
          <FieldRow label="Peso Losses" value={wildland.peso_losses} />
          <FieldRow label="Casualties" value={wildland.casualties} />
        </Section>

        <Section title="Narrative And Closure">
          <FieldRow label="Narration" value={wildland.narration} />
          <FieldRow label="Problems Encountered" value={wildland.problems_encountered} />
          <FieldRow label="Recommendations" value={wildland.recommendations} />
          <FieldRow label="Prepared By" value={wildland.prepared_by} />
          <FieldRow label="Prepared By Title" value={wildland.prepared_by_title} />
          <FieldRow label="Noted By" value={wildland.noted_by} />
          <FieldRow label="Noted By Title" value={wildland.noted_by_title} />
        </Section>

        <Section title="Record Metadata">
          <FieldRow label="Wildland AFOR ID" value={wildland.incident_wildland_afor_id} />
          <FieldRow label="Import Batch ID" value={wildland.import_batch_id} />
          <FieldRow label="Created At" value={wildland.created_at} />
          <FieldRow label="Updated At" value={wildland.updated_at} />
        </Section>
      </div>

      <section className="card">
        <div className="card-header">Alarm Status Timeline</div>
        <div className="card-body p-0">
          <div className="overflow-x-auto">
            <table className="min-w-[640px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600">Order</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600">Alarm Status</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600">Time Declared</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600">Ground Commander</th>
                </tr>
              </thead>
              <tbody>
                {detail.alarm_statuses.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">No alarm status rows.</td></tr>
                ) : detail.alarm_statuses.map((row) => (
                  <tr key={`${row.sort_order}-${row.alarm_status}`} className="border-b border-gray-100">
                    <td className="px-3 py-2">{row.sort_order}</td>
                    <td className="px-3 py-2">{row.alarm_status}</td>
                    <td className="px-3 py-2">{row.time_declared || 'N/A'}</td>
                    <td className="px-3 py-2">{row.ground_commander || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">Assistance</div>
        <div className="card-body p-0">
          <div className="overflow-x-auto">
            <table className="min-w-[640px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600">Order</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600">Organization Or Unit</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600">Detail</th>
                </tr>
              </thead>
              <tbody>
                {detail.assistance_rows.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-500">No assistance rows.</td></tr>
                ) : detail.assistance_rows.map((row) => (
                  <tr key={`${row.sort_order}-${row.organization_or_unit}`} className="border-b border-gray-100">
                    <td className="px-3 py-2">{row.sort_order}</td>
                    <td className="px-3 py-2">{row.organization_or_unit}</td>
                    <td className="px-3 py-2">{row.detail || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
