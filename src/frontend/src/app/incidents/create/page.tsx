'use client';

import { IncidentForm } from '@/components/IncidentForm';
import { useUserProfile } from '@/lib/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FileText } from 'lucide-react';

export default function CreateIncidentPage() {
    const { role, loading } = useUserProfile();
    const router = useRouter();

    useEffect(() => {
        if (!loading && role !== 'ENCODER') {
            router.push('/dashboard');
        }
    }, [role, loading, router]);

    if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading...</div>;
    if (role !== 'ENCODER') return null;

    return (
        <div className="space-y-6">
            <div className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid var(--bfp-maroon)' }}>
                    <FileText className="w-4 h-4" style={{ color: 'var(--bfp-maroon)' }} />
                    <span>Manual Incident Entry</span>
                </div>
                <div className="card-body">
                    <IncidentForm />
                </div>
            </div>
        </div>
    );
}
