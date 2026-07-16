'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { registerCivilian } from '@/lib/api/civilian';
import { PublicThemeProvider } from '@/components/public/PublicThemeProvider';
import '@/styles/public-surface.css';

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

const BENEFITS = [
  {
    icon: '🔥',
    title: 'Report incidents fast',
    text: 'Flag fires and hazards in seconds from any device, even offline.',
  },
  {
    icon: '🗺️',
    title: 'Track on the map',
    text: 'See nearby stations and live incident heatmaps across your area.',
  },
  {
    icon: '🔔',
    title: 'Stay informed',
    text: 'Get status updates as verified responders act on your report.',
  },
];

function RegisterInner() {
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
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const turnstileRef = useRef<TurnstileInstance | undefined>(undefined);
  const turnstileEnabled = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '') !== '';
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

  const onTurnstileSuccess = useCallback((token: string) => {
    setTurnstileToken(token);
    setTurnstileExpired(false);
    // Clear any prior CAPTCHA error now that a fresh token is available.
    setErrors((prev) => prev.filter((e) => !e.toLowerCase().includes('security check')));
  }, []);

  // Do NOT remount the widget on expiry. With refresh-expired: auto (the
  // default) Turnstile auto-renews the token and re-invokes onSuccess, so the
  // widget never needs to be recreated. Remounting via a React key calls
  // turnstile.remove() on the old widget, which can fire the expired callback
  // again and create a solved -> expired loop that blocks every submit.
  const onTurnstileExpire = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileExpired(true);
  }, []);

  const onTurnstileError = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileExpired(true);
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
      // of outcome. Reset the widget in place (no remount) so the user gets a
      // fresh token without triggering the remove()/expired loop.
      setTurnstileToken(null);
      setTurnstileExpired(true);
      turnstileRef.current?.reset();
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
    <main className="ps-auth-page">
      <div className="ps-auth-grid">
        {/* Left: benefits */}
        <section className="ps-auth-benefits" aria-label="Why become a reporter">
          <div className="ps-auth-hero">
            <h1>Become a Reporter</h1>
            <p>Create a civilian reporter account for WIMS-BFP.</p>
          </div>
          {BENEFITS.map((b) => (
            <div className="ps-auth-benefit" key={b.title}>
              <span className="ps-benefit-icon" aria-hidden>
                {b.icon}
              </span>
              <div className="ps-benefit-text">
                <h4>{b.title}</h4>
                <p>{b.text}</p>
              </div>
            </div>
          ))}
        </section>

        {/* Right: form */}
        <section>
          <div className="ps-card">
            <h2 className="ps-form-title ps-section-title">
              Register
            </h2>

            {errors.length > 0 && (
              <div
                role="alert"
                className="ps-error-alert"
                data-testid="register-errors"
              >
                <ul>
                  {errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className="ps-field">
                <label className="ps-label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email"
                  data-testid="email"
                  className="ps-input"
                />
              </div>

              <div className="ps-field-row">
                <div className="ps-field">
                  <label className="ps-label" htmlFor="first_name">
                    First name
                  </label>
                  <input
                    id="first_name"
                    type="text"
                    name="first_name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Juan"
                    aria-label="First name"
                    data-testid="first_name"
                    className="ps-input"
                  />
                </div>
                <div className="ps-field">
                  <label className="ps-label" htmlFor="last_name">
                    Last name
                  </label>
                  <input
                    id="last_name"
                    type="text"
                    name="last_name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Dela Cruz"
                    aria-label="Last name"
                    data-testid="last_name"
                    className="ps-input"
                  />
                </div>
              </div>

              <div className="ps-field">
                <label className="ps-label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 12 characters"
                  aria-label="Password"
                  data-testid="password"
                  className="ps-input"
                />
                <div
                  className="ps-password-strength"
                  data-testid="password-strength"
                  data-strength={passwordValid(pwChecks) ? 'strong' : password.length >= 8 ? 'medium' : 'weak'}
                  aria-hidden
                >
                  <span className="ps-pw-bar" />
                  <span className="ps-pw-bar" />
                  <span className="ps-pw-bar" />
                  <span className="ps-pw-bar" />
                </div>
              </div>

              {showPwRequirements && (
                <div
                  data-testid="password-requirements"
                  className="ps-pw-requirements"
                >
                  <div className="ps-pw-requirements-title">
                    Password requirements:
                  </div>
                  <PwReq met={pwChecks.minLength} label="At least 12 characters" />
                  <PwReq met={pwChecks.upperCase} label="One uppercase letter" />
                  <PwReq met={pwChecks.lowerCase} label="One lowercase letter" />
                  <PwReq met={pwChecks.digit} label="One number" />
                  <PwReq met={pwChecks.specialChar} label="One special character (!@#$%^&*...)" />
                </div>
              )}

              <div className="ps-field">
                <label className="ps-label" htmlFor="confirm_password">
                  Confirm password
                </label>
                <input
                  id="confirm_password"
                  type="password"
                  name="confirm_password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  aria-label="Confirm password"
                  data-testid="confirm_password"
                  aria-invalid={confirmPassword.length > 0 && password !== confirmPassword}
                  className="ps-input"
                />
                {confirmPassword.length > 0 && password !== confirmPassword && (
                  <p className="ps-pw-hint ps-error" role="alert" aria-live="polite">
                    These passwords don’t match yet.
                  </p>
                )}
              </div>

              <div className="ps-field">
                <label className="ps-label" htmlFor="contact_number">
                  Contact number
                </label>
                <input
                  id="contact_number"
                  type="tel"
                  name="contact_number"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  placeholder="09XXXXXXXXX"
                  aria-label="Contact number"
                  data-testid="contact_number"
                  className="ps-input"
                />
              </div>

              <label className="ps-check-row" htmlFor="dpa_consent">
                <input
                  id="dpa_consent"
                  type="checkbox"
                  name="dpa_consent"
                  checked={dpaConsent}
                  onChange={(e) => setDpaConsent(e.target.checked)}
                  aria-label="Data Privacy Act consent"
                  data-testid="dpa_consent"
                />
                <span>
                  I have read and agree to the{' '}
                  <Link href="/privacy" className="ps-check-row-link">
                    Data Privacy Act
                  </Link>{' '}
                  consent and acknowledge how my data will be used.
                </span>
              </label>

              {turnstileEnabled && (
                <div data-testid="turnstile-wrapper">
                  <Turnstile
                    ref={turnstileRef}
                    siteKey={siteKey}
                    onSuccess={onTurnstileSuccess}
                    onExpire={onTurnstileExpire}
                    onError={onTurnstileError}
                  />
                  {turnstileExpired && (
                    <p className="ps-pw-hint ps-error" role="alert">
                      ⚠ Security check expired. Please complete it again.
                    </p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                data-testid="register-submit"
                className="ps-btn ps-btn-primary ps-btn-block"
              >
                {submitting ? 'Creating account…' : 'Create account'}
              </button>
            </form>

            <p className="ps-auth-foot">
              Already have an account?{' '}
              <Link href="/login">Sign in</Link>
            </p>
          </div>
        </section>
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
        color: met ? 'var(--green)' : 'var(--text-muted)',
      }}
    >
      <span style={{ fontSize: '0.85rem', width: 16, textAlign: 'center' }}>
        {met ? '✓' : '○'}
      </span>
      <span>{label}</span>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <PublicThemeProvider>
      <RegisterInner />
    </PublicThemeProvider>
  );
}
