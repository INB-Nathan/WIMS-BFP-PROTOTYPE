import Image from 'next/image';
import Link from 'next/link';
import { LiveTicker, EmergenciesSection, AnnouncementsSection } from '@/components/LandingSections';

export const metadata = {
  title: 'WIMS-BFP · Wildfire Incident Management System',
  description: 'Report fires and emergencies to the Bureau of Fire Protection across the Philippines.',
};

const HERO_BADGE = 'BFP Incident Reporting Network';
const HERO_TITLE = 'WIMS-BFP';
const HERO_SUBTITLE = 'Wildfire Incident Management System';

export default function LandingPage() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg, #F8F9FB)', color: 'var(--text, #1A1D23)' }}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        className="landing-hero"
        style={{
          background:
            'linear-gradient(160deg, #5A1515 0%, #8E1B1B 40%, #C62828 100%)',
          color: '#fff',
          padding: '60px 24px 56px',
          position: 'relative',
          overflow: 'hidden',
          textAlign: 'center',
        }}
      >
        <div className="landing-hero-inner" style={{ maxWidth: 680, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <div
            className="landing-hero-badge"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 14px',
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 999,
              fontSize: '0.7rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              marginBottom: 20,
            }}
          >
            <span
              className="landing-hero-dot"
              style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ADE80', animation: 'landing-pulse 2s infinite' }}
            />
            {HERO_BADGE}
          </div>

          <Image
            src="/bfp-logo.svg"
            alt="Bureau of Fire Protection"
            width={72}
            height={72}
            className="landing-hero-logo"
            priority
            style={{ margin: '0 auto 16px' }}
          />

          <h1
            className="landing-hero-title"
            style={{ fontSize: '2.4rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 12 }}
          >
            {HERO_TITLE}
          </h1>
          <p className="landing-hero-subtitle" style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.8)', maxWidth: 480, margin: '0 auto 28px', lineHeight: 1.5 }}>
            {HERO_SUBTITLE}
          </p>

          <div className="landing-hero-actions" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              href="/report"
              className="landing-btn landing-btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 24px',
                borderRadius: 8,
                fontSize: '0.85rem',
                fontWeight: 700,
                textDecoration: 'none',
                background: '#fff',
                color: '#C62828',
                boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              }}
            >
              Report a Fire
            </Link>
            <Link
              href="/register"
              className="landing-btn landing-btn-outline"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 24px',
                borderRadius: 8,
                fontSize: '0.85rem',
                fontWeight: 700,
                textDecoration: 'none',
                background: 'transparent',
                color: '#fff',
                border: '1.5px solid rgba(255,255,255,0.35)',
              }}
            >
              Become a Reporter
            </Link>
            <Link
              href="/login"
              className="landing-btn landing-btn-outline"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 24px',
                borderRadius: 8,
                fontSize: '0.85rem',
                fontWeight: 700,
                textDecoration: 'none',
                background: 'transparent',
                color: '#fff',
                border: '1.5px solid rgba(255,255,255,0.35)',
              }}
            >
              Sign In
            </Link>
          </div>
        </div>
        <style>{`
          @keyframes landing-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      </section>

      {/* ── Live ticker ──────────────────────────────────────────────────── */}
      <LiveTicker />

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="landing-main-content" style={{ maxWidth: 960, margin: '0 auto', padding: '32px 20px 48px' }}>
        <EmergenciesSection />
        <AnnouncementsSection />

        {/* ── Fire stations card ────────────────────────────────────────── */}
        <section className="section" style={{ marginBottom: 36 }}>
          <Link
            href="/fire-stations"
            className="landing-info-card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div
              aria-hidden
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(198,40,40,0.08)',
                fontSize: '1.5rem',
                flexShrink: 0,
              }}
            >
              🚒
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>Find a fire station</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Locate the nearest Bureau of Fire Protection station and response units.
              </div>
            </div>
          </Link>
        </section>
      </div>

      {/* ── DPA footer ───────────────────────────────────────────────────── */}
      <footer
        className="landing-footer"
        style={{ background: '#5A1515', color: 'rgba(255,255,255,0.6)', textAlign: 'center', padding: '20px 24px', fontSize: '0.72rem', lineHeight: 1.6 }}
      >
        <p>
          <strong style={{ color: 'rgba(255,255,255,0.85)' }}>WIMS-BFP</strong> · Bureau of Fire Protection · Republic of the Philippines
        </p>
        <p>
          <Link href="/privacy" style={{ color: 'rgba(255,255,255,0.85)', textDecoration: 'underline' }}>
            Privacy Policy
          </Link>
        </p>
      </footer>
    </main>
  );
}
