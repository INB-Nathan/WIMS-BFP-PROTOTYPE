'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { verifyCivilianRegistration } from '@/lib/api/civilian';

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get('email') ?? '';
  const codeParam = searchParams.get('code') ?? '';

  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState(codeParam);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const codeFromUrl = useMemo(() => (searchParams.get('code') ?? '') !== '', [searchParams]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    if (!code.trim()) {
      setError('Enter the verification code.');
      return;
    }
    setSubmitting(true);
    try {
      await verifyCivilianRegistration({ email: email.trim(), code: code.trim() });
      router.push('/login?verified=true');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed. Please try again.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="ps-has-mesh flex min-h-[calc(100vh-7rem)] items-center justify-center px-4 py-12">
      <div className="ps-card w-full max-w-lg">
        <div className="mb-6 flex items-start gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'var(--primary-bg)', color: 'var(--primary)' }}
          >
            <KeyRound className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p
              className="mb-1 text-xs font-semibold uppercase tracking-[0.18em]"
              style={{ color: 'var(--primary)' }}
            >
              Email verification
            </p>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Verify Your Email
            </h1>
          </div>
        </div>

        <p className="mb-6 leading-6" style={{ color: 'var(--text-secondary)' }}>
          Enter the 6-digit code we emailed you to finish creating your account.
        </p>

        {error && (
          <div role="alert" className="ps-error-alert" data-testid="verify-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <label className="ps-field" htmlFor="verify-email">
            <span className="ps-label">Email</span>
            <input
              id="verify-email"
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email"
              data-testid="verify-email"
              readOnly
              className="ps-input opacity-[0.85]"
            />
          </label>

          <label className="ps-field" htmlFor="verify-code">
            <span className="ps-label">Verification code</span>
            <input
              id="verify-code"
              type="text"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              aria-label="Verification code"
              data-testid="verify-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              readOnly={codeFromUrl}
              className={`ps-input ${codeFromUrl ? 'opacity-[0.85]' : ''}`}
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            data-testid="verify-submit"
            className="ps-btn ps-btn-auth w-full"
          >
            {submitting ? 'Verifying…' : 'Verify email'}
          </button>
        </form>

        <div
          className="mt-6 rounded-[var(--radius)] border p-4 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)' }}
        >
          <p className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--green-light)' }} aria-hidden="true" />
            Didn&apos;t receive the email? Check your spam folder.
          </p>
        </div>

        <p className="mt-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Already verified?{' '}
          <Link href="/login" className="font-semibold" style={{ color: 'var(--primary)' }}>
            Back to sign in
          </Link>
        </p>
      </div>
    </section>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyContent />
    </Suspense>
  );
}
