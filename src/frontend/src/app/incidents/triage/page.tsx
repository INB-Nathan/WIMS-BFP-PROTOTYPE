'use client';

import { useState, useEffect } from 'react';
import { useUserProfile } from '@/lib/auth';
import { fetchPendingReports, promoteReport } from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronLeft, MapPin, Clock, FileText, CheckCircle } from 'lucide-react';

interface PendingReport {
  report_id: number;
  latitude: number;
  longitude: number;
  description: string;
  created_at: string | null;
  status: string;
}

export default function TriagePage() {
  const { role, loading: authLoading } = useUserProfile();
  const router = useRouter();
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [promotingId, setPromotingId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canAccess = role === 'ENCODER' || role === 'VALIDATOR';

  useEffect(() => {
    if (!authLoading && !canAccess) {
      router.push('/dashboard');
    }
  }, [role, authLoading, canAccess, router]);

  useEffect(() => {
    if (canAccess && !authLoading) {
      loadReports();
    }
  }, [canAccess, authLoading]);

  const loadReports = async () => {
    setLoading(true);
    try {
      const data = await fetchPendingReports();
      setReports(data);
    } catch (err) {
      console.error('Failed to load pending reports:', err);
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePromote = async (reportId: number) => {
    setPromotingId(reportId);
    setSuccessMessage(null);
    try {
      await promoteReport(reportId);
      setReports((prev) => prev.filter((r) => r.report_id !== reportId));
      setSuccessMessage('Report promoted to official incident successfully.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error('Promote failed:', err);
      setSuccessMessage(null);
    } finally {
      setPromotingId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="p-8 flex justify-center items-center min-h-[200px]">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (!canAccess) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/incidents"
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Triage Queue</h1>
      </div>

      <p className="text-gray-600 text-sm">
        Review citizen reports and promote verified incidents to the official fire incidents list.
      </p>

      {successMessage && (
        <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
          </div>
        ) : reports.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="font-medium">No pending reports</p>
            <p className="text-sm mt-1">All citizen reports have been triaged.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {reports.map((r) => (
              <div
                key={r.report_id}
                className="p-4 hover:bg-gray-50 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    <p className="text-gray-900 font-medium truncate">{r.description || 'No description'}</p>
                  </div>
                  <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handlePromote(r.report_id)}
                  disabled={promotingId === r.report_id}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {promotingId === r.report_id ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Promoting…
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Promote to Official Incident
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
