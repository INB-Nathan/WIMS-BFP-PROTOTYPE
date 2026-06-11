'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function IncidentDetailPage() {
  const params = useParams();
  const id = parseInt(params.id as string, 10);
  const router = useRouter();
  const { user, loading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;

  useEffect(() => {
    if (loading) return;

    if (role === 'NATIONAL_VALIDATOR') {
      router.replace('/dashboard/validator');
      return;
    }

    if (!Number.isNaN(id)) {
      router.replace(`/dashboard/regional/incidents/${id}`);
      return;
    }

    router.replace('/dashboard/regional');
  }, [loading, id, role, router]);

  return (
    <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
      Redirecting to regional incident details...
    </div>
  );
}
