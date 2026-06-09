'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import dynamic from 'next/dynamic';
import { getOfflineOp, type OfflineOpDecrypted } from '@/lib/offlineStore';
import type { Incident } from '@/lib/edgeFunctions';

const IncidentForm = dynamic(
  () => import('@/components/IncidentForm').then((m) => m.IncidentForm),
  { ssr: false, loading: () => <div className="py-8 text-center text-gray-500">Loading form…</div> },
);

export default function LocalIncidentPage() {
  const params = useParams();
  const router = useRouter();
  const localId = typeof params?.localId === 'string' ? params.localId : '';

  const [op, setOp] = useState<OfflineOpDecrypted | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!localId) return;
    getOfflineOp(localId)
      .then((found) => {
        if (!found) {
          setOp(null);
          setError('This local incident was not found. It may have already been synced.');
          return;
        }
        if (found.syncStatus === 'synced') {
          setOp(null);
          const sid = found.serverId;
          setError(
            sid
              ? `This incident has been synced. Redirecting to the server record…`
              : 'This incident has already been synced.',
          );
          if (sid) {
            router.replace(`/dashboard/regional/incidents/${sid}`);
          }
          return;
        }
        setOp(found);
      })
      .catch((e: unknown) => {
        setOp(null);
        setError(e instanceof Error ? e.message : 'Failed to load local incident.');
      });
  }, [localId, router]);

  if (!localId || op === undefined) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        {!localId ? 'Invalid URL.' : 'Loading…'}
      </div>
    );
  }

  if (op === null || error) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <Link
          href="/dashboard/regional"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          {error ?? 'Local incident not found.'}
        </div>
      </div>
    );
  }

  const initialData = op.payload as unknown as Incident;

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/regional"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Edit Local Incident
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Saved on this device — will sync when reconnected
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          Pending Sync
        </span>
      </div>

      <IncidentForm
        initialData={initialData}
        offlineLocalId={localId}
        onSaved={() => router.push('/dashboard/regional')}
      />
    </div>
  );
}
