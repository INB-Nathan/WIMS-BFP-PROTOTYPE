'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function VerifySentContent() {
  const searchParams = useSearchParams();
  const email = useMemo(() => searchParams.get('email') ?? '', [searchParams]);
  const encodedEmail = useMemo(() => encodeURIComponent(email), [email]);

  return (
    <main
      className="verify-sent-page"
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
        className="verify-sent-card"
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
          Check Your Email
        </h1>
        <p
          style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 24 }}
        >
          {email
            ? `We sent a verification code to ${email}. Please check your inbox and click the link or enter the code below.`
            : 'We sent a verification code to your email. Please check your inbox and click the link or enter the code below.'}
        </p>

        {email && (
          <div
            data-testid="verify-sent-email"
            style={{
              background: '#F9FAFB',
              border: '1px solid #E5E7EB',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: '0.85rem',
              color: 'var(--text-primary)',
              marginBottom: 16,
              wordBreak: 'break-all',
            }}
          >
            {email}
          </div>
        )}

        <Link
          href={email ? `/verify?email=${encodedEmail}` : '/verify'}
          data-testid="verify-sent-enter-code"
          style={{
            display: 'block',
            textAlign: 'center',
            marginTop: 4,
            padding: '14px 24px',
            borderRadius: 8,
            fontSize: '0.9rem',
            fontWeight: 700,
            textDecoration: 'none',
            background: '#C62828',
            color: '#fff',
          }}
        >
          Enter code manually
        </Link>

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

export default function VerifySentPage() {
  return (
    <Suspense fallback={null}>
      <VerifySentContent />
    </Suspense>
  );
}
