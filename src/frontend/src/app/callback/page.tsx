'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserManager } from '@/lib/oidc';
import { useAuth } from '@/context/AuthContext';
import { useUserProfile } from '@/lib/auth';
import { Loader2 } from 'lucide-react';

function CallbackContent() {
    const router = useRouter();
    const { refreshSession } = useAuth();
    const { refreshProfile } = useUserProfile();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Guard against React 18 StrictMode double-invocation of effects.
        // signinCallback() must only run once per callback URL, or the second
        // invocation fails with "No matching state" (state already consumed).
        let didRun = false;

        const run = async () => {
            if (didRun) return;
            didRun = true;
            try {
                const userManager = createUserManager();
                const user = await userManager.signinCallback();
                if (!user?.access_token) {
                    setError('No access token in callback');
                    router.replace('/login');
                    return;
                }
                const res = await fetch('/api/auth/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        access_token: user.access_token,
                        refresh_token: user.refresh_token ?? null,
                    }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setError(data.error || 'Sync failed');
                    router.replace('/login');
                    return;
                }
                // CRITICAL: Refresh BOTH auth providers before navigating.
                // The cookie is now set, but both fetchSession() and fetchProfile()
                // already ran on mount (before the cookie existed). Without this,
                // AuthContext stays null → LayoutShell redirects to Keycloak, and
                // UserProfileProvider stays null → IncidentForm has assignedRegionId=null
                // (region not locked) until the user manually refreshes.
                await Promise.all([refreshSession(), refreshProfile()]);
                router.push('/dashboard');
            } catch (err) {
                console.error('Callback error:', err);
                setError(err instanceof Error ? err.message : 'Callback failed');
                router.replace('/login');
            }
        };
        run();
    }, [router, refreshSession, refreshProfile]);

    return (
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--content-bg)' }}>
            <div className="card p-8 text-center space-y-3">
                {error ? (
                    <p className="text-red-600 text-sm">{error}</p>
                ) : (
                    <>
                        <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: 'var(--bfp-maroon)' }} />
                        <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Completing sign in...</p>
                    </>
                )}
            </div>
        </div>
    );
}

export default function CallbackPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--content-bg)' }}>
                <div className="card p-8 text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: 'var(--bfp-maroon)' }} />
                    <p className="text-sm mt-3" style={{ color: 'var(--text-secondary)' }}>Loading...</p>
                </div>
            </div>
        }>
            <CallbackContent />
        </Suspense>
    );
}
