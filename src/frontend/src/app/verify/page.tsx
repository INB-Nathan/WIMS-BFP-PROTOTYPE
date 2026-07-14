'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
    <main
      className="verify-page"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'linear-gradient(160deg, #5A1515 0%, #8E1B1B 40%, #C62828 100%)',
      }}
    >
      <div
        className="verify-card"
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--card-bg, #fff)',
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
        }}
      >
        <h1
          style={{
            fontSize: '1.4rem',
            fontWeight: 800,
            color: 'var(--text-primary)',
            marginBottom: 4,
          }}
        >
          Verify Your Email
        </h1>
        <p
          style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 24 }}
        >
          Enter the 6-digit code we emailed you to finish creating your account.
        </p>

        {error && (
          <div
            role="alert"
            data-testid="verify-error"
            style={{
              background: '#FEF2F2',
              color: '#B91C1C',
              border: '1px solid #FECACA',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: '0.82rem',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={labelStyle}>
            <span style={labelStyle}>Email</span>
            <input
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email"
              data-testid="verify-email"
              readOnly
              style={{ ...inputStyle, opacity: 0.85 }}
            />
          </label>

          <label style={labelStyle}>
            <span style={labelStyle}>Verification code</span>
            <input
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
              style={{ ...inputStyle, ...(codeFromUrl ? { opacity: 0.85 } : {}) }}
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            data-testid="verify-submit"
            style={{
              marginTop: 4,
              padding: '14px 24px',
              borderRadius: 8,
              fontSize: '0.9rem',
              fontWeight: 700,
              border: 'none',
              cursor: submitting ? 'not-allowed' : 'pointer',
              background: submitting ? '#9CA3AF' : '#C62828',
              color: '#fff',
            }}
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <p
          style={{
            marginTop: 20,
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
          Didn&apos;t receive the email? Check your spam folder.
        </p>

        <p
          style={{
            marginTop: 12,
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
          <Link
            href="/login"
            style={{ color: '#C62828', fontWeight: 600, textDecoration: 'underline' }}
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyContent />
    </Suspense>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-color, #e5e7eb)',
  fontSize: '0.9rem',
  background: 'var(--card-bg, #fff)',
  color: 'var(--text-primary, #1A1D23)',
};
