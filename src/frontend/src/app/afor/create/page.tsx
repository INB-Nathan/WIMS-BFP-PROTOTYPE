'use client';
import { useState, useEffect, Suspense } from 'react';
import { IncidentForm } from '@/components/IncidentForm';
import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';

function AforCreatePage() {
    const { user } = useAuth();
    const role = (user as { role?: string } | null)?.role ?? null;
    const router = useRouter();
    const searchParams = useSearchParams();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [initialData, setInitialData] = useState<any | null>(null);
    const cameFromImport = searchParams.get('from') === 'import';

    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect */
        if (role && role !== 'REGIONAL_ENCODER' && role !== 'SYSTEM_ADMIN') {
            router.push('/dashboard');
        }

        const stored = sessionStorage.getItem('temp_afor_review');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setInitialData(parsed);
                sessionStorage.removeItem('temp_afor_review');
                sessionStorage.removeItem('temp_afor_form_kind');
            } catch (e) {
                console.error('Failed to parse stored AFOR review data', e);
            }
        }
    }, [role, router]);

    return (
        <div className="p-6">
            <div className="max-w-4xl mx-auto mb-6 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                        {initialData ? 'Correct Imported AFOR' : 'Manual AFOR Entry'}
                    </h1>
                    <p className="text-gray-600">
                        {initialData
                            ? 'Fixing errors from imported report.'
                            : 'Enter fire operation details manually into the system.'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {(initialData || cameFromImport) && (
                        <button
                            onClick={() => router.push('/afor/import?reset=1')}
                            className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:text-gray-900 transition-colors"
                        >
                            ← Back to Import
                        </button>
                    )}
                    {initialData && (
                        <button
                            onClick={() => setInitialData(null)}
                            className="text-sm text-gray-500 hover:text-gray-700 underline"
                        >
                            Start Fresh
                        </button>
                    )}
                </div>
            </div>

            <IncidentForm initialData={initialData} />
        </div>
    );
}

export default function AforCreatePageWrapper() {
    return (
        <Suspense fallback={<div className="p-6 text-gray-500">Loading…</div>}>
            <AforCreatePage />
        </Suspense>
    );
}
