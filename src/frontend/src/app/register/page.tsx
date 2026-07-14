'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Turnstile } from '@marsidev/react-turnstile';
import { registerCivilian } from '@/lib/api/civilian';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_RE = /^09\d{9}$/;

interface PasswordChecks {
  minLength: boolean;   // >= 12
  upperCase: boolean;
  lowerCase: boolean;
  digit: boolean;
  specialChar: boolean;
}

function checkPassword(password: string): PasswordChecks {
  return {
    minLength: password.length >= 12,
    upperCase: /[A-Z]/.test(password),
    lowerCase: /[a-z]/.test(password),
    digit: /\d/.test(password),
    specialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };
}

function passwordValid(checks: PasswordChecks): boolean {
  return Object.values(checks).every(Boolean);
}

function validate(values: {
  email: string;
  password: string;
  confirmPassword: string;
  contact_number: string;
  dpa_consent: boolean;
}): string[] {
  const errors: string[] = [];
  if (!EMAIL_RE.test(values.email)) {
    errors.push('Enter a valid email address.');
  }
  const pw = checkPassword(values.password);
  if (!passwordValid(pw)) {
    errors.push('Password does not meet all requirements.');
  }
  if (values.password !== values.confirmPassword) {
    errors.push('Passwords do not match.');
  }
  if (!CONTACT_RE.test(values.contact_number)) {
    errors.push('Enter a valid Philippine mobile number starting with 09 (11 digits).');
  }
  if (!values.dpa_consent) {
    errors.push('You must agree to the Data Privacy Act consent to register.');
  }
  return errors;
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [dpaConsent, setDpaConsent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileExpired, setTurnstileExpired] = useState(false);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const turnstileEnabled = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '') !== '';
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

  const onTurnstileSuccess = useCallback((token: string) => {
    setTurnstileToken(token);
    setTurnstileExpired(false);
  }, []);

  const onTurnstileExpire = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileExpired(true);
    setTurnstileResetKey((k) => k + 1);
  }, []);

  const onTurnstileError = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileResetKey((k) => k + 1);
    setErrors((prev) => {
      if (!prev.includes('Security check failed. Please refresh the page and try again.')) {
        return [...prev, 'Security check failed. Please refresh the page and try again.'];
      }
      return prev;
    });
  }, []);

  const pwChecks = useMemo(() => checkPassword(password), [password]);
  const showPwRequirements = password.length > 0 && !passwordValid(pwChecks);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validationErrors = validate({
      email,
      password,
      confirmPassword,
      contact_number: contactNumber,
      dpa_consent: dpaConsent,
    });
    if (turnstileEnabled && !turnstileToken) {
      validationErrors.push(
        turnstileExpired
          ? 'Security check expired. Please complete it again.'
          : 'Please complete the security check.',
      );
    }
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors([]);
    setSubmitting(true);
    try {
      await registerCivilian({
        email,
        first_name: firstName,
        last_name: lastName,
        password,
        contact_number: contactNumber,
        dpa_consent: dpaConsent,
        turnstile_token: turnstileToken || '',
      });
      router.push(`/verify-sent?email=${encodeURIComponent(email)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      // Turnstile tokens are single-use — consumed by this attempt regardless
      // of outcome. Reset so the user gets a fresh token for the next try.
      setTurnstileToken(null);
      setTurnstileExpired(true);
      setTurnstileResetKey((k) => k + 1);
      if (msg.toLowerCase().includes('captcha')) {
        setErrors(['Security check failed. Please complete the CAPTCHA again.']);
      } else {
        setErrors([msg]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      className="register-page"
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
        className="register-card"
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--card-bg, #fff)',
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
        }}
      >
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
          Become a Reporter
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 24 }}>
          Create a civilian reporter account for WIMS-BFP.
        </p>

        {errors.length > 0 && (
          <div
            role="alert"
            className="register-errors"
            data-testid="register-errors"
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
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'block' }}>
            <span style={labelStyle}>Email</span>
            <input
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email"
              data-testid="email"
              style={inputStyle}
            />
          </label>

          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ display: 'block', flex: 1 }}>
              <span style={labelStyle}>First name</span>
              <input
                type="text"
                name="first_name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Juan"
                aria-label="First name"
                data-testid="first_name"
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'block', flex: 1 }}>
              <span style={labelStyle}>Last name</span>
              <input
                type="text"
                name="last_name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Dela Cruz"
                aria-label="Last name"
                data-testid="last_name"
                style={inputStyle}
              />
            </label>
          </div>

          <label style={{ display: 'block' }}>
            <span style={labelStyle}>Password</span>
            <input
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 12 characters"
              aria-label="Password"
              data-testid="password"
              style={inputStyle}
            />
          </label>

          {showPwRequirements && (
            <div
              data-testid="password-requirements"
              style={{
                background: '#F9FAFB',
                border: '1px solid #E5E7EB',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: '0.78rem',
                color: 'var(--text-secondary)',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
                Password requirements:
              </div>
              <PwReq met={pwChecks.minLength} label="At least 12 characters" />
              <PwReq met={pwChecks.upperCase} label="One uppercase letter" />
              <PwReq met={pwChecks.lowerCase} label="One lowercase letter" />
              <PwReq met={pwChecks.digit} label="One number" />
              <PwReq met={pwChecks.specialChar} label="One special character (!@#$%^&*...)" />
            </div>
          )}

          <label style={{ display: 'block' }}>
            <span style={labelStyle}>Confirm password</span>
            <input
              type="password"
              name="confirm_password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
              aria-label="Confirm password"
              data-testid="confirm_password"
              style={{
                ...inputStyle,
                ...(confirmPassword.length > 0 && password !== confirmPassword
                  ? { borderColor: '#DC2626', borderWidth: 2 }
                  : {}),
              }}
            />
          </label>

          <label style={{ display: 'block' }}>
            <span style={labelStyle}>Contact number</span>
            <input
              type="tel"
              name="contact_number"
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              placeholder="09XXXXXXXXX"
              aria-label="Contact number"
              data-testid="contact_number"
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              name="dpa_consent"
              checked={dpaConsent}
              onChange={(e) => setDpaConsent(e.target.checked)}
              aria-label="Data Privacy Act consent"
              data-testid="dpa_consent"
              style={{ marginTop: 3 }}
            />
            <span>
              I have read and agree to the{' '}
              <Link href="/privacy" style={{ color: '#C62828', textDecoration: 'underline' }}>
                Data Privacy Act
              </Link>{' '}
              consent and acknowledge how my data will be used.
            </span>
          </label>

          {turnstileEnabled && (
          <div data-testid="turnstile-wrapper">
            <Turnstile
              key={turnstileResetKey}
              siteKey={siteKey}
              onSuccess={onTurnstileSuccess}
              onExpire={onTurnstileExpire}
              onError={onTurnstileError}
            />
            {turnstileExpired && (
              <p style={{ fontSize: '0.78rem', color: '#D97706', marginTop: 6 }}>
                ⚠ Security check expired. Please complete it again.
              </p>
            )}
          </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            data-testid="register-submit"
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
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={{ marginTop: 20, fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: '#C62828', fontWeight: 600, textDecoration: 'underline' }}>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

function PwReq({ met, label }: { met: boolean; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 0',
        color: met ? '#16A34A' : '#9CA3AF',
      }}
    >
      <span style={{ fontSize: '0.85rem', width: 16, textAlign: 'center' }}>
        {met ? '✓' : '○'}
      </span>
      <span>{label}</span>
    </div>
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
