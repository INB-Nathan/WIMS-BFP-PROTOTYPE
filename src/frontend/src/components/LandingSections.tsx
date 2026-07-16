'use client';

import { useEffect, useState } from 'react';
import { publicApiFetch } from '@/lib/api/public-transport';

interface Emergency {
  id: number;
  title: string;
  location: string;
  severity: string;
  status: string;
}

interface Announcement {
  id: number;
  title: string;
  body: string;
  urgency: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#DC2626',
  high: '#EA580C',
  moderate: '#D97706',
  low: '#0891B2',
};

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  ongoing: { bg: '#FEF2F2', color: '#DC2626' },
  contained: { bg: '#FFFBEB', color: '#D97706' },
  monitoring: { bg: '#ECFEFF', color: '#0891B2' },
  resolved: { bg: '#F0FDF4', color: '#15803D' },
};

const URGENCY_COLORS: Record<string, string> = {
  urgent: '#C62828',
  advisory: '#0891B2',
  general: '#94A3B8',
};

// ── Active emergencies grid ──────────────────────────────────────────────────

export function EmergenciesSection() {
  const [items, setItems] = useState<Emergency[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publicApiFetch<Emergency[]>('/information/emergencies')
      .then((data) => {
        if (cancelled) return;
        setItems(data ?? []);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="section" style={{ marginBottom: 36 }}>
      <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontFamily: 'var(--font-display, inherit)', fontSize: '1.1rem', fontWeight: 700 }}>Active emergencies</h2>
      </div>
      {failed ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
          Unable to load emergencies right now. Please try again later.
        </p>
      ) : items === null ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>Loading emergencies…</p>
      ) : items.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>No active emergencies.</p>
      ) : (
        <div className="em-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
          {items.map((e) => {
            const status = STATUS_STYLES[e.status] ?? STATUS_STYLES.monitoring;
            const severityColor = SEVERITY_COLORS[e.severity] ?? '#94A3B8';
            return (
              <div
                key={e.id}
                className="em-card"
                data-testid="emergency-card"
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: 16,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  display: 'flex',
                  gap: 12,
                }}
              >
                <div className="em-sev" style={{ width: 5, borderRadius: 3, flexShrink: 0, background: severityColor }} />
                <div className="em-body" style={{ flex: 1, minWidth: 0 }}>
                  <div className="em-title" style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>{e.title}</div>
                  <div className="em-loc" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                    📍 {e.location}
                  </div>
                </div>
                <span
                  className="em-status"
                  style={{
                    fontSize: '0.6rem',
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: 999,
                    whiteSpace: 'nowrap',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    alignSelf: 'flex-start',
                    background: status.bg,
                    color: status.color,
                  }}
                >
                  {e.status}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Announcements ────────────────────────────────────────────────────────────

export function AnnouncementsSection() {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publicApiFetch<Announcement[]>('/information/announcements')
      .then((data) => {
        if (cancelled) return;
        setItems(data ?? []);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function excerpt(body: string, max = 140): string {
    const clean = body.replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
  }

  return (
    <section className="section" style={{ marginBottom: 36 }}>
      {/* skeleton-pulse keyframe injected here — used by skeleton cards during loading */}
      <style>{`
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.7; }
        }
      `}</style>
      <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontFamily: 'var(--font-display, inherit)', fontSize: '1.1rem', fontWeight: 700 }}>BFP Announcements</h2>
      </div>
      {failed ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
          Unable to load announcements right now. Please try again later.
        </p>
      ) : items === null ? (
        /* ── Skeleton placeholders during fetch ── */
        <div className="ann-skeleton-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="ann-skeleton-card"
              data-testid="announcement-skeleton"
              style={{
                height: 52,
                borderRadius: 8,
                background: 'var(--bg-surface, #f3f4f6)',
                animation: 'skeleton-pulse 1.8s ease-in-out infinite',
              }}
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }} data-testid="announcements-empty">
          No active announcements at this time.
        </p>
      ) : (
        <div className="ann-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((a) => {
            const dotColor = URGENCY_COLORS[a.urgency] ?? '#94A3B8';
            return (
              <div
                key={a.id}
                className="ann-card"
                data-testid="announcement-card"
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: '14px 18px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <div className="ann-dot" style={{ width: 6, height: 6, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: dotColor }} />
                <div className="ann-body" style={{ flex: 1, minWidth: 0 }}>
                  <div className="ann-title" style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>{a.title}</div>
                  <div className="ann-excerpt" style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 2 }}>{excerpt(a.body)}</div>
                </div>
                <span
                  className="ann-urgency"
                  style={{
                    fontSize: '0.6rem',
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: 999,
                    whiteSpace: 'nowrap',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    alignSelf: 'flex-start',
                    background: `${dotColor}1A`,
                    color: dotColor,
                  }}
                >
                  {a.urgency}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
