'use client';

import { useCallback, useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
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
      {/* Injected style for responsive card stacking + reliable hover */}
      <style>{`
        @media (max-width: 480px) {
          .intent-cards-responsive {
            grid-template-columns: 1fr !important;
          }
          .intent-overlay {
            padding: 16px !important;
          }
        }
        .intent-card {
          transition: border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
        }
        .intent-card:hover {
          transform: translateY(-1px);
        }
        .intent-card:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
        }
        .intent-card-report:hover {
          border-color: #dc2626 !important;
          box-shadow: 0 0 30px rgba(198,40,40,0.2);
        }
        .intent-card-browse:hover {
          border-color: rgba(255,255,255,0.35) !important;
          box-shadow: 0 0 30px rgba(255,255,255,0.06);
        }
        @media (prefers-reduced-motion: reduce) {
          .intent-card,
          .intent-card:hover {
            transition: none;
            transform: none;
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
              radial-gradient(120% 120% at 50% 30%, rgba(10,10,14,0.98) 0%, rgba(10,10,14,0.97) 55%, rgba(10,10,14,0.95) 100%),
              linear-gradient(160deg, rgba(10,10,14,0.98) 0%, rgba(10,10,14,0.96) 60%, rgba(59,130,246,0.12) 100%)
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
            pointerEvents: 'none',
            background: `
              radial-gradient(ellipse at 30% 70%, rgba(198,40,40,0.18) 0%, transparent 60%),
              radial-gradient(ellipse at 70% 30%, rgba(234,88,12,0.10) 0%, transparent 50%)
            `,
          }}
        />

        {/* Content */}
        <div
          className="intent-content"
          style={{
            position: 'relative',
            zIndex: 2,
            textAlign: 'center',
            maxWidth: 560,
            width: '100%',
          }}
        >
          {/* BFP logo — real Bureau of Fire Protection mark */}
          <div
            className="intent-logo"
            style={{
              width: 72,
              height: 72,
              margin: '0 auto 24px',
              borderRadius: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 0 40px rgba(0,0,0,0.5)',
              overflow: 'hidden',
            }}
          >
            <Image
              src="/bfp-logo.svg"
              alt="Bureau of Fire Protection"
              width={52}
              height={52}
              priority
              style={{ width: 'auto', height: '72%' }}
            />
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
            Web Incident Management System · Bureau of Fire Protection
          </p>

          {/* Cards */}
          <div
            className="intent-cards intent-cards-responsive"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
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
                border: '1.5px solid rgba(239,68,68,0.55)',
                cursor: 'pointer',
                background: 'linear-gradient(145deg, rgba(198,40,40,0.42), rgba(160,30,30,0.28))',
                color: '#fecaca',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                fontFamily: 'inherit',
                fontSize: '0.95rem',
                fontWeight: 700,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <span aria-hidden style={{ fontSize: '2rem' }}>
                <TablerIconWrapper icon={IconFlameFilled} size={32} aria-hidden />
              </span>
              <span className="intent-card-label" style={{ color: '#fecaca' }}>Report a Fire</span>
              <span
                className="intent-card-hint"
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 400,
                  color: 'rgba(254,202,202,0.8)',
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
                border: '1.5px solid rgba(255,255,255,0.22)',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.08)',
                color: '#f4f4f5',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                fontFamily: 'inherit',
                fontSize: '0.95rem',
                fontWeight: 700,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <span aria-hidden style={{ fontSize: '2rem' }}>
                <TablerIconWrapper icon={IconCompassFilled} size={32} aria-hidden />
              </span>
              <span className="intent-card-label" style={{ color: '#f4f4f5' }}>View Active Fires</span>
              <span
                className="intent-card-hint"
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 400,
                  color: 'rgba(244,244,245,0.65)',
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
