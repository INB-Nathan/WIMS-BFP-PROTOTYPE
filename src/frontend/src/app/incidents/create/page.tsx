'use client';

import { IncidentForm } from '@/components/IncidentForm';
import { useUserProfile } from '@/lib/auth';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function CreateIncidentPage() {
    const { role, loading } = useUserProfile();
    const router = useRouter();

    useEffect(() => {
        if (!loading && role !== 'ENCODER') {
            router.push('/dashboard');
        }
    }, [role, loading, router]);

    if (loading) return <div>Loading...</div>;
    if (role !== 'ENCODER') return null;

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/dashboard" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                    <ChevronLeft className="w-6 h-6 text-gray-600" />
                </Link>
                <h1 className="text-2xl font-bold text-gray-900">Manual Incident Entry</h1>
            </div>

            <IncidentForm />
        </div>
    );
}
