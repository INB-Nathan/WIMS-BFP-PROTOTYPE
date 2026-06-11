'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function IncidentsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;
  const assignedRegionId = (user as { assignedRegionId?: number | null })?.assignedRegionId ?? null;

  useEffect(() => {
    if (loading) return;

    if (role === 'REGIONAL_ENCODER') {
      router.replace('/dashboard/regional');
      return;
    }

    if (role === 'NATIONAL_VALIDATOR') {
      router.replace('/dashboard/validator');
      return;
    }

    // Backward compatibility for older role labels still present in some environments.
    if (role === 'ENCODER') {
      router.replace('/dashboard/regional');
      return;
    }

    if (role === 'NATIONAL_VALIDATOR') {
      router.replace('/dashboard/validator');
      return;
    }

    router.replace('/dashboard');
  }, [loading, role, assignedRegionId, router]);

  return (
    <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
      Redirecting to regional incidents...
    </div>
  );
}
