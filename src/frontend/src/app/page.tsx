'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState, useCallback } from 'react';
import { IntentModal } from '@/components/IntentModal';
import { EmergenciesSection, AnnouncementsSection } from '@/components/LandingSections';
import { IconMapPinFilled } from '@tabler/icons-react';

const PublicFireMap = dynamic(
  () => import('@/components/PublicFireMap').then((m) => m.PublicFireMap),
  { ssr: false },
);

export default function LandingPage() {
  const [showStations, setShowStations] = useState(false);

  const handleToggleStations = useCallback(() => {
    setShowStations((prev) => !prev);
  }, []);

  return (
    <>
      {/* ── Intent Modal ──────────────────────────────────────────────── */}
      <IntentModal />

      {/* ── Map area (~55vh) ───────────────────────────────────────────── */}
      <section
        className="landing-map-wrapper"
        style={{
          height: '55vh',
          minHeight: 280,
          position: 'relative',
          borderBottom: '1px solid var(--border, rgba(0,0,0,0.07))',
        }}
      >
        <PublicFireMap
          height="100%"
          className="landing-public-map"
          zoom={6}
          showStations={showStations}
        />

        {/* Map overlay controls */}
        <div
          className="landing-map-controls"
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 1000,
            display: 'flex',
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={handleToggleStations}
            aria-pressed={showStations}
            aria-label="Toggle fire stations"
            data-testid="toggle-stations-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid rgba(0,0,0,0.15)',
              background: showStations ? 'rgba(198,40,40,0.12)' : 'rgba(255,255,255,0.92)',
              color: showStations ? '#c62828' : '#333',
              fontSize: '0.72rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
              transition: 'all 180ms ease',
            }}
          >
            <IconMapPinFilled size={14} aria-hidden />
            Fire stations
          </button>
        </div>
      </section>

      {/* ── Bottom-sheet content ───────────────────────────────────────── */}
      <div
        className="landing-bottom-sheet"
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: '28px 20px 48px',
        }}
      >
        {/* Active fires near you */}
        <EmergenciesSection />

        {/* BFP Announcements */}
        <AnnouncementsSection />

        {/* Fire stations link */}
        <section className="section" style={{ marginBottom: 36 }}>
          <Link
            href="/fire-stations"
            className="landing-station-link"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 16px',
              borderRadius: 10,
              border: '1px solid var(--border-color, #e5e7eb)',
              background: 'var(--card-bg, #fff)',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'all 180ms ease',
            }}
          >
            <div
              className="station-icon"
              aria-hidden
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'rgba(59,130,246,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.1rem',
                flexShrink: 0,
              }}
            >
              🚒
            </div>
            <div>
              <div className="station-label" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Fire stations
              </div>
              <div className="station-sub" style={{ fontSize: '0.68rem', color: 'var(--text-muted, #9da5b1)' }}>
                Locate the nearest BFP station
              </div>
            </div>
          </Link>
        </section>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer
        className="landing-footer"
        style={{
          background: '#111116',
          color: 'rgba(232,232,237,0.38)',
          textAlign: 'center',
          padding: '20px 24px',
          fontSize: '0.68rem',
          lineHeight: 1.8,
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <p>
          <strong style={{ color: 'rgba(232,232,237,0.65)' }}>WIMS-BFP</strong> · Bureau of Fire Protection · Republic of the Philippines
        </p>
        <p>
          <Link
            href="/privacy"
            style={{ color: 'rgba(232,232,237,0.65)', textDecoration: 'underline', marginRight: 12 }}
          >
            Privacy Policy
          </Link>
          <Link
            href="/register"
            style={{ color: 'rgba(232,232,237,0.65)', textDecoration: 'underline' }}
          >
            Register
          </Link>
        </p>
      </footer>
    </>
  );
}
