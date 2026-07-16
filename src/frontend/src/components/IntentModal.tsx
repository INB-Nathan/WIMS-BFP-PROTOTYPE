'use client';

import { useCallback, useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TablerIconWrapper } from '@/components/TablerIcon';
import { IconFlameFilled, IconCompassFilled } from '@tabler/icons-react';

/**
 * IntentModal — full-screen choice overlay for `/` landing.
 *
 * Appears on every visit to `/` unless the `wims_browse_bypass` cookie is
 * present and the user did NOT click "Report a Fire" (which always shows
 * the modal regardless).
 *
 * Two choices:
 * - "Report a Fire" → navigate to `/report` (modal always shows)
 * - "View Active Fires" → set 2h cookie `wims_browse_bypass`, stay on `/`, hide modal
 *
 * No dismiss "X". The only escape is the two choices or closing the tab.
 */

const BYPASS_COOKIE = 'wims_browse_bypass';
const BYPASS_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, maxAgeSec: number): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSec}; SameSite=Lax`;
}

export function IntentModal() {
  const router = useRouter();
  const reportBtnRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(() => {
    if (typeof document === 'undefined') return false;
    const bypass = getCookie(BYPASS_COOKIE);
    return bypass !== '1';
  });

  // Focus the primary action (Report a Fire) on mount
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        reportBtnRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleBrowse = useCallback(() => {
    setCookie(BYPASS_COOKIE, '1', BYPASS_DURATION_MS / 1000);
    setVisible(false);
  }, []);

  const handleReport = useCallback(() => {
    router.push('/report');
  }, [router]);

  if (!visible) return null;

  return (
    <>
      {/* Injected style for responsive card stacking */}
      <style>{`
        @media (max-width: 480px) {
          .intent-cards-responsive {
            grid-template-columns: 1fr !important;
          }
          .intent-overlay {
            padding: 16px !important;
          }
        }
      `}</style>
      <div
        className="intent-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intent-heading"
        aria-describedby="intent-description"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        {/* Dark background with gradient overlay */}
        <div
          className="intent-bg"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            background: `
              linear-gradient(160deg, rgba(10,10,14,0.95) 0%, rgba(10,10,14,0.9) 40%, rgba(59,130,246,0.2) 100%),
              repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.012) 2px, rgba(255,255,255,0.012) 4px)
            `,
          }}
        />
        {/* Radial glow */}
        <div
          className="intent-glow"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            background: `
              radial-gradient(ellipse at 30% 70%, rgba(198,40,40,0.15) 0%, transparent 60%),
              radial-gradient(ellipse at 70% 30%, rgba(234,88,12,0.08) 0%, transparent 50%)
            `,
          }}
        />

        {/* Content */}
        <div
          className="intent-content"
          style={{
            position: 'relative',
            zIndex: 1,
            textAlign: 'center',
            maxWidth: 560,
            width: '100%',
          }}
        >
          {/* Logo */}
          <div
            className="intent-logo"
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 24px',
              background: '#3b82f6',
              borderRadius: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 40px rgba(59,130,246,0.3)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width={32} height={32} style={{ color: '#fff' }} aria-hidden>
              <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z" />
            </svg>
          </div>

          {/* Heading */}
          <h1
            id="intent-heading"
            className="intent-heading"
            style={{
              fontSize: '1.4rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              marginBottom: 8,
              color: 'rgba(232,232,237,0.9)',
            }}
          >
            WIMS-BFP
          </h1>

          {/* Description */}
          <p
            id="intent-description"
            className="intent-description"
            style={{
              fontSize: '0.78rem',
              color: 'rgba(232,232,237,0.48)',
              marginBottom: 28,
              lineHeight: 1.5,
            }}
          >
            Wildfire Incident Management System · Bureau of Fire Protection
          </p>

          {/* Cards */}
          <div
            className="intent-cards intent-cards-responsive"
            style={{
              display: 'grid',
              gridTemplateColumns: '1.15fr 0.85fr',
              gap: 14,
              marginBottom: 18,
            }}
          >
            {/* Report a Fire — dominant red */}
            <button
              ref={reportBtnRef}
              type="button"
              className="intent-card intent-card-report"
              onClick={handleReport}
              aria-label="Report a Fire — start an emergency fire report"
              style={{
                padding: '28px 20px 24px',
                borderRadius: 16,
                border: '1.5px solid rgba(198,40,40,0.35)',
                cursor: 'pointer',
                background: 'linear-gradient(145deg, rgba(198,40,40,0.25), rgba(160,30,30,0.15))',
                color: '#ef4444',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                transition: 'all 180ms ease',
                fontFamily: 'inherit',
                fontSize: '0.95rem',
                fontWeight: 700,
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#dc2626';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 0 30px rgba(198,40,40,0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(198,40,40,0.35)';
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span aria-hidden style={{ fontSize: '2rem' }}>
                <TablerIconWrapper icon={IconFlameFilled} size={32} aria-hidden />
              </span>
              <span className="intent-card-label" style={{ color: '#ef4444' }}>Report a Fire</span>
              <span
                className="intent-card-hint"
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 400,
                  color: 'rgba(239,68,68,0.55)',
                  lineHeight: 1.3,
                }}
              >
                Start an emergency fire report — no account needed
              </span>
            </button>

            {/* View Active Fires — subdued gray */}
            <button
              type="button"
              className="intent-card intent-card-browse"
              onClick={handleBrowse}
              aria-label="View Active Fires — see verified incidents on the map"
              style={{
                padding: '28px 20px 24px',
                borderRadius: 16,
                border: '1.5px solid rgba(255,255,255,0.1)',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)',
                color: '#e8e8ed',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                transition: 'all 180ms ease',
                fontFamily: 'inherit',
                fontSize: '0.95rem',
                fontWeight: 700,
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 0 30px rgba(255,255,255,0.04)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span aria-hidden style={{ fontSize: '2rem' }}>
                <TablerIconWrapper icon={IconCompassFilled} size={32} aria-hidden />
              </span>
              <span className="intent-card-label" style={{ color: '#e8e8ed' }}>View Active Fires</span>
              <span
                className="intent-card-hint"
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 400,
                  color: 'rgba(232,232,237,0.35)',
                  lineHeight: 1.3,
                }}
              >
                See verified BFP incidents and safety information
              </span>
            </button>
          </div>

          {/* Microcopy */}
          <p
            className="intent-subtitle"
            style={{
              fontSize: '0.72rem',
              color: 'rgba(232,232,237,0.38)',
            }}
          >
            <strong style={{ color: 'rgba(232,232,237,0.65)' }}>No account needed</strong> to report or view active fires
          </p>
        </div>
      </div>
    </>
  );
}
