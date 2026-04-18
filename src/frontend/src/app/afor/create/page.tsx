'use client';
import { useState, useEffect } from 'react';
import { IncidentForm } from '@/components/IncidentForm';
import { WildlandAforManualForm } from '@/components/WildlandAforManualForm';
import { useUserProfile } from '@/lib/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AforFormKind } from '@/lib/api';

export default function AforCreatePage() {
    const { role } = useUserProfile();
    const router = useRouter();
    const searchParams = useSearchParams();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [initialData, setInitialData] = useState<any | null>(null);
    /** Structural vs wildland when not fixed by import handoff */
    const [formKind, setFormKind] = useState<AforFormKind>('STRUCTURAL_AFOR');
    const cameFromImport = searchParams.get('from') === 'import';

    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect */
        if (role && role !== 'REGIONAL_ENCODER' && role !== 'SYSTEM_ADMIN') {
            router.push('/dashboard');
        }

        const storedKind = sessionStorage.getItem('temp_afor_form_kind') as AforFormKind | null;
        if (storedKind === 'STRUCTURAL_AFOR' || storedKind === 'WILDLAND_AFOR') {
            setFormKind(storedKind);
        }

        const stored = sessionStorage.getItem('temp_afor_review');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setInitialData(parsed);
                if (parsed?._form_kind === 'STRUCTURAL_AFOR' || parsed?._form_kind === 'WILDLAND_AFOR') {
                    setFormKind(parsed._form_kind);
                }
                sessionStorage.removeItem('temp_afor_review');
                sessionStorage.removeItem('temp_afor_form_kind');
            } catch (e) {
                console.error('Failed to parse stored AFOR review data', e);
            }
        }
    }, [role, router]);

    const showToggle = !initialData;

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
                            className="text-sm text-blue-600 hover:text-blue-800 underline"
                        >
                            Back to import
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

            {showToggle && (
                <div className="max-w-4xl mx-auto mb-8">
                    <p className="text-sm font-medium text-gray-700 mb-2">AFOR type</p>
                    <div className="inline-flex rounded-lg border border-gray-200 p-1 bg-gray-50">
                        <button
                            type="button"
                            onClick={() => setFormKind('STRUCTURAL_AFOR')}
                            className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                                formKind === 'STRUCTURAL_AFOR'
                                    ? 'bg-white shadow text-gray-900'
                                    : 'text-gray-500 hover:text-gray-800'
                            }`}
                        >
                            Structural
                        </button>
                        <button
                            type="button"
                            onClick={() => setFormKind('WILDLAND_AFOR')}
                            className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                                formKind === 'WILDLAND_AFOR'
                                    ? 'bg-white shadow text-gray-900'
                                    : 'text-gray-500 hover:text-gray-800'
                            }`}
                        >
                            Wildland
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                        Wildland incidents use the regional wildland workbook; full import is available at{' '}
                        <a href="/afor/import" className="text-blue-600 hover:underline">
                            Regional AFOR Import
                        </a>
                        .
                    </p>
                </div>
            )}

            {formKind === 'STRUCTURAL_AFOR' && (
                <IncidentForm initialData={initialData} />
            )}

            {formKind === 'WILDLAND_AFOR' && (
                <>
                    <p className="max-w-4xl mx-auto mb-4 text-sm text-gray-600">
                        Wildland entries use the same validation as file import. For bulk upload, use{' '}
                        <a href="/afor/import" className="text-blue-600 hover:underline font-medium">
                            Regional AFOR Import
                        </a>
                        {' · '}
                        <a
                            href="/templates/wildland_afor_template.xlsx"
                            download
                            className="text-blue-600 hover:underline font-medium"
                        >
                            Wildland template (.xlsx)
                        </a>
                    </p>
                    <WildlandAforManualForm
                        initialWildland={
                            initialData?.wildland &&
                            typeof initialData.wildland === 'object'
                                ? (initialData.wildland as Record<string, unknown>)
                                : null
                        }
                        showDebugJson={false}
                    />
                </>
            )}
        </div>
    );
}
