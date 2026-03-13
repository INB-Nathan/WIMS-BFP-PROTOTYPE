'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SigninState } from 'oidc-client-ts';
import { createUserManager, oidcConfig } from '@/lib/oidc';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const code = searchParams.get('code');
      const stateParam = searchParams.get('state');

      if (!code || !stateParam) {
        setError('Missing code or state in callback');
        router.replace('/login');
        return;
      }

      try {
        const userManager = createUserManager();
        const stateStore = userManager.settings.stateStore;
        const storedStateString = await stateStore.get(stateParam);

        if (!storedStateString) {
          setError('No matching state found');
          router.replace('/login');
          return;
        }

        const state = await SigninState.fromStorageString(storedStateString);
        const code_verifier = state.code_verifier;

        if (!code_verifier) {
          setError('No code verifier in state');
          router.replace('/login');
          return;
        }

        const redirect_uri = oidcConfig.redirect_uri;
        const res = await fetch('/api/auth/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            code_verifier,
            redirect_uri,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || 'Sync failed');
          router.replace('/login');
          return;
        }

        await stateStore.remove(stateParam);
        router.replace('/dashboard');
      } catch (err) {
        console.error('Callback error:', err);
        setError(err instanceof Error ? err.message : 'Callback failed');
        router.replace('/login');
      }
    };

    run();
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-600">Completing sign in...</p>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-600">Loading...</p></div>}>
      <CallbackContent />
    </Suspense>
  );
}
