'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserManager } from '@/lib/oidc';
import { Loader2 } from 'lucide-react';

function CallbackContent() {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const run = async () => {
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
                    body: JSON.stringify({ access_token: user.access_token }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setError(data.error || 'Sync failed');
                    router.replace('/login');
                    return;
                }
                router.push('/dashboard');
            } catch (err) {
                console.error('Callback error:', err);
                setError(err instanceof Error ? err.message : 'Callback failed');
                router.replace('/login');
            }
        };
        run();
    }, [router]);

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
