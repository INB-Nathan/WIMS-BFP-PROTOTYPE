'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, KeyRound, MailCheck, ShieldCheck } from 'lucide-react';

function VerifySentContent() {
  const searchParams = useSearchParams();
  const email = useMemo(() => searchParams.get('email') ?? '', [searchParams]);
  const verifyHref = email ? `/verify?email=${encodeURIComponent(email)}` : '/verify';

  return (
    <section className="ps-has-mesh flex min-h-[calc(100vh-7rem)] items-center justify-center px-4 py-12">
      <div className="ps-card w-full max-w-lg">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--primary-bg)', color: 'var(--primary)' }}>
            <MailCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--primary)' }}>Email verification</p>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Check your inbox</h1>
          </div>
        </div>

        <p className="leading-6" style={{ color: 'var(--text-secondary)' }}>
          {email
            ? 'We sent a verification code to the address below. Open the email, then continue here to confirm your account.'
            : 'We sent a verification code to your email. Open the email, then continue here to confirm your account.'}
        </p>

        {email && (
          <div className="my-6 rounded-[var(--radius)] border px-4 py-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} data-testid="verify-sent-email">
            {email}
          </div>
        )}

        <Link href={verifyHref} className="ps-btn ps-btn-primary w-full justify-center py-3" data-testid="verify-sent-enter-code">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          Enter verification code
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>

        <div className="mt-6 space-y-3 rounded-[var(--radius)] border p-4 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)' }}>
          <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--green-light)' }} aria-hidden="true" />The code confirms that you control this email address.</p>
          <p className="pl-6">Can&apos;t find the email? Check your spam folder before requesting another code.</p>
        </div>

        <p className="mt-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Already verified? <Link href="/login" className="font-semibold" style={{ color: 'var(--primary)' }}>Back to sign in</Link>
        </p>
      </div>
    </section>
  );
}

export default function VerifySentPage() {
  return <Suspense fallback={null}><VerifySentContent /></Suspense>;
}
