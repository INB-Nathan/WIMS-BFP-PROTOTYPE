'use client';

import '@/styles/public-surface.css';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

/**
 * /incidents — public entry point that routes civilians/staff to the
 * appropriate incidents surface. Staff roles redirect to their dashboards;
 * everyone else lands on the contributor dashboard. Styled within the shared
 * public-surface scope so the brief pre-redirect frame matches the rest of the
 * public surface. Redirect logic and role checks are preserved exactly.
 */
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
    <div className="public-surface ps-has-mesh" data-theme="dark" suppressHydrationWarning>
      <main className="ps-content">
        <div
          className="ps-info-inner"
          style={{ alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}
        >
          <p className="ps-muted" style={{ textAlign: 'center' }} role="status">
            Redirecting to regional incidents…
          </p>
        </div>
      </main>
    </div>
  );
}
