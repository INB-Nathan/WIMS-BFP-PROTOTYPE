'use client';
import { useState, useEffect } from 'react';
import { IncidentForm } from '@/components/IncidentForm';
import { useUserProfile } from '@/lib/auth';
import { useRouter } from 'next/navigation';

export default function AforCreatePage() {
    const { role } = useUserProfile();
    const router = useRouter();
    const [initialData, setInitialData] = useState<any | null>(null);

    useEffect(() => {
        if (role && role !== 'REGIONAL_ENCODER' && role !== 'SYSTEM_ADMIN') {
            router.push('/dashboard');
        }

        // Handle handoff from Import Page
        const stored = sessionStorage.getItem('temp_afor_review');
        if (stored) {
            try {
                setInitialData(JSON.parse(stored));
                // Clear it once caught
                sessionStorage.removeItem('temp_afor_review');
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
                        {initialData ? 'Fixing errors from imported report.' : 'Enter fire operation details manually into the system.'}
                    </p>
                </div>
                {initialData && (
                    <button
                        onClick={() => setInitialData(null)}
                        className="text-sm text-gray-500 hover:text-gray-700 underline"
                    >
                        Start Fresh
                    </button>
                )}
            </div>
            <IncidentForm initialData={initialData} />
        </div>
    );
}
